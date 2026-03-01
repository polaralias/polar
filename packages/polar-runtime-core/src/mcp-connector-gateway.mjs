import {
  ContractValidationError,
  EXTENSION_TRUST_LEVELS,
  MCP_CONNECTOR_ACTION,
  RuntimeExecutionError,
  createMcpConnectorContract,
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  stringArrayField,
  stringField,
} from "@polar/domain";

const mcpConnectorRequestSchema = createStrictObjectSchema({
  schemaId: "mcp.connector.gateway.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sourceUri: stringField({ minLength: 1 }),
    serverId: stringField({ minLength: 1 }),
    connectionConfig: jsonField({ required: false }),
    expectedCatalogHash: stringField({ minLength: 1, required: false }),
    expectedToolIds: stringArrayField({ minItems: 0, required: false }),
    requestedTrustLevel: enumField(EXTENSION_TRUST_LEVELS, {
      required: false,
    }),
    approvalTicket: stringField({ minLength: 1, required: false }),
    enableAfterSync: booleanField({ required: false }),
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
function normalizeStringList(value) {
  const items = value ?? [];
  const deduped = new Set();
  for (const item of items) {
    if (typeof item === "string" && item.length > 0) {
      deduped.add(item);
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
function resolveSyncOperation(state) {
  if (!state || state.lifecycleState === "removed") {
    return "install";
  }

  return "upgrade";
}

/**
 * @param {unknown} decision
 * @returns {{ allowed: boolean, reason?: string }}
 */
function normalizePolicyDecision(decision) {
  if (decision === undefined) {
    return {
      allowed: true,
    };
  }

  if (typeof decision === "boolean") {
    return {
      allowed: decision,
    };
  }

  if (!isPlainObject(decision) || typeof decision.allowed !== "boolean") {
    throw new RuntimeExecutionError("Invalid MCP connector policy decision");
  }

  const normalized = {
    allowed: decision.allowed,
  };
  if (decision.reason !== undefined) {
    if (typeof decision.reason !== "string" || decision.reason.length === 0) {
      throw new RuntimeExecutionError("Invalid MCP connector policy reason");
    }
    normalized.reason = decision.reason;
  }

  return normalized;
}

/**
 * @param {string} sourceUri
 * @returns {boolean}
 */
function isRemoteSource(sourceUri) {
  return /^https?:\/\//i.test(sourceUri);
}

/**
 * @param {string} value
 * @returns {string}
 */
function toSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {string} serverId
 * @returns {string}
 */
function defaultMcpExtensionId(serverId) {
  return `mcp.${toSlug(serverId)}`;
}

/**
 * @param {string} sourceUri
 * @param {readonly string[]} prefixes
 * @returns {boolean}
 */
function hasPrefixMatch(sourceUri, prefixes) {
  return prefixes.some((prefix) => sourceUri.startsWith(prefix));
}

/**
 * @param {{
 *   sourceUri: string,
 *   trustedSourcePrefixes: readonly string[],
 *   blockedSourcePrefixes: readonly string[]
 * }} request
 * @returns {{ allowed: boolean, trustLevelRecommendation: "trusted"|"reviewed"|"sandboxed"|"blocked", sourceType: "remote"|"local", reason?: string }}
 */
function evaluateSourcePolicy({
  sourceUri,
  trustedSourcePrefixes,
  blockedSourcePrefixes,
}) {
  const sourceType = isRemoteSource(sourceUri) ? "remote" : "local";
  if (hasPrefixMatch(sourceUri, blockedSourcePrefixes)) {
    return {
      allowed: false,
      trustLevelRecommendation: "blocked",
      sourceType,
      reason: "MCP source is blocked by source policy",
    };
  }

  if (hasPrefixMatch(sourceUri, trustedSourcePrefixes)) {
    return {
      allowed: true,
      trustLevelRecommendation: "trusted",
      sourceType,
    };
  }

  if (sourceType === "local") {
    return {
      allowed: true,
      trustLevelRecommendation: "reviewed",
      sourceType,
    };
  }

  return {
    allowed: true,
    trustLevelRecommendation: "sandboxed",
    sourceType,
  };
}

/**
 * @param {Record<string, unknown>} rawManifest
 * @param {string} serverId
 * @returns {Record<string, unknown>}
 */
function normalizeMcpManifest(rawManifest, serverId) {
  if (!isPlainObject(rawManifest)) {
    throw new RuntimeExecutionError("MCP tool catalog import returned invalid manifest");
  }

  const extensionId =
    typeof rawManifest.extensionId === "string" && rawManifest.extensionId.length > 0
      ? rawManifest.extensionId
      : defaultMcpExtensionId(serverId);
  const catalogHash = rawManifest.catalogHash;
  if (typeof catalogHash !== "string" || catalogHash.length === 0) {
    throw new RuntimeExecutionError("MCP catalog import missing catalogHash");
  }

  const permissions = normalizeStringList(
    /** @type {readonly string[]|undefined} */(rawManifest.permissions),
  );

  const capabilities = Array.isArray(rawManifest.capabilities)
    ? rawManifest.capabilities
    : [];
  if (capabilities.length === 0) {
    throw new RuntimeExecutionError("MCP catalog import must include at least one capability");
  }

  const normalizedCapabilities = [];
  const capabilityIds = [];
  const toolIds = [];
  const knownCapabilityIds = new Set();
  for (const capabilityCandidate of capabilities) {
    if (!isPlainObject(capabilityCandidate)) {
      throw new RuntimeExecutionError("MCP capability entries must be plain objects");
    }

    const capabilityId = capabilityCandidate.capabilityId;
    const toolId = capabilityCandidate.toolId;
    if (
      typeof capabilityId !== "string" ||
      capabilityId.length === 0 ||
      typeof toolId !== "string" ||
      toolId.length === 0
    ) {
      throw new RuntimeExecutionError(
        "MCP capability entries require non-empty capabilityId and toolId",
      );
    }

    if (knownCapabilityIds.has(capabilityId)) {
      throw new RuntimeExecutionError(`Duplicate MCP capability id: ${capabilityId}`);
    }
    knownCapabilityIds.add(capabilityId);

    capabilityIds.push(capabilityId);
    toolIds.push(toolId);
    normalizedCapabilities.push(Object.freeze({ ...capabilityCandidate }));
  }

  capabilityIds.sort((left, right) => left.localeCompare(right));
  toolIds.sort((left, right) => left.localeCompare(right));

  return Object.freeze({
    ...rawManifest,
    extensionId,
    extensionType: "mcp",
    serverId:
      typeof rawManifest.serverId === "string" && rawManifest.serverId.length > 0
        ? rawManifest.serverId
        : serverId,
    catalogHash,
    permissions,
    capabilities: Object.freeze(normalizedCapabilities),
    capabilityIds: Object.freeze(capabilityIds),
    toolIds: Object.freeze(toolIds),
  });
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerMcpConnectorContract(contractRegistry) {
  if (
    !contractRegistry.has(MCP_CONNECTOR_ACTION.actionId, MCP_CONNECTOR_ACTION.version)
  ) {
    contractRegistry.register(createMcpConnectorContract());
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
 *   mcpAdapter: {
 *     probeConnection: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     importToolCatalog: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     createCapabilityAdapter: (manifest: Record<string, unknown>) => { executeCapability: (request: Record<string, unknown>) => Promise<unknown>|unknown }
 *   },
 *   policy?: {
 *     trustedSourcePrefixes?: readonly string[],
 *     blockedSourcePrefixes?: readonly string[],
 *     approvalRequiredPermissions?: readonly string[],
 *     evaluateSync?: (request: Record<string, unknown>) => Promise<{ allowed: boolean, reason?: string }|boolean|void>|{ allowed: boolean, reason?: string }|boolean|void,
 *     autoEnableTrusted?: boolean
 *   },
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createMcpConnectorGateway({
  middlewarePipeline,
  extensionGateway,
  extensionRegistry,
  mcpAdapter,
  skillRegistry,
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
    typeof mcpAdapter !== "object" ||
    mcpAdapter === null ||
    typeof mcpAdapter.probeConnection !== "function" ||
    typeof mcpAdapter.importToolCatalog !== "function" ||
    typeof mcpAdapter.createCapabilityAdapter !== "function"
  ) {
    throw new RuntimeExecutionError(
      "mcpAdapter must expose probeConnection, importToolCatalog, and createCapabilityAdapter",
    );
  }

  const resolvedSkillRegistry = skillRegistry ?? {
    submitOverride() { },
    processMetadata(extensionId, capabilities) {
      return {
        enriched: Array.isArray(capabilities) ? [...capabilities] : [],
        missingMetadata: []
      };
    },
    markBlocked() { },
    unblock() { },
    syncLifecycleState() { }
  };

  if (
    typeof resolvedSkillRegistry !== "object" ||
    resolvedSkillRegistry === null ||
    typeof resolvedSkillRegistry.submitOverride !== "function" ||
    typeof resolvedSkillRegistry.processMetadata !== "function"
  ) {
    throw new RuntimeExecutionError("skillRegistry is required");
  }

  if (typeof policy !== "object" || policy === null) {
    throw new RuntimeExecutionError("policy must be an object when provided");
  }

  const trustedSourcePrefixes = normalizeStringList(
    /** @type {readonly string[]|undefined} */(policy.trustedSourcePrefixes),
  );
  const blockedSourcePrefixes = normalizeStringList(
    /** @type {readonly string[]|undefined} */(policy.blockedSourcePrefixes),
  );
  const defaultApprovalRequiredPermissions = normalizeStringList(
    /** @type {readonly string[]|undefined} */(policy.approvalRequiredPermissions),
  );
  const evaluateSync = policy.evaluateSync;
  if (evaluateSync !== undefined && typeof evaluateSync !== "function") {
    throw new RuntimeExecutionError("policy.evaluateSync must be a function when provided");
  }
  const autoEnableTrusted = policy.autoEnableTrusted === true;

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async sync(request) {
      const validation = mcpConnectorRequestSchema.validate(request);
      if (!validation.ok) {
        throw new ContractValidationError("Invalid MCP connector gateway request", {
          schemaId: mcpConnectorRequestSchema.schemaId,
          errors: validation.errors ?? [],
        });
      }

      const parsed = /** @type {Record<string, unknown>} */ (validation.value);
      const requestExecutionType =
        /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
          parsed.executionType
        ) ?? defaultExecutionType;
      const requestTraceId = /** @type {string|undefined} */ (parsed.traceId);

      return middlewarePipeline.run(
        {
          executionType: requestExecutionType,
          traceId: requestTraceId,
          actionId: MCP_CONNECTOR_ACTION.actionId,
          version: MCP_CONNECTOR_ACTION.version,
          input: (() => {
            const input = {
              sourceUri: parsed.sourceUri,
              serverId: parsed.serverId,
            };
            if (parsed.connectionConfig !== undefined) {
              input.connectionConfig = parsed.connectionConfig;
            }
            if (parsed.expectedCatalogHash !== undefined) {
              input.expectedCatalogHash = parsed.expectedCatalogHash;
            }
            if (parsed.expectedToolIds !== undefined) {
              input.expectedToolIds = parsed.expectedToolIds;
            }
            if (parsed.requestedTrustLevel !== undefined) {
              input.requestedTrustLevel = parsed.requestedTrustLevel;
            }
            if (parsed.approvalTicket !== undefined) {
              input.approvalTicket = parsed.approvalTicket;
            }
            if (parsed.enableAfterSync !== undefined) {
              input.enableAfterSync = parsed.enableAfterSync;
            }
            if (parsed.metadata !== undefined) {
              input.metadata = parsed.metadata;
            }

            return input;
          })(),
        },
        async (validatedInput) => {
          const defaultExtensionId = defaultMcpExtensionId(validatedInput.serverId);
          const currentStateBeforeCatalog = extensionGateway.getState(defaultExtensionId);
          const defaultOperation = resolveSyncOperation(currentStateBeforeCatalog);
          const defaultPreviousPermissions = normalizeStringList(
            /** @type {readonly string[]|undefined} */(
              currentStateBeforeCatalog?.permissions
            ),
          );

          const sourcePolicy = evaluateSourcePolicy({
            sourceUri: validatedInput.sourceUri,
            trustedSourcePrefixes,
            blockedSourcePrefixes,
          });
          const sourcePolicyMetadata = Object.freeze({
            sourceUri: validatedInput.sourceUri,
            sourceType: sourcePolicy.sourceType,
            trustLevelRecommendation: sourcePolicy.trustLevelRecommendation,
          });

          if (!sourcePolicy.allowed) {
            return {
              status: "rejected",
              extensionId: defaultExtensionId,
              operation: defaultOperation,
              trustLevel: "blocked",
              lifecycleStatus: "rejected",
              lifecycleState:
                currentStateBeforeCatalog?.lifecycleState ?? "blocked",
              permissionDelta: createPermissionDelta(
                defaultPreviousPermissions,
                defaultPreviousPermissions,
              ),
              capabilityIds: [],
              catalogHash: "unavailable",
              health: {
                healthy: false,
                status: "blocked",
                reason: sourcePolicy.reason,
                sourcePolicy: sourcePolicyMetadata,
              },
              reason: sourcePolicy.reason,
            };
          }

          const health = await mcpAdapter.probeConnection({
            sourceUri: validatedInput.sourceUri,
            serverId: validatedInput.serverId,
            connectionConfig: validatedInput.connectionConfig,
            metadata: validatedInput.metadata,
          });
          if (!isPlainObject(health)) {
            throw new RuntimeExecutionError("MCP adapter probeConnection returned invalid result");
          }

          if (health.healthy !== true) {
            return {
              status: "rejected",
              extensionId: defaultExtensionId,
              operation: defaultOperation,
              trustLevel: sourcePolicy.trustLevelRecommendation,
              lifecycleStatus: "rejected",
              lifecycleState:
                currentStateBeforeCatalog?.lifecycleState ?? "installed",
              permissionDelta: createPermissionDelta(
                defaultPreviousPermissions,
                defaultPreviousPermissions,
              ),
              capabilityIds: [],
              catalogHash: "unavailable",
              health,
              reason: "MCP connection health probe failed",
            };
          }

          const importedCatalog = await mcpAdapter.importToolCatalog({
            sourceUri: validatedInput.sourceUri,
            serverId: validatedInput.serverId,
            connectionConfig: validatedInput.connectionConfig,
            metadata: validatedInput.metadata,
          });
          const mcpManifest = normalizeMcpManifest(
            importedCatalog,
            validatedInput.serverId,
          );

          const extensionId = /** @type {string} */ (mcpManifest.extensionId);
          const capabilityIds = /** @type {readonly string[]} */ (mcpManifest.capabilityIds);
          const toolIds = /** @type {readonly string[]} */ (mcpManifest.toolIds);
          const catalogHash = /** @type {string} */ (mcpManifest.catalogHash);
          const nextPermissions = normalizeStringList(
            /** @type {readonly string[]|undefined} */(mcpManifest.permissions),
          );

          if (
            validatedInput.expectedCatalogHash !== undefined &&
            validatedInput.expectedCatalogHash !== catalogHash
          ) {
            return {
              status: "rejected",
              extensionId,
              operation: extensionGateway.getState(extensionId)
                ? "upgrade"
                : "install",
              trustLevel: sourcePolicy.trustLevelRecommendation,
              lifecycleStatus: "rejected",
              lifecycleState:
                extensionGateway.getState(extensionId)?.lifecycleState ??
                "installed",
              permissionDelta: createPermissionDelta(
                normalizeStringList(
                  /** @type {readonly string[]|undefined} */(
                    extensionGateway.getState(extensionId)?.permissions
                  ),
                ),
                nextPermissions,
              ),
              capabilityIds,
              catalogHash,
              health,
              reason: "MCP catalog hash mismatch",
            };
          }

          if (validatedInput.expectedToolIds !== undefined) {
            const expectedToolIds = normalizeStringList(
              validatedInput.expectedToolIds,
            );
            const actualToolIds = normalizeStringList(toolIds);
            if (
              expectedToolIds.length !== actualToolIds.length ||
              expectedToolIds.some((toolId, index) => toolId !== actualToolIds[index])
            ) {
              return {
                status: "rejected",
                extensionId,
                operation: extensionGateway.getState(extensionId)
                  ? "upgrade"
                  : "install",
                trustLevel: sourcePolicy.trustLevelRecommendation,
                lifecycleStatus: "rejected",
                lifecycleState:
                  extensionGateway.getState(extensionId)?.lifecycleState ??
                  "installed",
                permissionDelta: createPermissionDelta(
                  normalizeStringList(
                    /** @type {readonly string[]|undefined} */(
                      extensionGateway.getState(extensionId)?.permissions
                    ),
                  ),
                  nextPermissions,
                ),
                capabilityIds,
                catalogHash,
                health,
                reason: "MCP expected tool ids mismatch",
              };
            }
          }

          const currentState = extensionGateway.getState(extensionId);
          const operation = resolveSyncOperation(currentState);
          const previousPermissions = normalizeStringList(
            /** @type {readonly string[]|undefined} */(currentState?.permissions),
          );
          const permissionDelta = createPermissionDelta(previousPermissions, nextPermissions);

          const trustLevel =
            /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
              validatedInput.requestedTrustLevel
            ) ?? sourcePolicy.trustLevelRecommendation;

          const requiresApproval = permissionDelta.added.some((permission) =>
            defaultApprovalRequiredPermissions.includes(permission),
          );
          if (requiresApproval && validatedInput.approvalTicket === undefined) {
            return {
              status: "rejected",
              extensionId,
              operation,
              trustLevel,
              lifecycleStatus: "rejected",
              lifecycleState: currentState?.lifecycleState ?? "installed",
              permissionDelta,
              capabilityIds,
              catalogHash,
              health,
              reason: "MCP sync requires approval ticket for permission delta",
            };
          }

          const { enriched: enrichedCapabilities, missingMetadata } = resolvedSkillRegistry.processMetadata(extensionId, Array.isArray(mcpManifest.capabilities) ? mcpManifest.capabilities : []);

          if (missingMetadata.length > 0) {
            resolvedSkillRegistry.markBlocked(extensionId, missingMetadata);
            return {
              status: "rejected",
              extensionId,
              operation,
              trustLevel,
              lifecycleStatus: "rejected",
              lifecycleState: currentState?.lifecycleState ?? "blocked",
              permissionDelta,
              capabilityIds,
              catalogHash,
              health,
              reason: "MCP metadata required",
              missingMetadata
            };
          }

          resolvedSkillRegistry.unblock(extensionId);

          const syncDecision = normalizePolicyDecision(
            evaluateSync &&
            (await evaluateSync({
              extensionId,
              operation,
              trustLevel,
              health,
              sourcePolicy: sourcePolicyMetadata,
              permissionDelta,
              catalogHash,
              capabilityIds,
              currentState,
            })),
          );
          if (!syncDecision.allowed) {
            return {
              status: "rejected",
              extensionId,
              operation,
              trustLevel,
              lifecycleStatus: "rejected",
              lifecycleState: currentState?.lifecycleState ?? "installed",
              permissionDelta,
              capabilityIds,
              catalogHash,
              health,
              reason: syncDecision.reason ?? "MCP sync policy denied",
            };
          }

          const lifecycleInput = {
            executionType: requestExecutionType,
            extensionId,
            extensionType: "mcp",
            operation,
            trustLevel,
            sourceUri: validatedInput.sourceUri,
            requestedPermissions: nextPermissions,
            capabilities: enrichedCapabilities,
            metadata: {
              serverId: validatedInput.serverId,
              health,
              sourcePolicy: sourcePolicyMetadata,
              catalogHash,
              capabilityIds,
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
              catalogHash,
              health,
              reason:
                typeof lifecycleResult.reason === "string" &&
                  lifecycleResult.reason.length > 0
                  ? lifecycleResult.reason
                  : "MCP lifecycle transition rejected",
            };
          }

          const mcpCapabilityAdapter = mcpAdapter.createCapabilityAdapter({
            ...mcpManifest,
            capabilities: enrichedCapabilities
          });
          extensionRegistry.upsert(extensionId, mcpCapabilityAdapter);

          const shouldEnable =
            validatedInput.enableAfterSync ??
            (autoEnableTrusted && trustLevel === "trusted");

          let finalLifecycleStatus = lifecycleResult.status;
          let finalLifecycleState = lifecycleResult.lifecycleState;
          let finalReason = undefined;

          if (shouldEnable && finalLifecycleState !== "enabled") {
            const enableInput = {
              executionType: requestExecutionType,
              extensionId,
              extensionType: "mcp",
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
                  : "MCP enable transition rejected";
            }
          }

          const status = finalLifecycleStatus === "applied" ? "applied" : "rejected";
          if (typeof resolvedSkillRegistry.syncLifecycleState === "function") {
            resolvedSkillRegistry.syncLifecycleState({
              extensionId,
              extensionType: "mcp",
              lifecycleState: lifecycleResult.lifecycleState,
              capabilities: enrichedCapabilities,
              authoritySource: "mcp_sync_applied",
            });
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
            catalogHash,
            health,
            ...(finalReason ? { reason: finalReason } : {}),
          };
        },
      );
    },
  });
}
