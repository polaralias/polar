import { RuntimeExecutionError } from "@polar/domain";

const LIFECYCLE_STATES = new Set([
  "pending_install",
  "installed",
  "enabled",
  "disabled",
  "removed",
  "blocked",
]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string}
 */
function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new RuntimeExecutionError(`${fieldName} must be a non-empty string`);
  }

  return value;
}

/**
 * @param {unknown} capabilities
 * @returns {readonly Record<string, unknown>[]}
 */
function normalizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) {
    return Object.freeze([]);
  }

  const normalized = [];
  for (const capability of capabilities) {
    if (!isPlainObject(capability)) {
      continue;
    }
    if (
      typeof capability.capabilityId !== "string" ||
      capability.capabilityId.length === 0
    ) {
      continue;
    }
    normalized.push(Object.freeze({ ...capability }));
  }

  normalized.sort((left, right) =>
    left.capabilityId.localeCompare(right.capabilityId),
  );
  return Object.freeze(normalized);
}

/**
 * @param {unknown} lifecycleState
 * @returns {"pending_install"|"installed"|"enabled"|"disabled"|"removed"|"blocked"}
 */
function normalizeLifecycleState(lifecycleState) {
  if (typeof lifecycleState !== "string" || !LIFECYCLE_STATES.has(lifecycleState)) {
    throw new RuntimeExecutionError(
      `Invalid lifecycle state for skill authority: ${String(lifecycleState)}`,
    );
  }

  return /** @type {"pending_install"|"installed"|"enabled"|"disabled"|"removed"|"blocked"} */ (
    lifecycleState
  );
}

/**
 * SkillRegistry manages install proposals, metadata overrides, blocking state,
 * and authority snapshots used for capability projection.
 */
