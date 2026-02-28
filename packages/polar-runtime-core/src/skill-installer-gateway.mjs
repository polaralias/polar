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
  stringField,
} from "../../polar-domain/src/index.mjs";

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
    metadata: jsonField({ required: false }),
  },
});

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
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerSkillInstallerContract(contractRegistry) {
  if (
    !contractRegistry.has(
      SKILL_INSTALLER_ACTION.actionId,
      SKILL_INSTALLER_ACTION.version,
    )
  ) {
    contractRegistry.register(createSkillInstallerContract());
  }
  if (
    !contractRegistry.has(
      SKILL_ANALYZER_ACTION.actionId,
      SKILL_ANALYZER_ACTION.version,
    )
  ) {
    contractRegistry.register(createSkillAnalyzerContract());
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

  if (
    typeof skillRegistry !== "object" ||
    skillRegistry === null ||
    typeof skillRegistry.submitOverride !== "function"
  ) {
    throw new RuntimeExecutionError("skillRegistry is required");
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
      const skillContent = /** @type {string} */ (parsed.skillContent);
      const mcpInventory = /** @type {Array<any>} */ (parsed.mcpInventory);

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

      const response = await providerGateway.generate({
        executionType: "tool",
        system: "You are a specialized Polar Skill Installer. You output only valid JSON.",
        prompt
      });

      let proposedManifest;
      try {
        proposedManifest = JSON.parse(response.text.replace(/```json|```/g, '').trim());
      } catch (e) {
        throw new RuntimeExecutionError("Failed to parse proposed manifest from LLM");
      }

      // Basic validation: ensure extensionId exists
      if (!proposedManifest.extensionId) {
        throw new RuntimeExecutionError("Proposed manifest missing extensionId");
      }

      // Ensure no invented capabilities
      if (Array.isArray(proposedManifest.capabilities)) {
        const inventoryToolNames = mcpInventory.map(t => t.name);
        for (const cap of proposedManifest.capabilities) {
          if (!inventoryToolNames.includes(cap.capabilityId)) {
            throw new RuntimeExecutionError(`Proposed manifest includes unknown capability: ${cap.capabilityId}`);
          }
        }
      }

      // Force-set status to pending_install in lifecycle
      await extensionGateway.applyLifecycle({
        extensionId: proposedManifest.extensionId,
        extensionType: "skill",
        operation: "install",
        metadata: { status: "pending_install" }
      });

      // Store in registry
      skillRegistry.propose(proposedManifest.extensionId, proposedManifest);

      return {
        status: "applied",
        extensionId: proposedManifest.extensionId,
        proposedManifest
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
            if (parsed.metadata !== undefined) {
              input.metadata = parsed.metadata;
            }

            return input;
          })(),
        },
        async (validatedInput) => {
          let skillManifest;
          try {
            skillManifest = skillAdapter.parseSkillManifest(
              /** @type {string} */(validatedInput.skillManifest),
            );
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

          const extensionId = /** @type {string} */ (skillManifest.extensionId);
          const capabilityIds = Object.freeze(
            (Array.isArray(skillManifest.capabilities) ? skillManifest.capabilities : [])
              .map((capability) =>
                isPlainObject(capability) ? capability.capabilityId : undefined,
              )
              .filter(
                (capabilityId) =>
                  typeof capabilityId === "string" && capabilityId.length > 0,
              )
              .sort((left, right) => left.localeCompare(right)),
          );

          if (typeof extensionId !== "string" || extensionId.length === 0) {
            throw new RuntimeExecutionError("Skill manifest is missing extensionId");
          }
          if (capabilityIds.length === 0) {
            throw new RuntimeExecutionError("Skill manifest must define at least one capability");
          }

          let provenance;
          try {
            provenance = skillAdapter.verifySkillProvenance({
              sourceUri: validatedInput.sourceUri,
              manifestContent: validatedInput.skillManifest,
              expectedHash: validatedInput.expectedHash,
              pinnedRevision: validatedInput.pinnedRevision,
              trustedSourcePrefixes,
              blockedSourcePrefixes,
            });
          } catch (error) {
            const manifestHash = skillManifest.manifestHash;
            const currentState = extensionGateway.getState(extensionId);
            const operation = resolveInstallOperation(currentState);
            return {
              status: "rejected",
              extensionId,
              operation,
              trustLevel: "blocked",
              lifecycleStatus: "rejected",
              lifecycleState: currentState?.lifecycleState ?? "blocked",
              permissionDelta: createPermissionDelta(
                normalizePermissions(
                  /** @type {readonly string[]|undefined} */(
                    currentState?.permissions
                  ),
                ),
                normalizePermissions(
                  /** @type {readonly string[]|undefined} */(
                    skillManifest.permissions
                  ),
                ),
              ),
              capabilityIds,
              manifestHash:
                typeof manifestHash === "string" && manifestHash.length > 0
                  ? manifestHash
                  : "unavailable",
              provenance: {
                sourceUri: validatedInput.sourceUri,
                error: error instanceof Error ? error.message : String(error),
              },
              reason: "Skill provenance verification failed",
            };
          }

          if (!isPlainObject(provenance)) {
            throw new RuntimeExecutionError("Skill provenance verifier returned invalid result");
          }

          const currentState = extensionGateway.getState(extensionId);
          const operation = resolveInstallOperation(currentState);
          const previousPermissions = normalizePermissions(
            /** @type {readonly string[]|undefined} */(currentState?.permissions),
          );
          const nextPermissions = normalizePermissions(
            /** @type {readonly string[]|undefined} */(skillManifest.permissions),
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
              validatedInput.requestedTrustLevel
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
              manifestHash: skillManifest.manifestHash,
              provenance,
              reason:
                typeof installDecision.reason === "string" &&
                  installDecision.reason.length > 0
                  ? installDecision.reason
                  : "Skill install policy denied",
            };
          }

          if (requiresApproval && validatedInput.approvalTicket === undefined) {
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
              manifestHash: skillManifest.manifestHash,
              provenance,
              reason: "Skill install requires approval ticket for permission delta",
            };
          }

          const { enriched: enrichedCapabilities, missingMetadata } = skillRegistry.processMetadata(extensionId, Array.isArray(skillManifest.capabilities) ? skillManifest.capabilities : []);

          if (missingMetadata.length > 0) {
            skillRegistry.markBlocked(extensionId, missingMetadata);
            return {
              status: "rejected",
              extensionId,
              operation,
              trustLevel,
              lifecycleStatus: "rejected",
              lifecycleState: currentState?.lifecycleState ?? "blocked",
              permissionDelta,
              capabilityIds,
              manifestHash: skillManifest.manifestHash,
              provenance,
              reason: "Skill metadata required",
              missingMetadata
            };
          }

          // Unblock if it was blocked before and clear any pending proposal
          skillRegistry.unblock(extensionId);
          skillRegistry.clearProposed(extensionId);

          const lifecycleInput = {
            executionType: requestExecutionType,
            extensionId,
            extensionType: "skill",
            operation,
            trustLevel,
            sourceUri: validatedInput.sourceUri,
            requestedPermissions: nextPermissions,
            capabilities: enrichedCapabilities,
            metadata: {
              provenance,
              capabilityIds,
              manifestHash: skillManifest.manifestHash,
              ...(isPlainObject(validatedInput.metadata)
                ? validatedInput.metadata
                : {}),
            },
          };
          if (requestTraceId !== undefined) {
            lifecycleInput.traceId = requestTraceId;
          }
          if (validatedInput.approvalTicket !== undefined) {
            lifecycleInput.approvalTicket = validatedInput.approvalTicket;
          }

          const lifecycleResult = await extensionGateway.applyLifecycle(lifecycleInput);

          if (lifecycleResult.status !== "applied") {
            return {
              status: "rejected",
              extensionId,
              operation,
              trustLevel,
              lifecycleStatus: "rejected",
              lifecycleState: lifecycleResult.lifecycleState,
              permissionDelta,
              capabilityIds,
              manifestHash: skillManifest.manifestHash,
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
              capabilities: enrichedCapabilities
            },
          });
          extensionRegistry.upsert(extensionId, skillCapabilityAdapter);

          const shouldEnable =
            validatedInput.enableAfterInstall ??
            (autoEnableTrusted && trustLevel === "trusted");

          let finalLifecycleStatus = lifecycleResult.status;
          let finalLifecycleState = lifecycleResult.lifecycleState;
          let finalReason = undefined;

          if (shouldEnable && finalLifecycleState !== "enabled") {
            const enableInput = {
              executionType: requestExecutionType,
              extensionId,
              extensionType: "skill",
              operation: "enable",
            };
            if (requestTraceId !== undefined) {
              enableInput.traceId = requestTraceId;
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
          return {
            status,
            extensionId,
            operation,
            trustLevel,
            lifecycleStatus: finalLifecycleStatus,
            lifecycleState: finalLifecycleState,
            permissionDelta,
            capabilityIds,
            manifestHash: skillManifest.manifestHash,
            provenance,
            ...(finalReason ? { reason: finalReason } : {}),
          };
        },
      );
    },
  });
}
