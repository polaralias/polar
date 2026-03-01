import {
  ContractValidationError,
  HEARTBEAT_DELIVERY_RULES,
  HEARTBEAT_MODEL_LANES,
  HEARTBEAT_TICK_ACTION,
  HEARTBEAT_TRIGGERS,
  RuntimeExecutionError,
  booleanField,
  createHeartbeatContract,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringArrayField,
  stringField,
} from "@polar/domain";

const heartbeatRequestSchema = createStrictObjectSchema({
  schemaId: "heartbeat.gateway.tick.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    policyId: stringField({ minLength: 1 }),
    profileId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    workspaceId: stringField({ minLength: 1, required: false }),
    defaultProfileId: stringField({ minLength: 1, required: false }),
    runId: stringField({ minLength: 1 }),
    trigger: enumField(HEARTBEAT_TRIGGERS),
    timestampMs: numberField({ min: 0 }),
    cadenceMinutes: numberField({ min: 1, max: 1_440 }),
    active: booleanField({ required: false }),
    activeFromHourUtc: numberField({ min: 0, max: 23, required: false }),
    activeToHourUtc: numberField({ min: 0, max: 23, required: false }),
    deliveryRule: enumField(HEARTBEAT_DELIVERY_RULES),
    modelLaneDefault: enumField(HEARTBEAT_MODEL_LANES, {
      required: false,
    }),
    escalationEnabled: booleanField({ required: false }),
    escalationFailureThreshold: numberField({
      min: 1,
      max: 100,
      required: false,
    }),
    escalationTargetLane: enumField(["worker", "brain"], { required: false }),
    queueDepth: numberField({ min: 0, required: false }),
    queueMaxDepth: numberField({ min: 0, required: false }),
    remainingBudgetUsd: numberField({ min: 0, required: false }),
    estimatedRunCostUsd: numberField({ min: 0, required: false }),
    activeCheckIds: stringArrayField({ minItems: 0, required: false }),
    recentFailureCount: numberField({ min: 0, required: false }),
    forceRun: booleanField({ required: false }),
    forceEscalation: booleanField({ required: false }),
    metadata: jsonField({ required: false }),
  },
});

const profileResolutionResultSchema = createStrictObjectSchema({
  schemaId: "heartbeat.gateway.tick.profile-resolution.result",
  fields: {
    status: enumField(["resolved", "not_found"]),
    profileId: stringField({ minLength: 1, required: false }),
    resolvedScope: enumField(["session", "workspace", "global", "default"], {
      required: false,
    }),
    reason: stringField({ minLength: 1, required: false }),
  },
});

/**
 * @param {unknown} value
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function validateRequest(value, schemaId) {
  const schema = {
    [heartbeatRequestSchema.schemaId]: heartbeatRequestSchema,
  }[schemaId];

  const validation = schema.validate(value);
  if (!validation.ok) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: validation.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function parseProfileResolutionResult(value) {
  const validation = profileResolutionResultSchema.validate(value);
  if (!validation.ok) {
    throw new RuntimeExecutionError("Invalid profile resolution output", {
      schemaId: profileResolutionResultSchema.schemaId,
      errors: validation.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {number} hour
 * @param {{ fromHourUtc: number, toHourUtc: number }} schedule
 * @returns {boolean}
 */
