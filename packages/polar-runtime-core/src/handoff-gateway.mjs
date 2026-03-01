import {
  ContractValidationError,
  HANDOFF_ACTION,
  PolarTypedError,
  RuntimeExecutionError,
  createHandoffContract,
  createStrictObjectSchema,
  enumField,
  jsonField,
  stringArrayField,
  stringField,
} from "@polar/domain";
import { createRoutingPolicyEngine } from "./routing-policy-engine.mjs";

const handoffRequestSchema = createStrictObjectSchema({
  schemaId: "agent.handoff.gateway.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    preferredMode: enumField(["direct", "delegate", "fanout-fanin"], {
      required: false,
    }),
    sourceAgentId: stringField({ minLength: 1 }),
    targetAgentId: stringField({ minLength: 1, required: false }),
    targetAgentIds: stringArrayField({ minItems: 1, required: false }),
    reason: stringField({ minLength: 1 }),
    sessionId: stringField({ minLength: 1 }),
    workspaceId: stringField({ minLength: 1, required: false }),
    userId: stringField({ minLength: 1 }),
    profileId: stringField({ minLength: 1, required: false }),
    defaultProfileId: stringField({ minLength: 1, required: false }),
    capabilityScope: jsonField(),
    payload: jsonField(),
    policyContext: jsonField({ required: false }),
    budgetContext: jsonField({ required: false }),
    traceMetadata: jsonField({ required: false }),
  },
});

const profileResolutionResultSchema = createStrictObjectSchema({
  schemaId: "agent.handoff.gateway.profile-resolution.result",
  fields: {
    status: enumField(["resolved", "not_found"]),
    profileId: stringField({ minLength: 1, required: false }),
    resolvedScope: enumField(["session", "workspace", "global", "default"], {
      required: false,
    }),
    reason: stringField({ minLength: 1, required: false }),
    profileConfig: jsonField({ required: false }),
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
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {readonly string[]|undefined}
 */
function normalizeOptionalStringArray(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new ContractValidationError(`Invalid ${fieldName} capability scope`, {
      fieldName,
      reason: "must be an array",
    });
  }

  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "string" || item.length === 0) {
      throw new ContractValidationError(`Invalid ${fieldName} capability scope entry`, {
        fieldName,
        index,
        reason: "must be a non-empty string",
      });
    }

    normalized.push(item);
  }

  return Object.freeze(normalized);
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number|undefined}
 */