export function createSkillRegistry() {
  /** @type {Map<string, Map<string, Record<string, unknown>>>} */
  const metadataOverrides = new Map();
  /** @type {Map<string, readonly { capabilityId: string, missingFields: string[] }[]>} */
  const blockedSkills = new Map();
  /** @type {Map<string, Record<string, unknown>>} */
  const proposedManifests = new Map();
  /** @type {Map<string, Record<string, unknown>>} */
  const authorityStates = new Map();

  return Object.freeze({
    /**
     * Store a proposed manifest for install/review.
     * @param {string} extensionId
     * @param {Record<string, unknown>} manifest
     * @param {{ sourceUri?: string, reviewStatus?: "pending"|"approved" }} [metadata]
     */
    propose(extensionId, manifest, metadata = {}) {
      const normalizedExtensionId = requireNonEmptyString(
        extensionId,
        "extensionId",
      );
      if (!isPlainObject(manifest)) {
        throw new RuntimeExecutionError("Proposed manifest must be a plain object");
      }

      const proposal = Object.freeze({
        ...manifest,
        extensionId: normalizedExtensionId,
        reviewStatus: metadata.reviewStatus ?? "pending",
        ...(typeof metadata.sourceUri === "string" && metadata.sourceUri.length > 0
          ? { sourceUri: metadata.sourceUri }
          : {}),
        proposedAt: Date.now(),
      });
      proposedManifests.set(normalizedExtensionId, proposal);

      this.syncLifecycleState({
        extensionId: normalizedExtensionId,
        extensionType: "skill",
        lifecycleState: "pending_install",
        capabilities: normalizeCapabilities(
          /** @type {unknown} */ (proposal.capabilities),
        ),
        authoritySource: "proposal",
      });
    },

    /**
     * @param {string} extensionId
     * @returns {Record<string, unknown>|undefined}
     */
    getProposed(extensionId) {
      if (typeof extensionId !== "string" || extensionId.length === 0) {
        return undefined;
      }
      return proposedManifests.get(extensionId);
    },

    /**
     * Review a proposed manifest with explicit approve/reject.
     * Approve keeps the proposal until applied; reject clears it.
     * @param {{
     *   extensionId: string,
     *   decision: "approve"|"reject",
     *   reviewerId?: string,
     *   reason?: string
     * }} request
     */
    reviewProposal(request) {
      if (!isPlainObject(request)) {
        throw new RuntimeExecutionError("reviewProposal request must be a plain object");
      }

      const extensionId = requireNonEmptyString(
        request.extensionId,
        "extensionId",
      );
      const decision = request.decision;
      if (decision !== "approve" && decision !== "reject") {
        throw new RuntimeExecutionError(
          `Invalid review decision: ${String(decision)}`,
        );
      }

      const proposal = proposedManifests.get(extensionId);
      if (!proposal) {
        throw new RuntimeExecutionError(
          `No pending proposal exists for extension: ${extensionId}`,
        );
      }

      const reviewedAt = Date.now();
      if (decision === "reject") {
        proposedManifests.delete(extensionId);
        return Object.freeze({
          status: "rejected",
          extensionId,
          reviewedAt,
          proposalCleared: true,
        });
      }

      const reviewed = Object.freeze({
        ...proposal,
        reviewStatus: "approved",
        reviewedAt,
        ...(typeof request.reviewerId === "string" && request.reviewerId.length > 0
          ? { reviewerId: request.reviewerId }
          : {}),
        ...(typeof request.reason === "string" && request.reason.length > 0
          ? { reviewReason: request.reason }
          : {}),
      });
      proposedManifests.set(extensionId, reviewed);
      return Object.freeze({
        status: "approved",
        extensionId,
        reviewedAt,
        proposal: reviewed,
      });
    },

    /**
     * Remove a proposal (typically after install/enable).
     * @param {string} extensionId
     */
    clearProposed(extensionId) {
      if (typeof extensionId !== "string" || extensionId.length === 0) {
        return;
      }
      proposedManifests.delete(extensionId);
    },

    /**
     * List only pending install proposals.
     * @returns {readonly { extensionId: string, manifest: Record<string, unknown> }[]}
     */
    listPending() {
      const pending = [];
      for (const [extensionId, manifest] of proposedManifests.entries()) {
        if (manifest.reviewStatus === "approved") {
          continue;
        }
        pending.push(
          Object.freeze({
            extensionId,
            manifest,
          }),
        );
      }

      pending.sort((left, right) =>
        left.extensionId.localeCompare(right.extensionId),
      );
      return Object.freeze(pending);
    },

    /**
     * Persist install authority snapshot for capability projection.
     * @param {{
     *   extensionId: string,
     *   extensionType?: "skill"|"mcp"|"plugin",
     *   lifecycleState: "pending_install"|"installed"|"enabled"|"disabled"|"removed"|"blocked",
     *   capabilities?: readonly Record<string, unknown>[],
     *   authoritySource?: string
     * }} request
     */
    syncLifecycleState(request) {
      if (!isPlainObject(request)) {
        throw new RuntimeExecutionError(
          "syncLifecycleState request must be a plain object",
        );
      }

      const extensionId = requireNonEmptyString(
        request.extensionId,
        "extensionId",
      );
      const lifecycleState = normalizeLifecycleState(request.lifecycleState);
      if (lifecycleState === "removed") {
        authorityStates.delete(extensionId);
        return;
      }

      const extensionType =
        request.extensionType === "mcp" ||
          request.extensionType === "plugin"
          ? request.extensionType
          : "skill";
      const capabilities = normalizeCapabilities(request.capabilities);
      const authorityState = Object.freeze({
        extensionId,
        extensionType,
        lifecycleState,
        capabilities,
        authoritySource:
          typeof request.authoritySource === "string" &&
            request.authoritySource.length > 0
            ? request.authoritySource
            : "lifecycle",
        updatedAt: Date.now(),
      });
      authorityStates.set(extensionId, authorityState);
    },

    /**
     * @param {string} extensionId
     * @returns {Record<string, unknown>|undefined}
     */
    getAuthorityState(extensionId) {
      if (typeof extensionId !== "string" || extensionId.length === 0) {
        return undefined;
      }
      return authorityStates.get(extensionId);
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listAuthorityStates() {
      const list = [...authorityStates.values()].sort((left, right) =>
        left.extensionId.localeCompare(right.extensionId),
      );
      return Object.freeze(list);
    },

    /**
     * Submit operator metadata override for missing risk fields.
     * @param {{
     *   extensionId: string,
     *   capabilityId: string,
     *   metadata: {
     *     riskLevel: "read"|"write"|"destructive",
     *     sideEffects: "none"|"internal"|"external",
     *     dataEgress?: "none"|"network"|"unknown",
     *     explanation: string
     *   }
     * }} request
     */
    submitOverride({ extensionId, capabilityId, metadata }) {
      const normalizedExtensionId = requireNonEmptyString(
        extensionId,
        "extensionId",
      );
      const normalizedCapabilityId = requireNonEmptyString(
        capabilityId,
        "capabilityId",
      );
      if (
        !isPlainObject(metadata) ||
        typeof metadata.explanation !== "string" ||
        metadata.explanation.length < 5
      ) {
        throw new RuntimeExecutionError(
          "Metadata override requires an explanation (min 5 chars)",
        );
      }
      if (!["read", "write", "destructive"].includes(metadata.riskLevel)) {
        throw new RuntimeExecutionError(
          `Invalid riskLevel: ${String(metadata.riskLevel)}`,
        );
      }
      if (!["none", "internal", "external"].includes(metadata.sideEffects)) {
        throw new RuntimeExecutionError(
          `Invalid sideEffects: ${String(metadata.sideEffects)}`,
        );
      }

      if (!metadataOverrides.has(normalizedExtensionId)) {
        metadataOverrides.set(normalizedExtensionId, new Map());
      }

      const extensionOverrides = metadataOverrides.get(normalizedExtensionId);
      extensionOverrides.set(
        normalizedCapabilityId,
        Object.freeze({
          riskLevel: metadata.riskLevel,
          sideEffects: metadata.sideEffects,
          dataEgress: metadata.dataEgress || "unknown",
          explanation: metadata.explanation,
          updatedAt: Date.now(),
        }),
      );

      const missing = blockedSkills.get(normalizedExtensionId);
      if (Array.isArray(missing)) {
        const refreshed = missing.filter(
          (entry) => entry.capabilityId !== normalizedCapabilityId,
        );
        if (refreshed.length === 0) {
          blockedSkills.delete(normalizedExtensionId);
        } else {
          blockedSkills.set(normalizedExtensionId, Object.freeze(refreshed));
        }
      }
    },

    /**
     * @param {string} extensionId
     * @param {string} capabilityId
     * @returns {Record<string, unknown>|undefined}
     */
    getOverride(extensionId, capabilityId) {
      if (
        typeof extensionId !== "string" ||
        extensionId.length === 0 ||
        typeof capabilityId !== "string" ||
        capabilityId.length === 0
      ) {
        return undefined;
      }
      return metadataOverrides.get(extensionId)?.get(capabilityId);
    },

    /**
     * @param {string} extensionId
     * @param {Array<{ capabilityId: string, missingFields: string[] }>} missingMetadata
     */
    markBlocked(extensionId, missingMetadata) {
      const normalizedExtensionId = requireNonEmptyString(
        extensionId,
        "extensionId",
      );
      const normalized = Array.isArray(missingMetadata)
        ? missingMetadata
          .filter(
            (entry) =>
              isPlainObject(entry) &&
              typeof entry.capabilityId === "string" &&
              entry.capabilityId.length > 0 &&
              Array.isArray(entry.missingFields),
          )
          .map((entry) =>
            Object.freeze({
              capabilityId: entry.capabilityId,
              missingFields: Object.freeze(
                entry.missingFields.filter(
                  (field) => typeof field === "string" && field.length > 0,
                ),
              ),
            }),
          )
        : [];
      blockedSkills.set(normalizedExtensionId, Object.freeze(normalized));
      const existingAuthority = authorityStates.get(normalizedExtensionId);
      this.syncLifecycleState({
        extensionId: normalizedExtensionId,
        extensionType:
          existingAuthority?.extensionType === "mcp" ||
            existingAuthority?.extensionType === "plugin"
            ? existingAuthority.extensionType
            : "skill",
        lifecycleState: "blocked",
        capabilities: normalizeCapabilities(existingAuthority?.capabilities),
        authoritySource: "metadata_block",
      });
    },

    /**
     * @param {string} extensionId
     */
    unblock(extensionId) {
      if (typeof extensionId !== "string" || extensionId.length === 0) {
        return;
      }
      blockedSkills.delete(extensionId);
    },

    /**
     * @returns {readonly { extensionId: string, missingMetadata: readonly { capabilityId: string, missingFields: string[] }[] }[]}
     */
    listBlocked() {
      const blocked = Array.from(blockedSkills.entries()).map(
        ([extensionId, missingMetadata]) =>
          Object.freeze({
            extensionId,
            missingMetadata,
          }),
      );
      blocked.sort((left, right) =>
        left.extensionId.localeCompare(right.extensionId),
      );
      return Object.freeze(blocked);
    },

    /**
     * @param {string} extensionId
     * @returns {boolean}
     */
    isBlocked(extensionId) {
      return blockedSkills.has(extensionId);
    },

    /**
     * Validate/enrich capability metadata using manifest + operator overrides.
     * @param {string} extensionId
     * @param {Array<Record<string, unknown>>} capabilities
     */
    processMetadata(extensionId, capabilities) {
      const normalizedExtensionId = requireNonEmptyString(
        extensionId,
        "extensionId",
      );
      const items = Array.isArray(capabilities) ? capabilities : [];
      const missingMetadata = [];
      const enriched = [];

      for (const capability of items) {
        if (!isPlainObject(capability)) {
          continue;
        }
        if (
          typeof capability.capabilityId !== "string" ||
          capability.capabilityId.length === 0
        ) {
          continue;
        }

        const override = metadataOverrides
          .get(normalizedExtensionId)
          ?.get(capability.capabilityId);
        const riskLevel = override?.riskLevel || capability.riskLevel || "unknown";
        const sideEffects =
          override?.sideEffects || capability.sideEffects || "unknown";
        const dataEgress =
          override?.dataEgress || capability.dataEgress || "unknown";

        if (riskLevel === "unknown" || sideEffects === "unknown") {
          missingMetadata.push(
            Object.freeze({
              capabilityId: capability.capabilityId,
              missingFields: Object.freeze([
                ...(riskLevel === "unknown" ? ["riskLevel"] : []),
                ...(sideEffects === "unknown" ? ["sideEffects"] : []),
              ]),
            }),
          );
        }

        enriched.push(
          Object.freeze({
            ...capability,
            riskLevel,
            sideEffects,
            dataEgress,
            metadataSource: override ? "operator" : "manifest",
          }),
        );
      }

      return {
        enriched: Object.freeze([...enriched]),
        missingMetadata: Object.freeze([...missingMetadata]),
      };
    },
  });
}

