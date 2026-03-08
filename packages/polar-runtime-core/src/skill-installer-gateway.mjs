import crypto from "node:crypto";
import {
  booleanField,
  ContractValidationError,
  EXTENSION_TRUST_LEVELS,
  RuntimeExecutionError,
  SKILL_ANALYZER_ACTION,
  SKILL_INSTALLER_ACTION,
  createSkillAnalyzerContract,
  createSkillInstallerContract,
  createStrictObjectSchema,
  enumField,
  jsonField,
  stringArrayField,
  stringField,
} from "@polar/domain";
import {
  createJsonSchemaResponseFormat,
  requestStructuredJsonResponse,
} from "./structured-output.mjs";

const installerRequestSchema = createStrictObjectSchema({
  schemaId: "skill.installer.gateway.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sourceUri: stringField({ minLength: 1 }),
    skillManifest: stringField({ minLength: 1 }),
    expectedHash: stringField({ minLength: 1, required: false }),
    pinnedRevision: stringField({ minLength: 1, required: false }),
    requestedTrustLevel: enumField(EXTENSION_TRUST_LEVELS, {
      required: false,
    }),
    approvalTicket: stringField({ minLength: 1, required: false }),
    enableAfterInstall: booleanField({ required: false }),
    requireManifestReview: booleanField({ required: false }),
    mcpInventory: jsonField({ required: false }),
    metadata: jsonField({ required: false }),
  },
});

const proposalReviewRequestSchema = createStrictObjectSchema({
  schemaId: "skill.installer.gateway.proposal.review.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    extensionId: stringField({ minLength: 1 }),
    decision: enumField(["approve", "reject"]),
    requestedTrustLevel: enumField(EXTENSION_TRUST_LEVELS, {
      required: false,
    }),
    approvalTicket: stringField({ minLength: 1, required: false }),
    enableAfterReview: booleanField({ required: false }),
    reviewerId: stringField({ minLength: 1, required: false }),
    reason: stringField({ minLength: 1, required: false }),
    metadata: jsonField({ required: false }),
  },
});

const analyzerManifestSchema = createStrictObjectSchema({
  schemaId: "skill.installer.gateway.analyzer.manifest",
  fields: {
    extensionId: stringField({ minLength: 1 }),
    version: stringField({ minLength: 1, required: false }),
    description: stringField({ minLength: 1, required: false }),
    permissions: stringArrayField({ minItems: 0, required: false }),
    capabilities: jsonField(),
  },
});

const analyzerManifestResponseFormat = createJsonSchemaResponseFormat(
  "skill_installer_gateway_analyzer_manifest_v1",
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["extensionId", "capabilities"],
    properties: {
      extensionId: { type: "string", minLength: 1 },
      version: { type: "string", minLength: 1 },
      description: { type: "string", minLength: 1 },
      permissions: {
        type: "array",
        items: { type: "string" },
      },
      capabilities: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["capabilityId"],
          properties: {
            capabilityId: { type: "string", minLength: 1 },
            riskLevel: {
              type: "string",
              enum: ["read", "write", "destructive", "unknown"],
            },
            sideEffects: {
              type: "string",
              enum: ["none", "internal", "external", "unknown"],
            },
            description: { type: "string", minLength: 1 },
            reason: { type: "string", minLength: 1 },
          },
        },
      },
    },
  }),
);

function normalizeJsonText(rawText) {
  return String(rawText || "").replace(/```json?\s*/g, "").replace(/```/g, "").trim();
}

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
 * @param {readonly string[]|undefined} value
 * @returns {readonly string[]}
 */
function normalizePermissions(value) {
  const permissions = value ?? [];
  const deduped = new Set();
  for (const permission of permissions) {
    if (typeof permission === "string" && permission.length > 0) {
      deduped.add(permission);
    }
  }

  return Object.freeze([...deduped].sort((left, right) => left.localeCompare(right)));
}

/**
 * @param {readonly string[]} previousPermissions
 * @param {readonly string[]} nextPermissions
 * @returns {{ added: readonly string[], removed: readonly string[], retained: readonly string[] }}
 */
function createPermissionDelta(previousPermissions, nextPermissions) {
  const previous = new Set(previousPermissions);
  const next = new Set(nextPermissions);

  const added = [];
  const removed = [];
  const retained = [];

  for (const permission of nextPermissions) {
    if (!previous.has(permission)) {
      added.push(permission);
    } else {
      retained.push(permission);
    }
  }

  for (const permission of previousPermissions) {
    if (!next.has(permission)) {
      removed.push(permission);
    }
  }

  return {
    added: Object.freeze([...added]),
    removed: Object.freeze([...removed]),
    retained: Object.freeze([...retained]),
  };
}

/**
 * @param {string} skillManifest
 * @returns {boolean}
 */
function hasYamlFrontmatter(skillManifest) {
  return skillManifest.replace(/\r\n/g, "\n").startsWith("---\n");
}

/**
 * @param {unknown} inventory
 * @returns {readonly Record<string, unknown>[]}
 */
function normalizeAnalyzerInventory(inventory) {
  if (!Array.isArray(inventory)) {
    return Object.freeze([]);
  }

  const normalized = [];
  const knownNames = new Set();
  for (const item of inventory) {
    if (!isPlainObject(item)) {
      continue;
    }

    const name = item.name;
    if (typeof name !== "string" || name.length === 0 || knownNames.has(name)) {
      continue;
    }

    knownNames.add(name);
    normalized.push(Object.freeze({ ...item }));
  }

  normalized.sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze(normalized);
}

/**
 * @param {unknown} authorityStatesValue
 * @returns {readonly Record<string, unknown>[]}
 */
