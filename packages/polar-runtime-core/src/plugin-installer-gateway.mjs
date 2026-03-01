import {
  ContractValidationError,
  EXTENSION_TRUST_LEVELS,
  PLUGIN_INSTALLER_ACTION,
  RuntimeExecutionError,
  booleanField,
  createPluginInstallerContract,
  createStrictObjectSchema,
  enumField,
  jsonField,
  stringField,
} from "@polar/domain";

const pluginInstallerRequestSchema = createStrictObjectSchema({
  schemaId: "plugin.installer.gateway.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sourceUri: stringField({ minLength: 1 }),
    pluginDescriptor: jsonField(),
    expectedDescriptorHash: stringField({ minLength: 1, required: false }),
    requestedTrustLevel: enumField(EXTENSION_TRUST_LEVELS, {
      required: false,
    }),
    authBindings: jsonField({ required: false }),
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
function resolveInstallOperation(state) {
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
    throw new RuntimeExecutionError("Invalid plugin installer policy decision");
  }

  const normalizedDecision = {
    allowed: decision.allowed,
  };
  if (decision.reason !== undefined) {
    if (typeof decision.reason !== "string" || decision.reason.length === 0) {
      throw new RuntimeExecutionError("Invalid plugin installer policy reason");
    }
    normalizedDecision.reason = decision.reason;
  }

  return normalizedDecision;
}

/**
 * @param {string} sourceUri
 * @returns {boolean}
 */
function isRemoteSource(sourceUri) {
  return /^https?:\/\//i.test(sourceUri);
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
      reason: "Plugin source is blocked by source policy",
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
 * @param {unknown} manifest
 * @returns {{
 *   extensionId: string,
 *   descriptorHash: string,
 *   permissions: readonly string[],
 *   capabilityIds: readonly string[],
 *   manifest: Record<string, unknown>
 * }}
 */
function normalizePluginManifest(manifest) {
  if (!isPlainObject(manifest)) {
    throw new RuntimeExecutionError("Plugin descriptor mapping returned invalid manifest");
  }

  const extensionId = manifest.extensionId;
  const descriptorHash = manifest.descriptorHash;
  if (typeof extensionId !== "string" || extensionId.length === 0) {
    throw new RuntimeExecutionError("Plugin manifest is missing extensionId");
  }
  if (!extensionId.startsWith("plugin.")) {
    throw new RuntimeExecutionError("Plugin extensionId must use plugin.* namespace");
  }
  if (manifest.extensionType !== undefined && manifest.extensionType !== "plugin") {
    throw new RuntimeExecutionError("Plugin manifest extensionType must be plugin");
  }
  if (typeof descriptorHash !== "string" || descriptorHash.length === 0) {
    throw new RuntimeExecutionError("Plugin manifest is missing descriptorHash");
  }

  const permissions = normalizeStringList(
    /** @type {readonly string[]|undefined} */(manifest.permissions),
  );

  const capabilityCandidates = Array.isArray(manifest.capabilities)
    ? manifest.capabilities
    : [];
  const capabilities = [];
  const knownCapabilityIds = new Set();
  for (const capabilityCandidate of capabilityCandidates) {
    if (!isPlainObject(capabilityCandidate)) {
      throw new RuntimeExecutionError("Plugin capability entries must be plain objects");
    }

    const capabilityId = capabilityCandidate.capabilityId;
    if (typeof capabilityId !== "string" || capabilityId.length === 0) {
      throw new RuntimeExecutionError("Plugin capability entries require capabilityId");
    }

    if (knownCapabilityIds.has(capabilityId)) {
      throw new RuntimeExecutionError(`Duplicate plugin capability id: ${capabilityId}`);
    }

    knownCapabilityIds.add(capabilityId);

    const capability = {
      capabilityId,
      riskLevel: capabilityCandidate.riskLevel || "unknown",
      sideEffects: capabilityCandidate.sideEffects || "unknown",
      dataEgress: capabilityCandidate.dataEgress || "unknown",
    };
    if (typeof capabilityCandidate.description === "string") {
      capability.description = capabilityCandidate.description;
    }
    capabilities.push(Object.freeze(capability));
  }

  if (capabilities.length === 0) {
    throw new RuntimeExecutionError("Plugin manifest must include at least one capability");
  }
  capabilities.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const capabilityIds = Object.freeze(capabilities.map(c => c.capabilityId));

  return Object.freeze({
    extensionId,
    descriptorHash,
    permissions,
    capabilityIds,
    capabilities: Object.freeze(capabilities),
    manifest: Object.freeze({
      ...manifest,
      extensionType: "plugin",
    }),
  });
}

/**
 * @param {unknown} value
 * @returns {{
 *   ok: boolean,
 *   status: string,
 *   requiredSchemes: readonly string[],
 *   providedSchemes: readonly string[],
 *   missingSchemes: readonly string[],
 *   reason?: string
 * }}
 */
function normalizeAuthBinding(value) {
  if (!isPlainObject(value) || typeof value.ok !== "boolean") {
    throw new RuntimeExecutionError("Plugin auth binding verifier returned invalid result");
  }

  const requiredSchemes = normalizeStringList(
    /** @type {readonly string[]|undefined} */(value.requiredSchemes),
  );
  const providedSchemes = normalizeStringList(
    /** @type {readonly string[]|undefined} */(value.providedSchemes),
  );
  const missingSchemes = normalizeStringList(
    /** @type {readonly string[]|undefined} */(value.missingSchemes),
  );
  const status =
    typeof value.status === "string" && value.status.length > 0
      ? value.status
      : value.ok
        ? "bound"
        : "missing";

  const normalized = {
    ok: value.ok,
    status,
    requiredSchemes,
    providedSchemes,
    missingSchemes,
  };
  if (value.reason !== undefined) {
    if (typeof value.reason !== "string" || value.reason.length === 0) {
      throw new RuntimeExecutionError("Plugin auth binding reason must be a non-empty string");
    }
    normalized.reason = value.reason;
  }

  return Object.freeze(normalized);
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerPluginInstallerContract(contractRegistry) {
  if (
    !contractRegistry.has(
      PLUGIN_INSTALLER_ACTION.actionId,
      PLUGIN_INSTALLER_ACTION.version,
    )
  ) {
    contractRegistry.register(createPluginInstallerContract());
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
 *   pluginAdapter: {
 *     mapPluginDescriptor: (request: Record<string, unknown>) => Record<string, unknown>,
 *     verifyPluginAuthBindings: (request: Record<string, unknown>) => Record<string, unknown>,
 *     createPluginCapabilityAdapter: (config: Record<string, unknown>) => { executeCapability: (request: Record<string, unknown>) => Promise<unknown>|unknown }
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
export function createPluginInstallerGateway({
  middlewarePipeline,
  extensionGateway,
  extensionRegistry,
  pluginAdapter,
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
    typeof pluginAdapter !== "object" ||
    pluginAdapter === null ||
    typeof pluginAdapter.mapPluginDescriptor !== "function" ||
    typeof pluginAdapter.verifyPluginAuthBindings !== "function" ||
    typeof pluginAdapter.createPluginCapabilityAdapter !== "function"
  ) {
    throw new RuntimeExecutionError(
      "pluginAdapter must expose mapPluginDescriptor, verifyPluginAuthBindings, and createPluginCapabilityAdapter",
    );
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

  const evaluateInstall = policy.evaluateInstall;
  if (evaluateInstall !== undefined && typeof evaluateInstall !== "function") {
    throw new RuntimeExecutionError(
      "policy.evaluateInstall must be a function when provided",
    );
  }

  const autoEnableTrusted = policy.autoEnableTrusted === true;

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async install(request) {
      const validation = pluginInstallerRequestSchema.validate(request);
      if (!validation.ok) {
        throw new ContractValidationError("Invalid plugin installer gateway request", {
          schemaId: pluginInstallerRequestSchema.schemaId,
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
          actionId: PLUGIN_INSTALLER_ACTION.actionId,
          version: PLUGIN_INSTALLER_ACTION.version,
          input: (() => {
            const input = {
              sourceUri: parsed.sourceUri,
              pluginDescriptor: parsed.pluginDescriptor,
            };
            if (parsed.expectedDescriptorHash !== undefined) {
              input.expectedDescriptorHash = parsed.expectedDescriptorHash;
            }
            if (parsed.requestedTrustLevel !== undefined) {
              input.requestedTrustLevel = parsed.requestedTrustLevel;
            }
            if (parsed.authBindings !== undefined) {
              input.authBindings = parsed.authBindings;
            }
            if (parsed.approvalTicket !== undefined) {
              input.approvalTicket = parsed.approvalTicket;
            }
            if (parsed.enableAfterInstall !== undefined) {
              input.enableAfterInstall = parsed.enableAfterInstall;
            }
            if (parsed.metadata !== undefined) {
              input.metadata = parsed.metadata;
            }

            return input;
          })(),
        },
        async (validatedInput) => {
          const authBindings = isPlainObject(validatedInput.authBindings)
            ? validatedInput.authBindings
            : {};

          let pluginManifest;
          try {
            pluginManifest = normalizePluginManifest(
              pluginAdapter.mapPluginDescriptor({
                pluginDescriptor: validatedInput.pluginDescriptor,
              }),
            );
          } catch (error) {
            throw new ContractValidationError("Invalid plugin descriptor", {
              actionId: PLUGIN_INSTALLER_ACTION.actionId,
              version: PLUGIN_INSTALLER_ACTION.version,
              cause: error instanceof Error ? error.message : String(error),
            });
          }

          const extensionId = pluginManifest.extensionId;
          const capabilityIds = pluginManifest.capabilityIds;
          const descriptorHash = pluginManifest.descriptorHash;
          const currentState = extensionGateway.getState(extensionId);
          const operation = resolveInstallOperation(currentState);
          const previousPermissions = normalizeStringList(
            /** @type {readonly string[]|undefined} */(currentState?.permissions),
          );
          const nextPermissions = pluginManifest.permissions;
          const permissionDelta = createPermissionDelta(
            previousPermissions,
            nextPermissions,
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
              extensionId,
              operation,
              trustLevel: "blocked",
              lifecycleStatus: "rejected",
              lifecycleState: currentState?.lifecycleState ?? "blocked",
              permissionDelta,
              capabilityIds,
              descriptorHash,
              authBinding: {
                ok: false,
                status: "blocked",
                requiredSchemes: [],
                providedSchemes: [],
                missingSchemes: [],
                reason: sourcePolicy.reason,
              },
              reason: sourcePolicy.reason,
            };
          }

          const trustLevel =
            /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
              validatedInput.requestedTrustLevel
            ) ?? sourcePolicy.trustLevelRecommendation;

          if (
            validatedInput.expectedDescriptorHash !== undefined &&
            validatedInput.expectedDescriptorHash !== descriptorHash
          ) {
            return {
              status: "rejected",
              extensionId,
              operation,
              trustLevel,
              lifecycleStatus: "rejected",
              lifecycleState:
                currentState?.lifecycleState ??
                (trustLevel === "blocked" ? "blocked" : "installed"),
              permissionDelta,
              capabilityIds,
              descriptorHash,
              authBinding: {
                ok: false,
                status: "mismatch",
                requiredSchemes: [],
                providedSchemes: [],
                missingSchemes: [],
              },
              reason: "Plugin descriptor hash mismatch",
            };
          }

          let authBinding;
          try {
            authBinding = normalizeAuthBinding(
              pluginAdapter.verifyPluginAuthBindings({
                pluginManifest: pluginManifest.manifest,
                authBindings,
              }),
            );
          } catch (error) {
            return {
              status: "rejected",
              extensionId,
              operation,
              trustLevel,
              lifecycleStatus: "rejected",
              lifecycleState:
                currentState?.lifecycleState ??
                (trustLevel === "blocked" ? "blocked" : "installed"),
              permissionDelta,
              capabilityIds,
              descriptorHash,
              authBinding: {
                ok: false,
                status: "invalid",
                requiredSchemes: [],
                providedSchemes: Object.keys(authBindings).sort((left, right) =>
                  left.localeCompare(right),
                ),
                missingSchemes: [],
                reason: error instanceof Error ? error.message : String(error),
              },
              reason: "Plugin auth binding verification failed",
            };
          }

          if (!authBinding.ok) {
            return {
              status: "rejected",
              extensionId,
              operation,
              trustLevel,
              lifecycleStatus: "rejected",
              lifecycleState:
                currentState?.lifecycleState ??
                (trustLevel === "blocked" ? "blocked" : "installed"),
              permissionDelta,
              capabilityIds,
              descriptorHash,
              authBinding,
              reason:
                authBinding.reason ??
                "Plugin auth bindings are missing required schemes",
            };
          }

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
              lifecycleState:
                currentState?.lifecycleState ??
                (trustLevel === "blocked" ? "blocked" : "installed"),
              permissionDelta,
              capabilityIds,
              descriptorHash,
              authBinding,
              reason:
                "Plugin install requires approval ticket for permission delta",
            };
          }

          const installDecision = normalizePolicyDecision(
            evaluateInstall &&
            (await evaluateInstall({
              extensionId,
              operation,
              trustLevel,
              sourcePolicy: sourcePolicyMetadata,
              authBinding,
              permissionDelta,
              descriptorHash,
              capabilityIds,
              currentState,
            })),
          );

          if (!installDecision.allowed) {
            return {
              status: "rejected",
              extensionId,
              operation,
              trustLevel,
              lifecycleStatus: "rejected",
              lifecycleState:
                currentState?.lifecycleState ??
                (trustLevel === "blocked" ? "blocked" : "installed"),
              permissionDelta,
              capabilityIds,
              descriptorHash,
              authBinding,
              reason: installDecision.reason ?? "Plugin install policy denied",
            };
          }

          const lifecycleInput = {
            executionType: requestExecutionType,
            extensionId,
            extensionType: "plugin",
            operation,
            trustLevel,
            sourceUri: validatedInput.sourceUri,
            requestedPermissions: nextPermissions,
            capabilities: pluginManifest.capabilities,
            metadata: {
              descriptorHash,
              capabilityIds,
              sourcePolicy: sourcePolicyMetadata,
              authBinding,
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
              descriptorHash,
              authBinding,
              reason:
                typeof lifecycleResult.reason === "string" &&
                  lifecycleResult.reason.length > 0
                  ? lifecycleResult.reason
                  : "Plugin lifecycle transition rejected",
            };
          }

          const pluginCapabilityAdapter = pluginAdapter.createPluginCapabilityAdapter({
            pluginManifest: pluginManifest.manifest,
            authBindings,
          });
          extensionRegistry.upsert(extensionId, pluginCapabilityAdapter);

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
              extensionType: "plugin",
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
                  : "Plugin enable transition rejected";
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
            descriptorHash,
            authBinding,
            ...(finalReason ? { reason: finalReason } : {}),
          };
        },
      );
    },
  });
}