function normalizeOptionalNonNegativeInt(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new ContractValidationError(`Invalid ${fieldName}`, {
      fieldName,
      reason: "must be an integer >= 0",
    });
  }

  return value;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function parseProfileResolutionResult(value) {
  const validation = profileResolutionResultSchema.validate(value);
  if (!validation.ok) {
    throw new RuntimeExecutionError("Invalid handoff profile resolution output", {
      schemaId: profileResolutionResultSchema.schemaId,
      errors: validation.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {Record<string, unknown>} request
 * @returns {"direct"|"delegate"|"fanout-fanin"}
 */
function deriveRequestedMode(request) {
  const preferredMode = /** @type {"direct"|"delegate"|"fanout-fanin"|undefined} */ (
    request.preferredMode
  );
  const targetAgentId = /** @type {string|undefined} */ (request.targetAgentId);
  const targetAgentIds = /** @type {readonly string[]|undefined} */ (request.targetAgentIds);

  if (preferredMode !== undefined) {
    return preferredMode;
  }

  if (Array.isArray(targetAgentIds) && targetAgentIds.length > 1) {
    return "fanout-fanin";
  }

  if (typeof targetAgentId === "string" && targetAgentId.length > 0) {
    return "delegate";
  }

  if (Array.isArray(targetAgentIds) && targetAgentIds.length === 1) {
    return "delegate";
  }

  return "direct";
}

/**
 * @param {Record<string, unknown>} request
 * @returns {string|undefined}
 */
function deriveRequestedDelegateTarget(request) {
  const targetAgentId = /** @type {string|undefined} */ (request.targetAgentId);
  if (typeof targetAgentId === "string" && targetAgentId.length > 0) {
    return targetAgentId;
  }

  const targetAgentIds = /** @type {readonly string[]|undefined} */ (request.targetAgentIds);
  if (Array.isArray(targetAgentIds) && targetAgentIds.length > 0) {
    return targetAgentIds[0];
  }

  return undefined;
}

/**
 * @param {Record<string, unknown>} request
 * @returns {number}
 */
function deriveRequestedTargetCount(request) {
  const mode = deriveRequestedMode(request);
  if (mode === "direct") {
    return 0;
  }

  if (mode === "delegate") {
    return deriveRequestedDelegateTarget(request) === undefined ? 0 : 1;
  }

  const targetAgentIds = /** @type {readonly string[]|undefined} */ (request.targetAgentIds);
  return Array.isArray(targetAgentIds) ? targetAgentIds.length : 0;
}

/**
 * @param {Record<string, unknown>} route
 * @returns {number}
 */
function deriveResolvedTargetCount(route) {
  if (route.mode === "direct") {
    return 0;
  }

  if (route.mode === "delegate") {
    return typeof route.targetAgentId === "string" ? 1 : 0;
  }

  if (Array.isArray(route.targetAgentIds)) {
    return route.targetAgentIds.length;
  }

  return 0;
}

/**
 * @param {unknown} profileConfig
 * @returns {Record<string, unknown>|undefined}
 */
function deriveProfileRoutingConstraints(profileConfig) {
  if (!isPlainObject(profileConfig)) {
    return undefined;
  }

  const constraints = {};
  if (Array.isArray(profileConfig.allowedHandoffModes)) {
    constraints.allowedHandoffModes = profileConfig.allowedHandoffModes;
  }

  if (typeof profileConfig.defaultHandoffMode === "string") {
    constraints.defaultHandoffMode = profileConfig.defaultHandoffMode;
  }

  if (
    typeof profileConfig.maxFanoutAgents === "number" &&
    Number.isInteger(profileConfig.maxFanoutAgents)
  ) {
    constraints.maxFanoutAgents = profileConfig.maxFanoutAgents;
  }

  if (Object.keys(constraints).length === 0) {
    return undefined;
  }

  return Object.freeze(constraints);
}

/**
 * @param {Record<string, unknown>} request
 * @param {Record<string, unknown>} route
 * @param {Record<string, unknown>|undefined} resolvedProfile
 * @param {Record<string, unknown>|undefined} profileResolutionFailure
 * @returns {Record<string, unknown>}
 */
function createRoutingDiagnostics(
  request,
  route,
  resolvedProfile,
  profileResolutionFailure,
) {
  const requestedMode = deriveRequestedMode(request);
  const requestedTargetCount = deriveRequestedTargetCount(request);
  const resolvedTargetCount = deriveResolvedTargetCount(route);
  const adjustmentReasons = [];
  const requestedDelegateTarget =
    requestedMode === "delegate" ? deriveRequestedDelegateTarget(request) : undefined;

  if (requestedMode !== route.mode) {
    adjustmentReasons.push("mode_adjusted");
  }

  if (
    requestedMode === "fanout-fanin" &&
    route.mode === "fanout-fanin" &&
    resolvedTargetCount < requestedTargetCount
  ) {
    adjustmentReasons.push("fanout_limited");
  }

  if (
    requestedMode === "delegate" &&
    route.mode === "delegate" &&
    requestedDelegateTarget !== undefined &&
    route.targetAgentId !== requestedDelegateTarget
  ) {
    adjustmentReasons.push("delegate_target_adjusted");
  }

  const diagnostics = {
    requestedMode,
    resolvedMode: route.mode,
    requestedTargetCount,
    resolvedTargetCount,
    routeAdjusted: adjustmentReasons.length > 0,
    adjustmentReasons: Object.freeze(adjustmentReasons),
    profileResolution:
      resolvedProfile !== undefined
        ? {
            status: "resolved",
            profileId: resolvedProfile.profileId,
            resolvedScope: resolvedProfile.resolvedScope,
          }
        : {
            status: "not_resolved",
            ...(profileResolutionFailure !== undefined
              ? {
                  failure: profileResolutionFailure,
                }
              : {}),
          },
  };

  const profileRoutingConstraints = deriveProfileRoutingConstraints(
    resolvedProfile?.profileConfig,
  );
  if (profileRoutingConstraints !== undefined) {
    diagnostics.profileRoutingConstraints = profileRoutingConstraints;
  }

  return Object.freeze(diagnostics);
}

/**
 * @param {unknown} value
 * @param {Record<string, unknown>} routingDiagnostics
 * @returns {Record<string, unknown>}
 */
function mergeContextWithRoutingDiagnostics(value, routingDiagnostics) {
  if (isPlainObject(value)) {
    return Object.freeze({
      ...value,
      handoffRouting: routingDiagnostics,
    });
  }

  return Object.freeze({
    handoffRouting: routingDiagnostics,
    ...(value !== undefined ? { upstreamContext: value } : {}),
  });
}

/**
 * @param {Record<string, unknown>} projected
 * @param {unknown} profileConfig
 * @returns {Record<string, unknown>}
 */
function applyProfileScopeConstraints(projected, profileConfig) {
  if (!isPlainObject(profileConfig)) {
    return Object.freeze(projected);
  }

  const constrained = { ...projected };
  const profileAllowedTools = normalizeOptionalStringArray(
    profileConfig.allowedTools,
    "profileConfig.allowedTools",
  );
  const profileAllowedExtensions = normalizeOptionalStringArray(
    profileConfig.allowedExtensions,
    "profileConfig.allowedExtensions",
  );
  const profileMaxToolCalls = normalizeOptionalNonNegativeInt(
    profileConfig.maxToolCalls,
    "profileConfig.maxToolCalls",
  );

  if (profileAllowedTools !== undefined) {
    const allowedSet = new Set(profileAllowedTools);
    constrained.allowedTools = Object.freeze(
      constrained.allowedTools.filter((value) => allowedSet.has(value)),
    );
  }

  if (profileAllowedExtensions !== undefined) {
    const allowedSet = new Set(profileAllowedExtensions);
    constrained.allowedExtensions = Object.freeze(
      constrained.allowedExtensions.filter((value) => allowedSet.has(value)),
    );
  }

  if (profileMaxToolCalls !== undefined) {
    constrained.maxToolCalls = Math.min(
      constrained.maxToolCalls,
      profileMaxToolCalls,
    );

    if (
      Array.isArray(constrained.targetAgentIds) &&
      constrained.targetAgentIds.length > 0
    ) {
      constrained.maxToolCallsPerAgent = Math.floor(
        constrained.maxToolCalls / constrained.targetAgentIds.length,
      );
    }
  }

  return Object.freeze(constrained);
}

/**
 * @param {unknown} scope
 * @param {Record<string, unknown>} route
 * @param {Record<string, unknown>} request
 * @param {Record<string, unknown>|undefined} resolvedProfile
 * @returns {Record<string, unknown>}
 */
function projectCapabilityScopeDefault(scope, route, request, resolvedProfile) {
  if (!isPlainObject(scope)) {
    throw new ContractValidationError("Invalid handoff capability scope", {
      reason: "capabilityScope must be a plain object",
    });
  }

  const targetAgentIds = /** @type {readonly string[]|undefined} */ (route.targetAgentIds);
  const targetAgentId = /** @type {string|undefined} */ (route.targetAgentId);
  const mode = /** @type {"direct"|"delegate"|"fanout-fanin"} */ (route.mode);

  const allowedTools = normalizeOptionalStringArray(scope.allowedTools, "allowedTools");
  const allowedExtensions = normalizeOptionalStringArray(
    scope.allowedExtensions,
    "allowedExtensions",
  );

  let maxToolCalls = undefined;
  maxToolCalls = normalizeOptionalNonNegativeInt(
    scope.maxToolCalls,
    "capabilityScope.maxToolCalls",
  );

  const projected = {
    allowedTools: allowedTools ?? [],
    allowedExtensions: allowedExtensions ?? [],
    maxToolCalls: maxToolCalls ?? 0,
  };

  if (mode === "direct") {
    projected.allowedTools = [];
    projected.allowedExtensions = [];
    projected.maxToolCalls = 0;
    return Object.freeze(projected);
  }

  if (mode === "delegate") {
    if (targetAgentId !== undefined) {
      projected.targetAgentId = targetAgentId;
    }
    return applyProfileScopeConstraints(projected, resolvedProfile?.profileConfig);
  }

  const delegateCount = targetAgentIds?.length ?? 0;
  projected.maxToolCallsPerAgent =
    delegateCount === 0
      ? 0
      : Math.floor(projected.maxToolCalls / delegateCount);
  projected.targetAgentIds = targetAgentIds ?? [];
  return applyProfileScopeConstraints(projected, resolvedProfile?.profileConfig);
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string|undefined} traceId
 * @returns {Record<string, unknown>}
 */
function withOptionalTraceId(payload, traceId) {
  if (traceId === undefined) {
    return Object.freeze(payload);
  }

  return Object.freeze({
    ...payload,
    traceId,
  });
}

/**
 * @param {unknown} error
 * @param {Record<string, unknown>} input
 * @param {string|undefined} traceId
 * @returns {Record<string, unknown>}
 */
function toFailurePayload(error, input, traceId) {
  if (error instanceof PolarTypedError) {
    return withOptionalTraceId({
      code: error.code,
      message: error.message,
      details: error.details,
    }, traceId);
  }

  return withOptionalTraceId({
    code: "POLAR_RUNTIME_EXECUTION_ERROR",
    message: error instanceof Error ? error.message : String(error),
    details: {
      sourceAgentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
      targetAgentIds: input.targetAgentIds ?? [],
    },
  }, traceId);
}

/**
 * @param {Record<string, unknown>} request
 * @param {Record<string, unknown>} route
 * @param {Record<string, unknown>} projectedScope
 * @param {Record<string, unknown>|undefined} resolvedProfile
 * @param {Record<string, unknown>|undefined} routingDiagnostics
 * @returns {Record<string, unknown>}
 */
function toHandoffInput(
  request,
  route,
  projectedScope,
  resolvedProfile,
  routingDiagnostics,
) {
  const input = {
    mode: route.mode,
    sourceAgentId: request.sourceAgentId,
    reason: request.reason,
    sessionId: request.sessionId,
    userId: request.userId,
    capabilityScope: projectedScope,
    payload: request.payload,
  };

  if (route.targetAgentId !== undefined) {
    input.targetAgentId = route.targetAgentId;
  }
  if (route.targetAgentIds !== undefined) {
    input.targetAgentIds = route.targetAgentIds;
  }
  if (request.workspaceId !== undefined) {
    input.workspaceId = request.workspaceId;
  }
  if (resolvedProfile?.profileId !== undefined) {
    input.profileId = resolvedProfile.profileId;
  } else if (request.profileId !== undefined) {
    input.profileId = request.profileId;
  }
  if (request.defaultProfileId !== undefined) {
    input.defaultProfileId = request.defaultProfileId;
  }
  if (resolvedProfile?.resolvedScope !== undefined) {
    input.resolvedProfileScope = resolvedProfile.resolvedScope;
  } else if (request.profileId !== undefined) {
    input.resolvedProfileScope = "direct";
  }
  if (request.budgetContext !== undefined) {
    input.budgetContext = request.budgetContext;
  }
  if (routingDiagnostics !== undefined) {
    input.routingDiagnostics = routingDiagnostics;
  }
  if (request.policyContext !== undefined) {
    input.policyContext =
      routingDiagnostics !== undefined
        ? mergeContextWithRoutingDiagnostics(
            request.policyContext,
            routingDiagnostics,
          )
        : request.policyContext;
  }
  if (request.traceMetadata !== undefined) {
    input.traceMetadata =
      routingDiagnostics !== undefined
        ? mergeContextWithRoutingDiagnostics(
            request.traceMetadata,
            routingDiagnostics,
          )
        : request.traceMetadata;
  }

  const fallbackRoutingId = resolvedProfile?.profileConfig?.fallbackRoutingId;
  if (typeof fallbackRoutingId === "string" && fallbackRoutingId.length > 0) {
    input.fallbackRoutingId = fallbackRoutingId;
  }

  return input;
}

/**
 * @param {"completed"|"failed"} status
 * @param {Record<string, unknown>} input
 * @param {Record<string, unknown>} projectedScope
 * @returns {Record<string, unknown>}
 */
function createHandoffOutputBase(status, input, projectedScope) {
  const output = {
    status,
    mode: input.mode,
    sourceAgentId: input.sourceAgentId,
    capabilityScope: projectedScope,
  };

  if (input.targetAgentId !== undefined) {
    output.targetAgentId = input.targetAgentId;
  }

  if (input.targetAgentIds !== undefined) {
    output.targetAgentIds = input.targetAgentIds;
  }
  if (input.profileId !== undefined) {
    output.profileId = input.profileId;
  }
  if (input.resolvedProfileScope !== undefined) {
    output.resolvedProfileScope = input.resolvedProfileScope;
  }
  if (input.routingDiagnostics !== undefined) {
    output.routingDiagnostics = input.routingDiagnostics;
  }
  
  if (input.fallbackRoutingId !== undefined) {
    output.fallbackRoutingId = input.fallbackRoutingId;
  }

  return output;
}

/**
 * @param {Record<string, unknown>} input
 * @param {Record<string, unknown>} projectedScope
 * @param {unknown} result
 * @param {string|undefined} traceId
 * @returns {Record<string, unknown>}
 */
function toSuccessfulOutput(input, projectedScope, result, traceId) {
  if (isPlainObject(result) && result.status === "failed") {
    const output = createHandoffOutputBase("failed", input, projectedScope);
    output.failure =
      result.failure ??
      withOptionalTraceId({
        code: "POLAR_RUNTIME_EXECUTION_ERROR",
        message: "Handoff executor returned failed status without failure payload",
      }, traceId);
    return output;
  }

  if (isPlainObject(result) && result.status === "completed") {
    const output = createHandoffOutputBase("completed", input, projectedScope);
    output.outputPayload = Object.prototype.hasOwnProperty.call(
      result,
      "outputPayload",
    )
      ? result.outputPayload
      : result;
    return output;
  }

  const output = createHandoffOutputBase("completed", input, projectedScope);
  output.outputPayload = result;
  return output;
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerHandoffContract(contractRegistry) {
  if (!contractRegistry.has(HANDOFF_ACTION.actionId, HANDOFF_ACTION.version)) {
    contractRegistry.register(createHandoffContract());
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   handoffExecutor?: (input: Record<string, unknown>) => Promise<unknown>|unknown,
 *   routingPolicyEngine?: { decide: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown> },
 *   profileResolver?: { resolveProfile?: (request: Record<string, unknown>) => Promise<unknown>|unknown },
 *   projectCapabilityScope?: (
 *     scope: unknown,
 *     route: Record<string, unknown>,
 *     request: Record<string, unknown>,
 *     resolvedProfile?: Record<string, unknown>
 *   ) => Record<string, unknown>,
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createHandoffGateway({
  middlewarePipeline,
  handoffExecutor,
  routingPolicyEngine = createRoutingPolicyEngine(),
  profileResolver = {},
  projectCapabilityScope = projectCapabilityScopeDefault,
  defaultExecutionType = "handoff",
}) {
  if (
    typeof routingPolicyEngine !== "object" ||
    routingPolicyEngine === null ||
    typeof routingPolicyEngine.decide !== "function"
  ) {
    throw new RuntimeExecutionError("routingPolicyEngine must expose decide(request)");
  }

  if (handoffExecutor !== undefined && typeof handoffExecutor !== "function") {
    throw new RuntimeExecutionError("handoffExecutor must be a function when provided");
  }

  if (typeof profileResolver !== "object" || profileResolver === null) {
    throw new RuntimeExecutionError("profileResolver must be an object when provided");
  }

  if (
    profileResolver.resolveProfile !== undefined &&
    typeof profileResolver.resolveProfile !== "function"
  ) {
    throw new RuntimeExecutionError(
      "profileResolver.resolveProfile must be a function when provided",
    );
  }

  if (typeof projectCapabilityScope !== "function") {
    throw new RuntimeExecutionError("projectCapabilityScope must be a function");
  }

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async execute(request) {
      const validation = handoffRequestSchema.validate(request);
      if (!validation.ok) {
        throw new ContractValidationError("Invalid handoff gateway request", {
          schemaId: handoffRequestSchema.schemaId,
          errors: validation.errors ?? [],
        });
      }

      const parsed = /** @type {Record<string, unknown>} */ (validation.value);
      let resolvedProfile = undefined;
      let profileResolutionAttempted = false;
      let profileResolutionFailure = undefined;
      if (parsed.profileId !== undefined) {
        resolvedProfile = {
          profileId: parsed.profileId,
          resolvedScope: "direct",
        };
        profileResolutionAttempted = true;
      } else if (profileResolver.resolveProfile) {
        profileResolutionAttempted = true;
        try {
          const resolution = parseProfileResolutionResult(
            await profileResolver.resolveProfile({
              sessionId: parsed.sessionId,
              workspaceId: parsed.workspaceId,
              defaultProfileId: parsed.defaultProfileId,
              includeProfileConfig: true,
              allowDefaultFallback: true,
            }),
          );

          if (
            resolution.status === "resolved" &&
            resolution.profileId !== undefined
          ) {
            resolvedProfile = {
              profileId: resolution.profileId,
              resolvedScope: resolution.resolvedScope ?? "default",
              profileConfig: resolution.profileConfig,
            };
          } else {
            profileResolutionFailure = withOptionalTraceId({
              code: "POLAR_PROFILE_NOT_RESOLVED",
              message:
                typeof resolution.reason === "string" && resolution.reason.length > 0
                  ? resolution.reason
                  : "Handoff profile could not be resolved",
            }, parsed.traceId);
          }
        } catch (error) {
          profileResolutionFailure = withOptionalTraceId({
            code: "POLAR_PROFILE_NOT_RESOLVED",
            message:
              error instanceof Error ? error.message : String(error),
          }, parsed.traceId);
        }
      }

      const routingRequest = {
        sourceAgentId: parsed.sourceAgentId,
        reason: parsed.reason,
        payload: parsed.payload,
      };
      if (parsed.preferredMode !== undefined) {
        routingRequest.preferredMode = parsed.preferredMode;
      }
      if (parsed.targetAgentId !== undefined) {
        routingRequest.targetAgentId = parsed.targetAgentId;
      }
      if (parsed.targetAgentIds !== undefined) {
        routingRequest.targetAgentIds = parsed.targetAgentIds;
      }
      if (resolvedProfile?.profileId !== undefined) {
        routingRequest.resolvedProfileId = resolvedProfile.profileId;
      }
      if (resolvedProfile?.resolvedScope !== undefined) {
        routingRequest.resolvedProfileScope = resolvedProfile.resolvedScope;
      }
      if (resolvedProfile?.profileConfig !== undefined) {
        routingRequest.resolvedProfileConfig = resolvedProfile.profileConfig;
      }

      const route = await routingPolicyEngine.decide(routingRequest);
      const routeMode = /** @type {"direct"|"delegate"|"fanout-fanin"} */ (route.mode);
      const routingDiagnostics = profileResolutionAttempted
        ? createRoutingDiagnostics(
            parsed,
            route,
            resolvedProfile,
            profileResolutionFailure,
          )
        : undefined;

      const projectedScope = projectCapabilityScope(
        parsed.capabilityScope,
        route,
        parsed,
        resolvedProfile,
      );
      const handoffInput = toHandoffInput(
        parsed,
        route,
        projectedScope,
        resolvedProfile,
        routingDiagnostics,
      );

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: HANDOFF_ACTION.actionId,
          version: HANDOFF_ACTION.version,
          input: handoffInput,
        },
        async (validatedInput) => {
          const mode = /** @type {"direct"|"delegate"|"fanout-fanin"} */ (validatedInput.mode);

          if (
            mode !== "direct" &&
            profileResolutionAttempted &&
            validatedInput.profileId === undefined
          ) {
            const output = createHandoffOutputBase(
              "failed",
              validatedInput,
              validatedInput.capabilityScope,
            );
            output.failure =
              profileResolutionFailure ??
              withOptionalTraceId({
                code: "POLAR_PROFILE_NOT_RESOLVED",
                message: "Handoff profile could not be resolved",
              }, parsed.traceId);
            return output;
          }

          if (mode === "direct") {
            const output = createHandoffOutputBase(
              "completed",
              validatedInput,
              validatedInput.capabilityScope,
            );
            output.outputPayload = validatedInput.payload;
            return output;
          }

          if (!handoffExecutor) {
            const output = createHandoffOutputBase(
              "failed",
              validatedInput,
              validatedInput.capabilityScope,
            );
            output.failure = withOptionalTraceId({
              code: "POLAR_RUNTIME_EXECUTION_ERROR",
              message: "Handoff executor is not configured",
            }, parsed.traceId);
            return output;
          }

          try {
            const result = await handoffExecutor(validatedInput);
            return toSuccessfulOutput(
              validatedInput,
              validatedInput.capabilityScope,
              result,
              /** @type {string|undefined} */ (parsed.traceId),
            );
          } catch (error) {
            const output = createHandoffOutputBase(
              "failed",
              validatedInput,
              validatedInput.capabilityScope,
            );
            output.failure = toFailurePayload(
              error,
              validatedInput,
              /** @type {string|undefined} */ (parsed.traceId),
            );
            return output;
          }
        },
      );
    },
  });
}