function deriveAnalyzerInventoryFromAuthorityStates(authorityStatesValue) {
  if (!Array.isArray(authorityStatesValue)) {
    return Object.freeze([]);
  }

  const inventory = [];
  const knownNames = new Set();
  for (const authorityState of authorityStatesValue) {
    if (!isPlainObject(authorityState) || authorityState.extensionType !== "mcp") {
      continue;
    }

    const lifecycleState = authorityState.lifecycleState;
    if (
      lifecycleState !== "enabled" &&
      lifecycleState !== "installed" &&
      lifecycleState !== "disabled"
    ) {
      continue;
    }

    const capabilities = Array.isArray(authorityState.capabilities)
      ? authorityState.capabilities
      : [];
    for (const capability of capabilities) {
      if (!isPlainObject(capability)) {
        continue;
      }

      const capabilityId = capability.capabilityId;
      if (
        typeof capabilityId !== "string" ||
        capabilityId.length === 0 ||
        knownNames.has(capabilityId)
      ) {
        continue;
      }

      knownNames.add(capabilityId);
      inventory.push(
        Object.freeze({
          name: capabilityId,
          extensionId: authorityState.extensionId,
          toolId:
            typeof capability.toolId === "string" && capability.toolId.length > 0
              ? capability.toolId
              : undefined,
          description:
            typeof capability.description === "string" &&
              capability.description.length > 0
              ? capability.description
              : undefined,
        }),
      );
    }
  }

  inventory.sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze(inventory);
}

/**
 * @param {Record<string, unknown>} manifest
 * @returns {string}
 */
function createProposalManifestContent(manifest) {
  return JSON.stringify(manifest);
}

/**
 * @param {Record<string, unknown>|undefined} state
 * @returns {"install"|"upgrade"}
 */
function resolveInstallOperation(state) {
  if (!state || state.lifecycleState === "removed") {
    return "install";
  }

  return "upgrade";
}

/**
 * @param {string} content
 * @returns {string}
 */
function createManifestHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * @param {unknown} capabilitiesValue
 * @param {readonly string[]} inventoryToolNames
 * @returns {readonly Record<string, unknown>[]}
 */
function normalizeAnalyzerCapabilities(capabilitiesValue, inventoryToolNames) {
  if (!Array.isArray(capabilitiesValue) || capabilitiesValue.length === 0) {
    throw new RuntimeExecutionError(
      "Proposed manifest capabilities must be a non-empty array",
    );
  }

  const inventoryToolSet = new Set(inventoryToolNames);
  const normalized = [];
  const knownCapabilityIds = new Set();
  for (const capabilityCandidate of capabilitiesValue) {
    if (!isPlainObject(capabilityCandidate)) {
      throw new RuntimeExecutionError(
        "Proposed manifest capabilities must contain plain objects",
      );
    }

    const capabilityId = capabilityCandidate.capabilityId;
    if (typeof capabilityId !== "string" || capabilityId.length === 0) {
      throw new RuntimeExecutionError(
        "Proposed manifest capabilities require capabilityId",
      );
    }
    if (knownCapabilityIds.has(capabilityId)) {
      throw new RuntimeExecutionError(
        `Proposed manifest has duplicate capabilityId: ${capabilityId}`,
      );
    }
    knownCapabilityIds.add(capabilityId);

    if (!inventoryToolSet.has(capabilityId)) {
      throw new RuntimeExecutionError(
        `Proposed manifest includes unknown capability: ${capabilityId}`,
      );
    }

    normalized.push(Object.freeze({ ...capabilityCandidate }));
  }

  normalized.sort((left, right) =>
    String(left.capabilityId).localeCompare(String(right.capabilityId)),
  );
  return Object.freeze(normalized);
}

/**
 * @param {unknown} proposedManifestCandidate
 * @param {readonly string[]} inventoryToolNames
 * @returns {Record<string, unknown>}
 */
function normalizeAnalyzerManifest(proposedManifestCandidate, inventoryToolNames) {
  const validation = analyzerManifestSchema.validate(proposedManifestCandidate);
  if (!validation.ok) {
    throw new RuntimeExecutionError("Invalid proposed manifest from analyzer", {
      schemaId: analyzerManifestSchema.schemaId,
      errors: validation.errors ?? [],
    });
  }

  const parsedManifest = /** @type {Record<string, unknown>} */ (validation.value);
  const capabilities = normalizeAnalyzerCapabilities(
    parsedManifest.capabilities,
    inventoryToolNames,
  );
  const permissions = normalizePermissions(
    /** @type {readonly string[]|undefined} */ (parsedManifest.permissions),
  );

  const manifestForHash = {
    extensionId: parsedManifest.extensionId,
    version: parsedManifest.version ?? "1.0.0",
    ...(parsedManifest.description !== undefined
      ? { description: parsedManifest.description }
      : {}),
    permissions,
    capabilities,
  };

  return Object.freeze({
    ...manifestForHash,
    extensionType: "skill",
    manifestHash: createManifestHash(JSON.stringify(manifestForHash)),
  });
}

function validateAnalyzerManifestResponse(rawText, inventoryToolNames) {
  try {
    return {
      valid: true,
      schemaId: analyzerManifestSchema.schemaId,
      value: normalizeAnalyzerManifest(
        JSON.parse(normalizeJsonText(rawText)),
        inventoryToolNames,
      ),
      errors: Object.freeze([]),
      clampReasons: Object.freeze([]),
    };
  } catch (error) {
    return {
      valid: false,
      schemaId: analyzerManifestSchema.schemaId,
      value: null,
      errors: Object.freeze([
        error instanceof Error ? error.message : "Invalid analyzer manifest payload",
      ]),
      clampReasons: Object.freeze(["schema_invalid"]),
    };
  }
}

/**
 * @param {Record<string, unknown>} registry
 * @param {{
 *   extensionId: string,
 *   lifecycleState: "pending_install"|"installed"|"enabled"|"disabled"|"removed"|"blocked",
 *   capabilities?: readonly Record<string, unknown>[],
 *   authoritySource?: string
 * }} request
 */
function syncSkillAuthority(registry, request) {
  if (
    typeof registry === "object" &&
    registry !== null &&
    typeof registry.syncLifecycleState === "function"
  ) {
    registry.syncLifecycleState({
      extensionId: request.extensionId,
      extensionType: "skill",
      lifecycleState: request.lifecycleState,
      capabilities: request.capabilities,
      authoritySource: request.authoritySource,
    });
  }
}

function createPassthroughSkillRegistry() {
  return Object.freeze({
    propose() { },
    getProposed() { return undefined; },
    reviewProposal(request) {
      return {
        status: request?.decision === "approve" ? "approved" : "rejected",
        extensionId: request?.extensionId,
      };
    },
    listPending() { return []; },
    clearProposed() { },
    markBlocked() { },
    unblock() { },
    submitOverride() { },
    syncLifecycleState() { },
    listAuthorityStates() { return []; },
    processMetadata(_extensionId, capabilities) {
      return {
        enriched: Array.isArray(capabilities) ? [...capabilities] : [],
        missingMetadata: [],
      };
    },
  });
}