function isActiveHour(hour, schedule) {
  if (schedule.fromHourUtc === schedule.toHourUtc) {
    return true;
  }

  if (schedule.fromHourUtc < schedule.toHourUtc) {
    return hour >= schedule.fromHourUtc && hour < schedule.toHourUtc;
  }

  return hour >= schedule.fromHourUtc || hour < schedule.toHourUtc;
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerHeartbeatContract(contractRegistry) {
  if (
    !contractRegistry.has(
      HEARTBEAT_TICK_ACTION.actionId,
      HEARTBEAT_TICK_ACTION.version,
    )
  ) {
    contractRegistry.register(createHeartbeatContract());
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   heartbeatExecutor?: {
 *     runChecks?: (request: Record<string, unknown>) => Promise<unknown>|unknown
 *   },
 *   profileResolver?: {
 *     resolveProfile?: (request: Record<string, unknown>) => Promise<unknown>|unknown
 *   },
 *   runEventLinker?: {
 *     recordHeartbeatRun?: (request: Record<string, unknown>) => Promise<unknown>|unknown
 *   },
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createHeartbeatGateway({
  middlewarePipeline,
  heartbeatExecutor = {},
  profileResolver = {},
  runEventLinker = {},
  defaultExecutionType = "heartbeat",
}) {
  if (typeof heartbeatExecutor !== "object" || heartbeatExecutor === null) {
    throw new RuntimeExecutionError("heartbeatExecutor must be an object when provided");
  }

  if (
    heartbeatExecutor.runChecks !== undefined &&
    typeof heartbeatExecutor.runChecks !== "function"
  ) {
    throw new RuntimeExecutionError(
      "heartbeatExecutor.runChecks must be a function when provided",
    );
  }

  if (typeof profileResolver !== "object" || profileResolver === null) {
    throw new RuntimeExecutionError(
      "profileResolver must be an object when provided",
    );
  }

  if (
    profileResolver.resolveProfile !== undefined &&
    typeof profileResolver.resolveProfile !== "function"
  ) {
    throw new RuntimeExecutionError(
      "profileResolver.resolveProfile must be a function when provided",
    );
  }

  if (typeof runEventLinker !== "object" || runEventLinker === null) {
    throw new RuntimeExecutionError(
      "runEventLinker must be an object when provided",
    );
  }

  if (
    runEventLinker.recordHeartbeatRun !== undefined &&
    typeof runEventLinker.recordHeartbeatRun !== "function"
  ) {
    throw new RuntimeExecutionError(
      "runEventLinker.recordHeartbeatRun must be a function when provided",
    );
  }

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async tick(request) {
      const validatedRequest = validateRequest(
        request,
        heartbeatRequestSchema.schemaId,
      );
      const executionType =
        /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
          validatedRequest.executionType
        ) ?? defaultExecutionType;
      const traceId = /** @type {string|undefined} */ (validatedRequest.traceId);

      return middlewarePipeline.run(
        {
          executionType,
          traceId,
          actionId: HEARTBEAT_TICK_ACTION.actionId,
          version: HEARTBEAT_TICK_ACTION.version,
          input: (() => {
            const input = {
              policyId: validatedRequest.policyId,
              runId: validatedRequest.runId,
              trigger: validatedRequest.trigger,
              timestampMs: validatedRequest.timestampMs,
              cadenceMinutes: validatedRequest.cadenceMinutes,
              deliveryRule: validatedRequest.deliveryRule,
            };
            if (validatedRequest.profileId !== undefined) {
              input.profileId = validatedRequest.profileId;
            }
            if (validatedRequest.sessionId !== undefined) {
              input.sessionId = validatedRequest.sessionId;
            }
            if (validatedRequest.workspaceId !== undefined) {
              input.workspaceId = validatedRequest.workspaceId;
            }
            if (validatedRequest.defaultProfileId !== undefined) {
              input.defaultProfileId = validatedRequest.defaultProfileId;
            }
            if (validatedRequest.active !== undefined) {
              input.active = validatedRequest.active;
            }
            if (validatedRequest.activeFromHourUtc !== undefined) {
              input.activeFromHourUtc = validatedRequest.activeFromHourUtc;
            }
            if (validatedRequest.activeToHourUtc !== undefined) {
              input.activeToHourUtc = validatedRequest.activeToHourUtc;
            }
            if (validatedRequest.modelLaneDefault !== undefined) {
              input.modelLaneDefault = validatedRequest.modelLaneDefault;
            }
            if (validatedRequest.escalationEnabled !== undefined) {
              input.escalationEnabled = validatedRequest.escalationEnabled;
            }
            if (validatedRequest.escalationFailureThreshold !== undefined) {
              input.escalationFailureThreshold =
                validatedRequest.escalationFailureThreshold;
            }
            if (validatedRequest.escalationTargetLane !== undefined) {
              input.escalationTargetLane = validatedRequest.escalationTargetLane;
            }
            if (validatedRequest.queueDepth !== undefined) {
              input.queueDepth = validatedRequest.queueDepth;
            }
            if (validatedRequest.queueMaxDepth !== undefined) {
              input.queueMaxDepth = validatedRequest.queueMaxDepth;
            }
            if (validatedRequest.remainingBudgetUsd !== undefined) {
              input.remainingBudgetUsd = validatedRequest.remainingBudgetUsd;
            }
            if (validatedRequest.estimatedRunCostUsd !== undefined) {
              input.estimatedRunCostUsd = validatedRequest.estimatedRunCostUsd;
            }
            if (validatedRequest.activeCheckIds !== undefined) {
              input.activeCheckIds = validatedRequest.activeCheckIds;
            }
            if (validatedRequest.recentFailureCount !== undefined) {
              input.recentFailureCount = validatedRequest.recentFailureCount;
            }
            if (validatedRequest.forceRun !== undefined) {
              input.forceRun = validatedRequest.forceRun;
            }
            if (validatedRequest.forceEscalation !== undefined) {
              input.forceEscalation = validatedRequest.forceEscalation;
            }
            if (validatedRequest.metadata !== undefined) {
              input.metadata = validatedRequest.metadata;
            }
            return input;
          })(),
        },
        async (input) => {
          const forceRun = input.forceRun === true;
          const activeChecks = /** @type {readonly string[]|undefined} */ (
            input.activeCheckIds
          ) ?? Object.freeze([]);
          const checkCount = activeChecks.length;
          const baseModelLane =
            /** @type {"local"|"worker"|"brain"|undefined} */ (
              input.modelLaneDefault
            ) ?? "local";
          const escalationEnabled = input.escalationEnabled === true;
          const escalationThreshold = /** @type {number|undefined} */ (
            input.escalationFailureThreshold
          ) ?? 1;
          const recentFailureCount = /** @type {number|undefined} */ (
            input.recentFailureCount
          ) ?? 0;
          const escalationApplied =
            escalationEnabled &&
            (input.forceEscalation === true ||
              recentFailureCount >= escalationThreshold);
          const selectedModelLane =
            escalationApplied
              ? /** @type {"worker"|"brain"|undefined} */ (
                  input.escalationTargetLane
                ) ?? "worker"
              : baseModelLane;
          let resolvedProfileId = /** @type {string|undefined} */ (input.profileId);
          let resolvedProfileScope = undefined;

          const buildOutput = (
            status,
            {
              skipReason,
              executionPlan,
              outcome,
            } = {},
          ) => {
            const output = {
              status,
              policyId: input.policyId,
              runId: input.runId,
              trigger: input.trigger,
              selectedModelLane,
              escalationApplied,
              checkCount,
              deliveryRule: input.deliveryRule,
              executionPlan,
            };
            if (resolvedProfileId !== undefined) {
              output.profileId = resolvedProfileId;
            }
            if (resolvedProfileScope !== undefined) {
              output.resolvedProfileScope = resolvedProfileScope;
            }
            if (skipReason !== undefined) {
              output.skipReason = skipReason;
            }
            if (outcome !== undefined) {
              output.outcome = outcome;
            }

            return output;
          };

          const recordRunLink = async (output) => {
            if (
              !runEventLinker.recordHeartbeatRun ||
              resolvedProfileId === undefined
            ) {
              return output;
            }

            await runEventLinker.recordHeartbeatRun({
              policyId: input.policyId,
              runId: input.runId,
              profileId: resolvedProfileId,
              trigger: input.trigger,
              output,
              ...(input.metadata !== undefined
                ? {
                    metadata: input.metadata,
                  }
                : {}),
            });

            return output;
          };

          if (resolvedProfileId === undefined) {
            if (!profileResolver.resolveProfile) {
              return buildOutput("skipped", {
                skipReason: "profile_not_resolved",
                executionPlan: {
                  checkIds: activeChecks,
                  forceRun,
                },
              });
            }

            const resolution = parseProfileResolutionResult(
              await profileResolver.resolveProfile({
                sessionId: input.sessionId,
                workspaceId: input.workspaceId,
                defaultProfileId: input.defaultProfileId,
                includeProfileConfig: false,
                allowDefaultFallback: true,
              }),
            );

            if (resolution.status !== "resolved" || resolution.profileId === undefined) {
              return buildOutput("skipped", {
                skipReason: "profile_not_resolved",
                executionPlan: {
                  checkIds: activeChecks,
                  forceRun,
                },
              });
            }

            resolvedProfileId = /** @type {string} */ (resolution.profileId);
            resolvedProfileScope =
              /** @type {"session"|"workspace"|"global"|"default"|undefined} */ (
                resolution.resolvedScope
              ) ?? "default";
          }

          if (input.active === false && !forceRun) {
            return recordRunLink(buildOutput("skipped", {
              skipReason: "policy_inactive",
              executionPlan: {
                checkIds: activeChecks,
                forceRun,
              },
            }));
          }

          if (checkCount === 0 && !forceRun) {
            return recordRunLink(buildOutput("skipped", {
              skipReason: "no_active_checks",
              executionPlan: {
                checkIds: activeChecks,
                forceRun,
              },
            }));
          }

          if (
            input.activeFromHourUtc !== undefined &&
            input.activeToHourUtc !== undefined &&
            !forceRun
          ) {
            const hour = new Date(input.timestampMs).getUTCHours();
            const inActiveWindow = isActiveHour(hour, {
              fromHourUtc: input.activeFromHourUtc,
              toHourUtc: input.activeToHourUtc,
            });
            if (!inActiveWindow) {
              return recordRunLink(buildOutput("skipped", {
                skipReason: "outside_active_hours",
                executionPlan: {
                  checkIds: activeChecks,
                  forceRun,
                  activeWindow: {
                    fromHourUtc: input.activeFromHourUtc,
                    toHourUtc: input.activeToHourUtc,
                  },
                },
              }));
            }
          }

          if (
            input.queueMaxDepth !== undefined &&
            (input.queueDepth ?? 0) > input.queueMaxDepth &&
            !forceRun
          ) {
            return recordRunLink(buildOutput("skipped", {
              skipReason: "queue_backpressure",
              executionPlan: {
                checkIds: activeChecks,
                forceRun,
                queueDepth: input.queueDepth ?? 0,
                queueMaxDepth: input.queueMaxDepth,
              },
            }));
          }

          if (!forceRun) {
            const remainingBudget = /** @type {number|undefined} */ (
              input.remainingBudgetUsd
            );
            const estimatedRunCost = /** @type {number|undefined} */ (
              input.estimatedRunCostUsd
            );

            if (
              (remainingBudget !== undefined && remainingBudget <= 0) ||
              (remainingBudget !== undefined &&
                estimatedRunCost !== undefined &&
                remainingBudget < estimatedRunCost)
            ) {
              return recordRunLink(buildOutput("skipped", {
                skipReason: "budget_exceeded",
                executionPlan: {
                  checkIds: activeChecks,
                  forceRun,
                  remainingBudgetUsd: remainingBudget,
                  estimatedRunCostUsd: estimatedRunCost,
                },
              }));
            }
          }

          let outcome = undefined;
          if (heartbeatExecutor.runChecks) {
            outcome = await heartbeatExecutor.runChecks({
              policyId: input.policyId,
              profileId: resolvedProfileId,
              runId: input.runId,
              trigger: input.trigger,
              selectedModelLane,
              escalationApplied,
              deliveryRule: input.deliveryRule,
              checkIds: activeChecks,
              metadata: input.metadata,
            });
          }

          return recordRunLink(buildOutput("executed", {
            executionPlan: {
              checkIds: activeChecks,
              forceRun,
              selectedModelLane,
              escalationApplied,
            },
            outcome,
          }));
        },
      );
    },
  });
}