/**
 * Ensures legacy contracts missing retry policy remain registrable under strict registry validation.
 * @template {Record<string, unknown>} T
 * @param {T} contract
 * @param {number} [defaultMaxAttempts]
 * @returns {T}
 */
function ensureRetryPolicy(contract, defaultMaxAttempts = 1) {
  const retryPolicy = contract.retryPolicy;
  if (
    typeof retryPolicy === "object" &&
    retryPolicy !== null &&
    Number.isInteger(
      /** @type {Record<string, unknown>} */ (retryPolicy).maxAttempts,
    ) &&
    /** @type {Record<string, unknown>} */ (retryPolicy).maxAttempts > 0
  ) {
    return contract;
  }

  return /** @type {T} */ (
    Object.freeze({
      ...contract,
      retryPolicy: Object.freeze({
        maxAttempts: defaultMaxAttempts,
      }),
    })
  );
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 * @param {{ includeAnalyzer?: boolean }} [options]
 */
export function registerSkillInstallerContract(contractRegistry, options = {}) {
  const includeAnalyzer = options.includeAnalyzer === true;
  if (
    !contractRegistry.has(
      SKILL_INSTALLER_ACTION.actionId,
      SKILL_INSTALLER_ACTION.version,
    )
  ) {
    contractRegistry.register(createSkillInstallerContract());
  }
  if (
    includeAnalyzer &&
    !contractRegistry.has(
      SKILL_ANALYZER_ACTION.actionId,
      SKILL_ANALYZER_ACTION.version,
    )
  ) {
    contractRegistry.register(
      ensureRetryPolicy(createSkillAnalyzerContract()),
    );
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   extensionGateway: {
 *     applyLifecycle: (request: Record<string, unknown>) => Promise<Record<string, unknown>>,
 *     getState: (extensionId: string) => Record<string, unknown>|undefined
 *   },
 *   extensionRegistry: {
 *     upsert: (extensionId: string, adapter: { executeCapability: (request: Record<string, unknown>) => Promise<unknown>|unknown }) => void
 *   },
 *   skillAdapter: {
 *     parseSkillManifest: (skillManifest: string) => Record<string, unknown>,
 *     verifySkillProvenance: (request: Record<string, unknown>) => Record<string, unknown>,
 *     createSkillCapabilityAdapter: (config: { skillManifest: Record<string, unknown> }) => { executeCapability: (request: Record<string, unknown>) => Promise<unknown>|unknown }
 *   },
 *   skillRegistry?: {
 *     processMetadata: (extensionId: string, capabilities: Array<Record<string, unknown>>) => {
 *       enriched: Array<Record<string, unknown>>,
 *       missingMetadata: Array<{ capabilityId: string, missingFields: string[] }>
 *     },
 *     getProposed: (extensionId: string) => Record<string, unknown>|undefined,
 *     reviewProposal: (request: Record<string, unknown>) => Record<string, unknown>,
 *     listPending: () => readonly Record<string, unknown>[],
 *     markBlocked: (extensionId: string, missingMetadata: Array<{ capabilityId: string, missingFields: string[] }>) => void,
 *     unblock: (extensionId: string) => void,
 *     clearProposed: (extensionId: string) => void,
 *     propose: (extensionId: string, manifest: Record<string, unknown>) => void,
 *     syncLifecycleState?: (request: Record<string, unknown>) => void,
 *     listAuthorityStates?: () => readonly Record<string, unknown>[],
 *     submitOverride: (request: Record<string, unknown>) => unknown
 *   },
 *   providerGateway?: {
 *     generate: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>
 *   },
 *   policy?: {
 *     trustedSourcePrefixes?: readonly string[],
 *     blockedSourcePrefixes?: readonly string[],
 *     approvalRequiredPermissions?: readonly string[],
 *     evaluateInstall?: (request: Record<string, unknown>) => Promise<{ allowed: boolean, reason?: string }|boolean|void>|{ allowed: boolean, reason?: string }|boolean|void,
 *     autoEnableTrusted?: boolean
 *   },
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createSkillInstallerGateway({
  middlewarePipeline,
  extensionGateway,
  extensionRegistry,
  skillAdapter,
  skillRegistry,
  providerGateway,
  policy = {},
  defaultExecutionType = "tool",
}) {
  if (
    typeof extensionGateway !== "object" ||
    extensionGateway === null ||
    typeof extensionGateway.applyLifecycle !== "function" ||
    typeof extensionGateway.getState !== "function"
  ) {
    throw new RuntimeExecutionError(
      "extensionGateway must expose applyLifecycle(request) and getState(extensionId)",
    );
  }

  if (
    typeof extensionRegistry !== "object" ||
    extensionRegistry === null ||
    typeof extensionRegistry.upsert !== "function"
  ) {
    throw new RuntimeExecutionError("extensionRegistry must expose upsert(extensionId, adapter)");
  }

  if (
    typeof skillAdapter !== "object" ||
    skillAdapter === null ||
    typeof skillAdapter.parseSkillManifest !== "function" ||
    typeof skillAdapter.verifySkillProvenance !== "function" ||
    typeof skillAdapter.createSkillCapabilityAdapter !== "function"
  ) {
    throw new RuntimeExecutionError(
      "skillAdapter must expose parseSkillManifest, verifySkillProvenance, and createSkillCapabilityAdapter",
    );
  }

  const resolvedSkillRegistry = skillRegistry ?? createPassthroughSkillRegistry();
  if (
    typeof resolvedSkillRegistry !== "object" ||
    resolvedSkillRegistry === null ||
    typeof resolvedSkillRegistry.submitOverride !== "function" ||
    typeof resolvedSkillRegistry.processMetadata !== "function" ||
    typeof resolvedSkillRegistry.getProposed !== "function" ||
    typeof resolvedSkillRegistry.reviewProposal !== "function" ||
    typeof resolvedSkillRegistry.listPending !== "function" ||
    typeof resolvedSkillRegistry.markBlocked !== "function" ||
    typeof resolvedSkillRegistry.unblock !== "function" ||
    typeof resolvedSkillRegistry.clearProposed !== "function" ||
    typeof resolvedSkillRegistry.propose !== "function"
  ) {
    throw new RuntimeExecutionError("skillRegistry is required");
  }

  if (
    providerGateway !== undefined &&
    (typeof providerGateway !== "object" ||
      providerGateway === null ||
      typeof providerGateway.generate !== "function")
  ) {
    throw new RuntimeExecutionError(
      "providerGateway.generate(request) is required when providerGateway is provided",
    );
  }

  const trustedSourcePrefixes = normalizePermissions(
    /** @type {readonly string[]|undefined} */(policy.trustedSourcePrefixes),
  );
  const blockedSourcePrefixes = normalizePermissions(
    /** @type {readonly string[]|undefined} */(policy.blockedSourcePrefixes),
  );
  const defaultApprovalRequiredPermissions = normalizePermissions(
    /** @type {readonly string[]|undefined} */(policy.approvalRequiredPermissions),
  );

  const evaluateInstall = policy.evaluateInstall;
  if (evaluateInstall !== undefined && typeof evaluateInstall !== "function") {
    throw new RuntimeExecutionError(
      "policy.evaluateInstall must be a function when provided",
    );
  }

  const autoEnableTrusted = policy.autoEnableTrusted === true;
  const analyzerProviderId =
    typeof policy.analyzerProviderId === "string" &&
      policy.analyzerProviderId.length > 0
      ? policy.analyzerProviderId
      : "openai";
  const analyzerModel =
    typeof policy.analyzerModel === "string" && policy.analyzerModel.length > 0
      ? policy.analyzerModel
      : "gpt-4.1-mini";

  /**
   * @param {Record<string, unknown>} request
   * @returns {readonly Record<string, unknown>[]}
   */
  function resolveAnalyzerInventory(request) {
    const explicitInventory = normalizeAnalyzerInventory(request.mcpInventory);
    if (explicitInventory.length > 0) {
      return explicitInventory;
    }

    return deriveAnalyzerInventoryFromAuthorityStates(
      typeof resolvedSkillRegistry.listAuthorityStates === "function"
        ? resolvedSkillRegistry.listAuthorityStates()
        : [],
    );
  }

  /**
   * @param {Record<string, unknown>} manifest
   * @param {{
   *   sourceUri: string,
   *   manifestContent: string,
   *   manifestSource: "provided"|"generated",
   *   expectedHash?: string,
   *   pinnedRevision?: string,
   *   requestedTrustLevel?: "trusted"|"reviewed"|"sandboxed"|"blocked",
   *   enableAfterInstall?: boolean,
   *   metadata?: Record<string, unknown>
   * }} installRequest
   * @returns {Promise<Record<string, unknown>>}
   */
  async function createPendingInstallProposal(manifest, installRequest) {
    const extensionId = /** @type {string} */ (manifest.extensionId);
    const currentState = extensionGateway.getState(extensionId);
    const operation = resolveInstallOperation(currentState);
    const permissions = normalizePermissions(
      /** @type {readonly string[]|undefined} */ (manifest.permissions),
    );
    const capabilityIds = Object.freeze(
      (Array.isArray(manifest.capabilities) ? manifest.capabilities : [])
        .map((capability) =>
          isPlainObject(capability) ? capability.capabilityId : undefined,
        )
        .filter((capabilityId) =>
          typeof capabilityId === "string" && capabilityId.length > 0
        )
        .sort((left, right) => left.localeCompare(right)),
    );
    const manifestHash =
      typeof manifest.manifestHash === "string" && manifest.manifestHash.length > 0
        ? manifest.manifestHash
        : createManifestHash(installRequest.manifestContent);

    await extensionGateway.applyLifecycle({
      extensionId,
      extensionType: "skill",
      operation,
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
      requestedPermissions: permissions,
      metadata: {
        status: "pending_install",
        sourceUri: installRequest.sourceUri,
        manifestHash,
        manifestSource: installRequest.manifestSource,
      },
    });

    resolvedSkillRegistry.propose(
      extensionId,
      {
        ...manifest,
        extensionId,
        extensionType: "skill",
        manifestHash,
      },
      {
        sourceUri: installRequest.sourceUri,
        installRequest: {
          sourceUri: installRequest.sourceUri,
          manifestContent: installRequest.manifestContent,
          manifestSource: installRequest.manifestSource,
          ...(installRequest.expectedHash !== undefined
            ? { expectedHash: installRequest.expectedHash }
            : {}),
          ...(installRequest.pinnedRevision !== undefined
            ? { pinnedRevision: installRequest.pinnedRevision }
            : {}),
          ...(installRequest.requestedTrustLevel !== undefined
            ? { requestedTrustLevel: installRequest.requestedTrustLevel }
            : {}),
          ...(installRequest.enableAfterInstall !== undefined
            ? { enableAfterInstall: installRequest.enableAfterInstall }
            : {}),
          ...(isPlainObject(installRequest.metadata)
            ? { metadata: installRequest.metadata }
            : {}),
        },
      },
    );
    syncSkillAuthority(resolvedSkillRegistry, {
      extensionId,
      lifecycleState: "pending_install",
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
      authoritySource: "proposal",
    });

    return {
      status: "applied",
      extensionId,
      operation,
      lifecycleState: "pending_install",
      capabilityIds,
      manifestHash,
      proposedManifest: {
        ...manifest,
        extensionId,
        extensionType: "skill",
        manifestHash,
      },
      reviewStatus: "pending",
      manifestSource: installRequest.manifestSource,
    };
  }

  /**
   * @param {{
   *   executionType: "tool"|"handoff"|"automation"|"heartbeat",
   *   traceId?: string,
   *   parsedManifest: Record<string, unknown>,
   *   manifestContent: string,
   *   sourceUri: string,
   *   expectedHash?: string,
   *   pinnedRevision?: string,
   *   requestedTrustLevel?: "trusted"|"reviewed"|"sandboxed"|"blocked",
   *   approvalTicket?: string,
   *   enableAfterInstall?: boolean,
   *   metadata?: Record<string, unknown>,
   *   clearProposalBeforeFinalize?: boolean,
   *   clearProposalAfterSuccess?: boolean,
   *   authoritySource?: string
   * }} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async function finalizeInstall(request) {
    const manifestHash =
      typeof request.parsedManifest.manifestHash === "string" &&
        request.parsedManifest.manifestHash.length > 0
        ? request.parsedManifest.manifestHash
        : createManifestHash(request.manifestContent);
    const skillManifest = {
      ...request.parsedManifest,
      extensionId: request.parsedManifest.extensionId,
      extensionType: "skill",
      manifestHash,
    };
    const extensionId = /** @type {string} */ (skillManifest.extensionId);
    const capabilityIds = Object.freeze(
      (Array.isArray(skillManifest.capabilities) ? skillManifest.capabilities : [])
        .map((capability) =>
          isPlainObject(capability) ? capability.capabilityId : undefined,
        )
        .filter((capabilityId) =>
          typeof capabilityId === "string" && capabilityId.length > 0
        )
        .sort((left, right) => left.localeCompare(right)),
    );
    const currentState = extensionGateway.getState(extensionId);
    const operation = resolveInstallOperation(currentState);

    if (typeof extensionId !== "string" || extensionId.length === 0) {
      throw new RuntimeExecutionError("Skill manifest is missing extensionId");
    }
    if (capabilityIds.length === 0) {
      throw new RuntimeExecutionError("Skill manifest must define at least one capability");
    }

    let provenance;
    try {
      provenance = skillAdapter.verifySkillProvenance({
        sourceUri: request.sourceUri,
        manifestContent: request.manifestContent,
        expectedHash: request.expectedHash,
        pinnedRevision: request.pinnedRevision,
        trustedSourcePrefixes,
        blockedSourcePrefixes,
      });
    } catch (error) {
      return {
        status: "rejected",
        extensionId,
        operation,
        trustLevel: "blocked",
        lifecycleStatus: "rejected",
        lifecycleState: currentState?.lifecycleState ?? "blocked",
        permissionDelta: createPermissionDelta(
          normalizePermissions(
            /** @type {readonly string[]|undefined} */ (currentState?.permissions),
          ),
          normalizePermissions(
            /** @type {readonly string[]|undefined} */ (skillManifest.permissions),
          ),
        ),
        capabilityIds,
        manifestHash,
        provenance: {
          sourceUri: request.sourceUri,
          error: error instanceof Error ? error.message : String(error),
        },
        reason: "Skill provenance verification failed",
      };
    }

    if (!isPlainObject(provenance)) {
      throw new RuntimeExecutionError("Skill provenance verifier returned invalid result");
    }

    const previousPermissions = normalizePermissions(
      /** @type {readonly string[]|undefined} */ (currentState?.permissions),
    );
    const nextPermissions = normalizePermissions(
      /** @type {readonly string[]|undefined} */ (skillManifest.permissions),
    );
    const permissionDelta = createPermissionDelta(previousPermissions, nextPermissions);
    const requiresApproval = permissionDelta.added.some((permission) =>
      defaultApprovalRequiredPermissions.includes(permission),
    );
    const recommendedTrustLevel =
      /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
        provenance.trustLevelRecommendation
      ) ?? "sandboxed";
    const trustLevel =
      /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
        request.requestedTrustLevel
      ) ?? recommendedTrustLevel;
    const installDecisionRaw =
      evaluateInstall &&
      (await evaluateInstall({
        extensionId,
        operation,
        trustLevel,
        provenance,
        permissionDelta,
        requestedPermissions: nextPermissions,
        currentState,
      }));
    const installDecision =
      installDecisionRaw === undefined
        ? { allowed: true }
        : typeof installDecisionRaw === "boolean"
          ? { allowed: installDecisionRaw }
          : installDecisionRaw;

    if (
      !isPlainObject(installDecision) ||
      typeof installDecision.allowed !== "boolean"
    ) {
      throw new RuntimeExecutionError("policy.evaluateInstall returned invalid decision");
    }

    if (!installDecision.allowed) {
      return {
        status: "rejected",
        extensionId,
        operation,
        trustLevel,
        lifecycleStatus: "rejected",
        lifecycleState:
          currentState?.lifecycleState ?? (trustLevel === "blocked" ? "blocked" : "installed"),
        permissionDelta,
        capabilityIds,
        manifestHash,
        provenance,
        reason:
          typeof installDecision.reason === "string" &&
            installDecision.reason.length > 0
            ? installDecision.reason
            : "Skill install policy denied",
      };
    }

    if (requiresApproval && request.approvalTicket === undefined) {
      return {
        status: "rejected",
        extensionId,
        operation,
        trustLevel,
        lifecycleStatus: "rejected",
        lifecycleState:
          currentState?.lifecycleState ?? (trustLevel === "blocked" ? "blocked" : "installed"),
        permissionDelta,
        capabilityIds,
        manifestHash,
        provenance,
        reason: "Skill install requires approval ticket for permission delta",
      };
    }

    const proposedCapabilities = Array.isArray(skillManifest.capabilities)
      ? skillManifest.capabilities
      : [];
    const { enriched: enrichedCapabilities, missingMetadata } =
      resolvedSkillRegistry.processMetadata(extensionId, proposedCapabilities);
    if (missingMetadata.length > 0) {
      resolvedSkillRegistry.markBlocked(extensionId, missingMetadata);
      syncSkillAuthority(resolvedSkillRegistry, {
        extensionId,
        lifecycleState: "blocked",
        capabilities: enrichedCapabilities,
        authoritySource: "install_metadata_block",
      });
      return {
        status: "rejected",
        extensionId,
        operation,
        trustLevel,
        lifecycleStatus: "rejected",
        lifecycleState: currentState?.lifecycleState ?? "blocked",
        permissionDelta,
        capabilityIds,
        manifestHash,
        provenance,
        reason: "Skill metadata required",
        missingMetadata,
      };
    }

    resolvedSkillRegistry.unblock(extensionId);
    if (request.clearProposalBeforeFinalize === true) {
      resolvedSkillRegistry.clearProposed(extensionId);
    }

    const lifecycleInput = {
      executionType: request.executionType,
      extensionId,
      extensionType: "skill",
      operation,
      trustLevel,
      sourceUri: request.sourceUri,
      requestedPermissions: nextPermissions,
      capabilities: enrichedCapabilities,
      metadata: {
        provenance,
        capabilityIds,
        manifestHash,
        ...(isPlainObject(request.metadata) ? request.metadata : {}),
      },
    };
    if (request.traceId !== undefined) {
      lifecycleInput.traceId = request.traceId;
    }
    if (request.approvalTicket !== undefined) {
      lifecycleInput.approvalTicket = request.approvalTicket;
    }

    const lifecycleResult = await extensionGateway.applyLifecycle(lifecycleInput);
    if (lifecycleResult.status !== "applied") {
      syncSkillAuthority(resolvedSkillRegistry, {
        extensionId,
        lifecycleState:
          /** @type {"pending_install"|"installed"|"enabled"|"disabled"|"removed"|"blocked"} */ (
            lifecycleResult.lifecycleState
          ),
        capabilities: enrichedCapabilities,
        authoritySource: "install_lifecycle_rejected",
      });
      return {
        status: "rejected",
        extensionId,
        operation,
        trustLevel,
        lifecycleStatus: "rejected",
        lifecycleState: lifecycleResult.lifecycleState,
        permissionDelta,
        capabilityIds,
        manifestHash,
        provenance,
        reason:
          typeof lifecycleResult.reason === "string" &&
            lifecycleResult.reason.length > 0
            ? lifecycleResult.reason
            : "Skill lifecycle transition rejected",
      };
    }

    const skillCapabilityAdapter = skillAdapter.createSkillCapabilityAdapter({
      skillManifest: {
        ...skillManifest,
        permissions: nextPermissions,
        capabilities: enrichedCapabilities,
        manifestHash,
      },
    });
    extensionRegistry.upsert(extensionId, skillCapabilityAdapter);

    const shouldEnable =
      request.enableAfterInstall ??
      (autoEnableTrusted && trustLevel === "trusted");
    let finalLifecycleStatus = lifecycleResult.status;
    let finalLifecycleState = lifecycleResult.lifecycleState;
    let finalReason = undefined;

    if (shouldEnable && finalLifecycleState !== "enabled") {
      const enableInput = {
        executionType: request.executionType,
        extensionId,
        extensionType: "skill",
        operation: "enable",
      };
      if (request.traceId !== undefined) {
        enableInput.traceId = request.traceId;
      }

      const enableResult = await extensionGateway.applyLifecycle(enableInput);
      finalLifecycleStatus = enableResult.status;
      finalLifecycleState = enableResult.lifecycleState;
      if (enableResult.status !== "applied") {
        finalReason =
          typeof enableResult.reason === "string" &&
            enableResult.reason.length > 0
            ? enableResult.reason
            : "Skill enable transition rejected";
      }
    }

    const status = finalLifecycleStatus === "applied" ? "applied" : "rejected";
    syncSkillAuthority(resolvedSkillRegistry, {
      extensionId,
      lifecycleState:
        status === "applied"
          ? /** @type {"pending_install"|"installed"|"enabled"|"disabled"|"removed"|"blocked"} */ (
            finalLifecycleState
          )
          : "blocked",
      capabilities: enrichedCapabilities,
      authoritySource: request.authoritySource ?? "install_finalized",
    });

    if (status === "applied" && request.clearProposalAfterSuccess === true) {
      resolvedSkillRegistry.clearProposed(extensionId);
    }

    return {
      status,
      extensionId,
      operation,
      trustLevel,
      lifecycleStatus: finalLifecycleStatus,
      lifecycleState: finalLifecycleState,
      permissionDelta,
      capabilityIds,
      manifestHash,
      provenance,
      ...(finalReason ? { reason: finalReason } : {}),
    };
  }

  /**
   * @param {{
   *   sourceUri: string,
   *   skillContent: string,
   *   mcpInventory: readonly Record<string, unknown>[],
   *   installRequest?: {
   *     sourceUri: string,
   *     expectedHash?: string,
   *     pinnedRevision?: string,
   *     requestedTrustLevel?: "trusted"|"reviewed"|"sandboxed"|"blocked",
   *     enableAfterInstall?: boolean,
   *     metadata?: Record<string, unknown>
   *   }
   * }} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async function analyzeManifestAndCreateProposal(request) {
    const skillContent = request.skillContent;
    const mcpInventory = normalizeAnalyzerInventory(request.mcpInventory);
    const inventoryToolNames = mcpInventory
      .map((tool) =>
        isPlainObject(tool) && typeof tool.name === "string" ? tool.name : undefined,
      )
      .filter((name) => typeof name === "string" && name.length > 0);
    if (inventoryToolNames.length === 0) {
      throw new RuntimeExecutionError(
        "Analyzer inventory must include at least one named MCP capability",
      );
    }

    const prompt = `You are a Polar Skill Installer.
Analyze the following SKILL.md content and the available MCP tools.
Propose a SkillManifest that maps the skill's desired behaviors to specific MCP tools.

RULES:
1. You MUST only use tools present in the inventory.
2. You CANNOT set risk metadata (riskLevel, sideEffects).
3. The manifest must have an extensionId, version, description, and capabilities array.

SKILL.md:
${skillContent}

MCP INVENTORY:
${JSON.stringify(mcpInventory, null, 2)}

Output ONLY the JSON manifest.`;

    if (
      typeof providerGateway !== "object" ||
      providerGateway === null ||
      typeof providerGateway.generate !== "function"
    ) {
      throw new RuntimeExecutionError(
        "providerGateway.generate(request) is required for skill manifest analysis",
      );
    }

    const manifestValidation = await requestStructuredJsonResponse({
      providerGateway,
      responseFormat: analyzerManifestResponseFormat,
      initialRequest: {
        executionType: "tool",
        providerId: analyzerProviderId,
        model: analyzerModel,
        system:
          `You are a specialized Polar Skill Installer. Return exactly one JSON object matching ${analyzerManifestSchema.schemaId}. `
          + "No markdown, no code fences, no prose outside the JSON object.",
        prompt,
        temperature: 0,
        maxOutputTokens: 480,
      },
      validateResponseText(rawText) {
        return validateAnalyzerManifestResponse(rawText, inventoryToolNames);
      },
      buildRepairRequest({ invalidOutput, validationErrors }) {
        return {
          executionType: "tool",
          providerId: analyzerProviderId,
          model: analyzerModel,
          system:
            `You are a skill manifest JSON repairer. Return exactly one corrected JSON object matching ${analyzerManifestSchema.schemaId}. `
            + "Do not explain the changes. Do not wrap the JSON in markdown or quotes.",
          prompt:
            `The prior analyzer output was invalid. Fix it and return corrected JSON only. ${JSON.stringify({
              validationErrors,
              inventoryToolNames,
              invalidOutput,
            })}`,
          temperature: 0,
          maxOutputTokens: 480,
        };
      },
      unavailableFallbackReason: "skill_manifest_analyzer_unavailable",
      invalidFallbackReason: "schema_invalid",
    });
    if (!manifestValidation.valid) {
      throw new RuntimeExecutionError("Failed to produce a valid manifest from analyzer", {
        schemaId: analyzerManifestSchema.schemaId,
        errors: manifestValidation.validationErrors ?? manifestValidation.errors ?? [],
        clampReasons: manifestValidation.clampReasons ?? ["schema_invalid"],
      });
    }

    const proposedManifest = manifestValidation.value;
    const manifestContent = createProposalManifestContent(proposedManifest);
    return createPendingInstallProposal(proposedManifest, {
      sourceUri: request.sourceUri,
      manifestContent,
      manifestSource: "generated",
      expectedHash:
        typeof request.installRequest?.expectedHash === "string"
          ? request.installRequest.expectedHash
          : undefined,
      pinnedRevision:
        typeof request.installRequest?.pinnedRevision === "string"
          ? request.installRequest.pinnedRevision
          : undefined,
      requestedTrustLevel:
        /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
          request.installRequest?.requestedTrustLevel
        ),
      enableAfterInstall:
        typeof request.installRequest?.enableAfterInstall === "boolean"
          ? request.installRequest.enableAfterInstall
          : undefined,
      metadata: isPlainObject(request.installRequest?.metadata)
        ? request.installRequest.metadata
        : undefined,
    });
  }

  return Object.freeze({
    /**
     * Analyze a skill and propose a manifest.
     * @param {unknown} request 
     */
    async proposeManifest(request) {
      const inputSchema = createSkillAnalyzerContract().inputSchema;
      const validation = inputSchema.validate(request);
      if (!validation.ok) {
        throw new ContractValidationError("Invalid skill analyzer request", {
          schemaId: inputSchema.schemaId,
          errors: validation.errors ?? [],
        });
      }

      const parsed = /** @type {Record<string, unknown>} */ (validation.value);
      return analyzeManifestAndCreateProposal({
        sourceUri: /** @type {string} */ (parsed.sourceUri),
        skillContent: /** @type {string} */ (parsed.skillContent),
        mcpInventory: normalizeAnalyzerInventory(parsed.mcpInventory),
      });
    },

    /**
     * Review a pending proposal and optionally enable after approval.
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async reviewProposal(request) {
      const validation = proposalReviewRequestSchema.validate(request);
      if (!validation.ok) {
        throw new ContractValidationError(
          "Invalid skill proposal review request",
          {
            schemaId: proposalReviewRequestSchema.schemaId,
            errors: validation.errors ?? [],
          },
        );
      }

      const parsed = /** @type {Record<string, unknown>} */ (validation.value);
      const requestExecutionType =
        /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
          parsed.executionType
        ) ?? defaultExecutionType;
      const requestTraceId = /** @type {string|undefined} */ (parsed.traceId);
      const extensionId = /** @type {string} */ (parsed.extensionId);
      const decision = /** @type {"approve"|"reject"} */ (parsed.decision);
      const currentState = extensionGateway.getState(extensionId);

      const reviewResult = resolvedSkillRegistry.reviewProposal({
        extensionId,
        decision,
        reviewerId: parsed.reviewerId,
        reason: parsed.reason,
      });

      if (decision === "reject") {
        let rejectedLifecycleState = currentState?.lifecycleState ?? "removed";
        if (rejectedLifecycleState === "pending_install") {
          const removeInput = {
            executionType: requestExecutionType,
            extensionId,
            extensionType: "skill",
            operation: "remove",
            metadata: {
              status: "review_rejected",
              ...(typeof parsed.reason === "string" && parsed.reason.length > 0
                ? { reason: parsed.reason }
                : {}),
            },
          };
          if (requestTraceId !== undefined) {
            removeInput.traceId = requestTraceId;
          }
          const removeResult = await extensionGateway.applyLifecycle(removeInput);
          if (removeResult.status === "applied") {
            rejectedLifecycleState = removeResult.lifecycleState;
          }
        }

        syncSkillAuthority(resolvedSkillRegistry, {
          extensionId,
          lifecycleState:
            /** @type {"pending_install"|"installed"|"enabled"|"disabled"|"removed"|"blocked"} */ (
              rejectedLifecycleState
            ),
          capabilities: Array.isArray(currentState?.capabilities)
            ? currentState.capabilities
            : [],
          authoritySource: "review_rejected",
        });

        return {
          status: "rejected",
          extensionId,
          reviewStatus: "rejected",
          lifecycleState: rejectedLifecycleState,
          ...(typeof parsed.reason === "string" &&
            parsed.reason.length > 0
            ? { reason: parsed.reason }
            : {}),
        };
      }

      const proposal = resolvedSkillRegistry.getProposed(extensionId);
      if (!isPlainObject(proposal)) {
        throw new RuntimeExecutionError(
          `No approved proposal available for extension: ${extensionId}`,
        );
      }
      const installRequest = isPlainObject(proposal.installRequest)
        ? proposal.installRequest
        : {};
      const installResult = await finalizeInstall({
        executionType: requestExecutionType,
        traceId: requestTraceId,
        parsedManifest: proposal,
        manifestContent:
          typeof installRequest.manifestContent === "string" &&
            installRequest.manifestContent.length > 0
            ? installRequest.manifestContent
            : createProposalManifestContent(proposal),
        sourceUri:
          typeof installRequest.sourceUri === "string" &&
            installRequest.sourceUri.length > 0
            ? installRequest.sourceUri
            : (
              typeof proposal.sourceUri === "string" && proposal.sourceUri.length > 0
                ? proposal.sourceUri
                : extensionId
            ),
        expectedHash:
          typeof installRequest.expectedHash === "string"
            ? installRequest.expectedHash
            : undefined,
        pinnedRevision:
          typeof installRequest.pinnedRevision === "string"
            ? installRequest.pinnedRevision
            : undefined,
        requestedTrustLevel:
          /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
            parsed.requestedTrustLevel ?? installRequest.requestedTrustLevel
          ),
        approvalTicket:
          typeof parsed.approvalTicket === "string"
            ? parsed.approvalTicket
            : undefined,
        enableAfterInstall:
          typeof parsed.enableAfterReview === "boolean"
            ? parsed.enableAfterReview
            : (
              typeof installRequest.enableAfterInstall === "boolean"
                ? installRequest.enableAfterInstall
                : undefined
            ),
        metadata: {
          status: "reviewed_install",
          review: reviewResult,
          ...(isPlainObject(installRequest.metadata) ? installRequest.metadata : {}),
          ...(isPlainObject(parsed.metadata) ? parsed.metadata : {}),
        },
        clearProposalAfterSuccess: true,
        authoritySource: "review_approved",
      });

      return {
        ...installResult,
        reviewStatus: "approved",
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async install(request) {
      const validation = installerRequestSchema.validate(request);
      if (!validation.ok) {
        throw new ContractValidationError("Invalid skill installer gateway request", {
          schemaId: installerRequestSchema.schemaId,
          errors: validation.errors ?? [],
        });
      }

      const parsed = /** @type {Record<string, unknown>} */ (validation.value);
      const requestExecutionType =
        /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
          parsed.executionType
        ) ?? defaultExecutionType;
      const requestTraceId = /** @type {string|undefined} */ (parsed.traceId);
      const enableAfterInstall = /** @type {boolean|undefined} */ (
        parsed.enableAfterInstall
      );

      return middlewarePipeline.run(
        {
          executionType: requestExecutionType,
          traceId: requestTraceId,
          actionId: SKILL_INSTALLER_ACTION.actionId,
          version: SKILL_INSTALLER_ACTION.version,
          input: (() => {
            const input = {
              sourceUri: parsed.sourceUri,
              skillManifest: parsed.skillManifest,
            };
            if (parsed.expectedHash !== undefined) {
              input.expectedHash = parsed.expectedHash;
            }
            if (parsed.pinnedRevision !== undefined) {
              input.pinnedRevision = parsed.pinnedRevision;
            }
            if (parsed.requestedTrustLevel !== undefined) {
              input.requestedTrustLevel = parsed.requestedTrustLevel;
            }
            if (parsed.approvalTicket !== undefined) {
              input.approvalTicket = parsed.approvalTicket;
            }
            if (enableAfterInstall !== undefined) {
              input.enableAfterInstall = enableAfterInstall;
            }
            if (parsed.requireManifestReview !== undefined) {
              input.requireManifestReview = parsed.requireManifestReview;
            }
            if (parsed.mcpInventory !== undefined) {
              input.mcpInventory = parsed.mcpInventory;
            }
            if (parsed.metadata !== undefined) {
              input.metadata = parsed.metadata;
            }

            return input;
          })(),
        },
        async (validatedInput) => {
          const requireManifestReview = validatedInput.requireManifestReview === true;
          const rawSkillManifest = /** @type {string} */ (validatedInput.skillManifest);

          if (requireManifestReview && !hasYamlFrontmatter(rawSkillManifest)) {
            return analyzeManifestAndCreateProposal({
              sourceUri: /** @type {string} */ (validatedInput.sourceUri),
              skillContent: rawSkillManifest,
              mcpInventory: resolveAnalyzerInventory(validatedInput),
              installRequest: {
                sourceUri: /** @type {string} */ (validatedInput.sourceUri),
                expectedHash:
                  typeof validatedInput.expectedHash === "string"
                    ? validatedInput.expectedHash
                    : undefined,
                pinnedRevision:
                  typeof validatedInput.pinnedRevision === "string"
                    ? validatedInput.pinnedRevision
                    : undefined,
                requestedTrustLevel:
                  /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
                    validatedInput.requestedTrustLevel
                  ),
                enableAfterInstall:
                  typeof validatedInput.enableAfterInstall === "boolean"
                    ? validatedInput.enableAfterInstall
                    : undefined,
                metadata: isPlainObject(validatedInput.metadata)
                  ? validatedInput.metadata
                  : undefined,
              },
            });
          }

          let skillManifest;
          try {
            skillManifest = skillAdapter.parseSkillManifest(rawSkillManifest);
          } catch (error) {
            throw new ContractValidationError("Invalid SKILL.md manifest", {
              actionId: SKILL_INSTALLER_ACTION.actionId,
              version: SKILL_INSTALLER_ACTION.version,
              cause: error instanceof Error ? error.message : String(error),
            });
          }

          if (!isPlainObject(skillManifest)) {
            throw new RuntimeExecutionError("Skill manifest parser returned invalid result");
          }

          if (requireManifestReview) {
            return createPendingInstallProposal(skillManifest, {
              sourceUri: /** @type {string} */ (validatedInput.sourceUri),
              manifestContent: rawSkillManifest,
              manifestSource: "provided",
              expectedHash:
                typeof validatedInput.expectedHash === "string"
                  ? validatedInput.expectedHash
                  : undefined,
              pinnedRevision:
                typeof validatedInput.pinnedRevision === "string"
                  ? validatedInput.pinnedRevision
                  : undefined,
              requestedTrustLevel:
                /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
                  validatedInput.requestedTrustLevel
                ),
              enableAfterInstall:
                typeof validatedInput.enableAfterInstall === "boolean"
                  ? validatedInput.enableAfterInstall
                  : undefined,
              metadata: isPlainObject(validatedInput.metadata)
                ? validatedInput.metadata
                : undefined,
            });
          }

          return finalizeInstall({
            executionType: requestExecutionType,
            traceId: requestTraceId,
            parsedManifest: skillManifest,
            manifestContent: rawSkillManifest,
            sourceUri: /** @type {string} */ (validatedInput.sourceUri),
            expectedHash:
              typeof validatedInput.expectedHash === "string"
                ? validatedInput.expectedHash
                : undefined,
            pinnedRevision:
              typeof validatedInput.pinnedRevision === "string"
                ? validatedInput.pinnedRevision
                : undefined,
            requestedTrustLevel:
              /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
                validatedInput.requestedTrustLevel
              ),
            approvalTicket:
              typeof validatedInput.approvalTicket === "string"
                ? validatedInput.approvalTicket
                : undefined,
            enableAfterInstall:
              typeof validatedInput.enableAfterInstall === "boolean"
                ? validatedInput.enableAfterInstall
                : undefined,
            metadata: isPlainObject(validatedInput.metadata)
              ? validatedInput.metadata
              : undefined,
            clearProposalBeforeFinalize: true,
            authoritySource: "install_finalized",
          });
        },
      );
    },
  });
}
