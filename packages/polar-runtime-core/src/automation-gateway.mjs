import {
  AUTOMATION_DRAFT_ACTION,
  AUTOMATION_MODEL_LANES,
  AUTOMATION_RUN_ACTION,
  AUTOMATION_TRIGGER_TYPES,
  ContractValidationError,
  RuntimeExecutionError,
  booleanField,
  createAutomationContracts,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "@polar/domain";

const automationDraftRequestSchema = createStrictObjectSchema({
  schemaId: "automation.gateway.draft.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    defaultProfileId: stringField({ minLength: 1 }),
    intentText: stringField({ minLength: 1 }),
    locale: stringField({ minLength: 1, required: false }),
    metadata: jsonField({ required: false }),
  },
});

const automationRunRequestSchema = createStrictObjectSchema({
  schemaId: "automation.gateway.run.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    automationId: stringField({ minLength: 1 }),
    runId: stringField({ minLength: 1 }),
    trigger: enumField(AUTOMATION_TRIGGER_TYPES),
    profileId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    workspaceId: stringField({ minLength: 1, required: false }),
    defaultProfileId: stringField({ minLength: 1, required: false }),
    active: booleanField({ required: false }),
    forceRun: booleanField({ required: false }),
    modelLaneDefault: enumField(AUTOMATION_MODEL_LANES, {
      required: false,
    }),
    escalationEnabled: booleanField({ required: false }),
    escalationFailureThreshold: numberField({
      min: 1,
      max: 100,
      required: false,
    }),
    escalationTargetLane: enumField(["worker", "brain"], {
      required: false,
    }),
    recentFailureCount: numberField({ min: 0, required: false }),
    queueDepth: numberField({ min: 0, required: false }),
    queueMaxDepth: numberField({ min: 0, required: false }),
    remainingBudgetUsd: numberField({ min: 0, required: false }),
    estimatedRunCostUsd: numberField({ min: 0, required: false }),
    policyRequiresApproval: booleanField({ required: false }),
    approvalTicket: stringField({ minLength: 1, required: false }),
    executionPlan: jsonField(),
    capabilityScope: jsonField(),
    metadata: jsonField({ required: false }),
  },
});

const profileResolutionResultSchema = createStrictObjectSchema({
  schemaId: "automation.gateway.run.profile-resolution.result",
  fields: {
    status: enumField(["resolved", "not_found"]),
    profileId: stringField({ minLength: 1, required: false }),
    resolvedScope: enumField(["session", "workspace", "global", "default"], {
      required: false,
    }),
    reason: stringField({ minLength: 1, required: false }),
  },
});

const routineIntentPattern = /\b(check|summary|summarize|status|digest|heartbeat|monitor|report)\b/i;
const highRiskIntentPattern = /\b(delete|transfer|purchase|pay|send|deploy|shutdown|remove)\b/i;
const eventIntentPattern = /\bwhen|on event|if\b/i;
const hourlyIntentPattern = /\bevery\s+(\d{1,2})\s+hours?\b/i;
const dailyIntentPattern = /\bdaily|every day\b/i;
const weeklyIntentPattern = /\bweekly|every week\b/i;

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
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function validateRequest(value, schemaId) {
  const schema = {
    [automationDraftRequestSchema.schemaId]: automationDraftRequestSchema,
    [automationRunRequestSchema.schemaId]: automationRunRequestSchema,
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
 * @param {string} intentText
 * @returns {"schedule"|"event"}
 */
function deriveTriggerType(intentText) {
  if (eventIntentPattern.test(intentText)) {
    return "event";
  }

  return "schedule";
}

/**
 * @param {string} intentText
 * @returns {Record<string, unknown>}
 */
function deriveSchedule(intentText) {
  const hourlyMatch = hourlyIntentPattern.exec(intentText);
  if (hourlyMatch) {
    const intervalHours = Number.parseInt(hourlyMatch[1], 10);
    if (Number.isInteger(intervalHours) && intervalHours > 0) {
      return {
        kind: "hourly",
        intervalHours,
      };
    }
  }

  if (dailyIntentPattern.test(intentText)) {
    return {
      kind: "hourly",
      intervalHours: 24,
    };
  }

  if (weeklyIntentPattern.test(intentText)) {
    return {
      kind: "weekly",
      byDay: ["MO"],
      hourUtc: 9,
      minuteUtc: 0,
    };
  }

  return {
    kind: "hourly",
    intervalHours: 24,
  };
}

/**
 * @param {string} intentText
 * @returns {"local"|"worker"}
 */
function deriveModelLane(intentText) {
  if (routineIntentPattern.test(intentText)) {
    return "local";
  }

  return "worker";
}

/**
 * @param {string} intentText
 * @returns {boolean}
 */
function deriveApprovalRequirement(intentText) {
  return highRiskIntentPattern.test(intentText);
}

/**
 * @param {Record<string, unknown>} input
 * @returns {Record<string, unknown>}
 */
function createDefaultDraft(input) {
  const intentText = /** @type {string} */ (input.intentText);
  const normalizedIntentSlug =
    toSlug(intentText).slice(0, 30).replace(/-+$/g, "") || "automation";
  const draftId = `draft.${input.sessionId}.${normalizedIntentSlug}`;
  const selectedModelLane = deriveModelLane(intentText);
  const triggerType = deriveTriggerType(intentText);
  const schedule = deriveSchedule(intentText);
  const summary = intentText.trim().replace(/\s+/g, " ").slice(0, 200);
  const approvalRequired = deriveApprovalRequirement(intentText);

  return {
    status: "drafted",
    draftId,
    summary,
    triggerType,
    schedule,
    runScope: {
      sessionId: input.sessionId,
      userId: input.userId,
      profileId: input.defaultProfileId,
    },
    selectedModelLane,
    approvalRequired,
  };
}

/**
 * @param {Record<string, unknown>} base
 * @param {unknown} override
 * @returns {Record<string, unknown>}
 */
function mergeDraft(base, override) {
  if (!isPlainObject(override)) {
    return base;
  }

  const next = { ...base };
  if (override.status === "drafted" || override.status === "rejected") {
    next.status = override.status;
  }
  if (typeof override.draftId === "string" && override.draftId.length > 0) {
    next.draftId = override.draftId;
  }
  if (typeof override.summary === "string" && override.summary.length > 0) {
    next.summary = override.summary;
  }
  if (
    override.triggerType === "schedule" ||
    override.triggerType === "event" ||
    override.triggerType === "manual" ||
    override.triggerType === "heartbeat"
  ) {
    next.triggerType = override.triggerType;
  }
  if (Object.prototype.hasOwnProperty.call(override, "schedule")) {
    next.schedule = override.schedule;
  }
  if (Object.prototype.hasOwnProperty.call(override, "runScope")) {
    next.runScope = override.runScope;
  }
  if (
    override.selectedModelLane === "local" ||
    override.selectedModelLane === "worker" ||
    override.selectedModelLane === "brain"
  ) {
    next.selectedModelLane = override.selectedModelLane;
  }
  if (typeof override.approvalRequired === "boolean") {
    next.approvalRequired = override.approvalRequired;
  }
  if (typeof override.reason === "string" && override.reason.length > 0) {
    next.reason = override.reason;
  }

  return next;
}

/**
 * @param {unknown} executionPlan
 * @returns {number}
 */
function countExecutionSteps(executionPlan) {
  if (Array.isArray(executionPlan)) {
    return executionPlan.length;
  }

  if (
    isPlainObject(executionPlan) &&
    Array.isArray(executionPlan.steps)
  ) {
    return executionPlan.steps.length;
  }

  return 0;
}

/**
 * @param {unknown} result
 * @returns {{
 *   status: "executed"|"failed",
 *   outcome?: unknown,
 *   failure?: Record<string, unknown>,
 *   retryEligible: boolean,
 *   deadLetterEligible: boolean
 * }}
 */
function normalizeExecutorResult(result) {
  if (result === undefined) {
    return {
      status: "executed",
      retryEligible: false,
      deadLetterEligible: false,
    };
  }

  if (!isPlainObject(result)) {
    return {
      status: "executed",
      outcome: result,
      retryEligible: false,
      deadLetterEligible: false,
    };
  }

  const status =
    result.status === "failed" || result.status === "executed"
      ? result.status
      : "executed";
  const retryEligible = result.retryEligible === true;
  const deadLetterEligible = result.deadLetterEligible === true;

  if (status === "failed") {
    const defaultFailure = {
      code: "POLAR_AUTOMATION_EXECUTION_FAILED",
      message: "Automation execution failed",
    };
    const failure = isPlainObject(result.failure)
      ? result.failure
      : {
          ...defaultFailure,
          ...(typeof result.message === "string" && result.message.length > 0
            ? { message: result.message }
            : {}),
        };

    return {
      status,
      failure,
      retryEligible,
      deadLetterEligible,
    };
  }

  return {
    status,
    outcome: result.outcome ?? result,
    retryEligible,
    deadLetterEligible,
  };
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
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
function toFailure(error) {
  return {
    code: "POLAR_RUNTIME_EXECUTION_ERROR",
    message: "Automation execution failed",
    cause: error instanceof Error ? error.message : String(error),
  };
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerAutomationContracts(contractRegistry) {
  for (const contract of createAutomationContracts()) {
    if (!contractRegistry.has(contract.actionId, contract.version)) {
      contractRegistry.register(contract);
    }
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   automationAuthoring?: {
 *     draftFromIntent?: (request: Record<string, unknown>) => Promise<unknown>|unknown
 *   },
 *   automationExecutor?: {
 *     executePlan?: (request: Record<string, unknown>) => Promise<unknown>|unknown
 *   },
 *   profileResolver?: {
 *     resolveProfile?: (request: Record<string, unknown>) => Promise<unknown>|unknown
 *   },
 *   runEventLinker?: {
 *     recordAutomationRun?: (request: Record<string, unknown>) => Promise<unknown>|unknown
 *   },
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createAutomationGateway({
  middlewarePipeline,
  automationAuthoring = {},
  automationExecutor = {},
  profileResolver = {},
  runEventLinker = {},
  defaultExecutionType = "automation",
}) {
  if (typeof automationAuthoring !== "object" || automationAuthoring === null) {
    throw new RuntimeExecutionError(
      "automationAuthoring must be an object when provided",
    );
  }

  if (typeof automationExecutor !== "object" || automationExecutor === null) {
    throw new RuntimeExecutionError(
      "automationExecutor must be an object when provided",
    );
  }

  if (
    automationAuthoring.draftFromIntent !== undefined &&
    typeof automationAuthoring.draftFromIntent !== "function"
  ) {
    throw new RuntimeExecutionError(
      "automationAuthoring.draftFromIntent must be a function when provided",
    );
  }

  if (
    automationExecutor.executePlan !== undefined &&
    typeof automationExecutor.executePlan !== "function"
  ) {
    throw new RuntimeExecutionError(
      "automationExecutor.executePlan must be a function when provided",
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
    runEventLinker.recordAutomationRun !== undefined &&
    typeof runEventLinker.recordAutomationRun !== "function"
  ) {
    throw new RuntimeExecutionError(
      "runEventLinker.recordAutomationRun must be a function when provided",
    );
  }

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async draftFromIntent(request) {
      const validatedRequest = validateRequest(
        request,
        automationDraftRequestSchema.schemaId,
      );

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              validatedRequest.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (validatedRequest.traceId),
          actionId: AUTOMATION_DRAFT_ACTION.actionId,
          version: AUTOMATION_DRAFT_ACTION.version,
          input: (() => {
            const input = {
              sessionId: validatedRequest.sessionId,
              userId: validatedRequest.userId,
              defaultProfileId: validatedRequest.defaultProfileId,
              intentText: validatedRequest.intentText,
            };
            if (validatedRequest.locale !== undefined) {
              input.locale = validatedRequest.locale;
            }
            if (validatedRequest.metadata !== undefined) {
              input.metadata = validatedRequest.metadata;
            }

            return input;
          })(),
        },
        async (input) => {
          const baseDraft = createDefaultDraft(input);
          if (!automationAuthoring.draftFromIntent) {
            return baseDraft;
          }

          const authoringResult = await automationAuthoring.draftFromIntent({
            ...input,
            baseDraft,
          });
          return mergeDraft(baseDraft, authoringResult);
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async executeRun(request) {
      const validatedRequest = validateRequest(
        request,
        automationRunRequestSchema.schemaId,
      );

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              validatedRequest.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (validatedRequest.traceId),
          actionId: AUTOMATION_RUN_ACTION.actionId,
          version: AUTOMATION_RUN_ACTION.version,
          input: (() => {
            const input = {
              automationId: validatedRequest.automationId,
              runId: validatedRequest.runId,
              trigger: validatedRequest.trigger,
              executionPlan: validatedRequest.executionPlan,
              capabilityScope: validatedRequest.capabilityScope,
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
            if (validatedRequest.forceRun !== undefined) {
              input.forceRun = validatedRequest.forceRun;
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
            if (validatedRequest.recentFailureCount !== undefined) {
              input.recentFailureCount = validatedRequest.recentFailureCount;
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
            if (validatedRequest.policyRequiresApproval !== undefined) {
              input.policyRequiresApproval =
                validatedRequest.policyRequiresApproval;
            }
            if (validatedRequest.approvalTicket !== undefined) {
              input.approvalTicket = validatedRequest.approvalTicket;
            }
            if (validatedRequest.metadata !== undefined) {
              input.metadata = validatedRequest.metadata;
            }
            return input;
          })(),
        },
        async (input) => {
          const forceRun = input.forceRun === true;
          const modelLaneDefault =
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
            recentFailureCount >= escalationThreshold;
          const selectedModelLane =
            escalationApplied
              ? /** @type {"worker"|"brain"|undefined} */ (
                  input.escalationTargetLane
                ) ?? "worker"
              : modelLaneDefault;
          const stepCount = countExecutionSteps(input.executionPlan);
          let resolvedProfileId = /** @type {string|undefined} */ (input.profileId);
          let resolvedProfileScope = undefined;

          const buildOutput = (
            status,
            {
              skipReason,
              blockReason,
              outcome,
              failure,
              retryEligible = false,
              deadLetterEligible = false,
            } = {},
          ) => {
            const output = {
              status,
              automationId: input.automationId,
              runId: input.runId,
              trigger: input.trigger,
              selectedModelLane,
              escalationApplied,
              stepCount,
              retryEligible,
              deadLetterEligible,
            };
            if (resolvedProfileScope !== undefined) {
              output.resolvedProfileScope = resolvedProfileScope;
            }
            if (skipReason !== undefined) {
              output.skipReason = skipReason;
            }
            if (blockReason !== undefined) {
              output.blockReason = blockReason;
            }
            if (outcome !== undefined) {
              output.outcome = outcome;
            }
            if (failure !== undefined) {
              output.failure = failure;
            }

            return output;
          };

          const recordRunLink = async (output) => {
            if (
              !runEventLinker.recordAutomationRun ||
              resolvedProfileId === undefined
            ) {
              return output;
            }

            await runEventLinker.recordAutomationRun({
              automationId: input.automationId,
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
              return buildOutput("blocked", {
                blockReason: "profile_not_resolved",
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
              return buildOutput("blocked", {
                blockReason: "profile_not_resolved",
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
            }));
          }

          if (
            input.queueMaxDepth !== undefined &&
            (input.queueDepth ?? 0) > input.queueMaxDepth &&
            !forceRun
          ) {
            return recordRunLink(buildOutput("skipped", {
              skipReason: "queue_backpressure",
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
              }));
            }
          }

          if (
            input.policyRequiresApproval === true &&
            input.approvalTicket === undefined
          ) {
            return recordRunLink(buildOutput("blocked", {
              blockReason: "approval_required",
            }));
          }

          if (!automationExecutor.executePlan) {
            return recordRunLink(buildOutput("executed", {
              outcome: {
                message: "Automation run executed with default executor",
              },
            }));
          }

          try {
            const executorResult = normalizeExecutorResult(
              await automationExecutor.executePlan({
                automationId: input.automationId,
                runId: input.runId,
                trigger: input.trigger,
                profileId: resolvedProfileId,
                selectedModelLane,
                escalationApplied,
                executionPlan: input.executionPlan,
                capabilityScope: input.capabilityScope,
                metadata: input.metadata,
              }),
            );

            if (executorResult.status === "failed") {
              return recordRunLink(buildOutput("failed", {
                failure: executorResult.failure,
                retryEligible: executorResult.retryEligible,
                deadLetterEligible: executorResult.deadLetterEligible,
              }));
            }

            return recordRunLink(buildOutput("executed", {
              outcome: executorResult.outcome,
              retryEligible: executorResult.retryEligible,
              deadLetterEligible: executorResult.deadLetterEligible,
            }));
          } catch (error) {
            return recordRunLink(buildOutput("failed", {
              failure: toFailure(error),
              retryEligible: true,
              deadLetterEligible: false,
            }));
          }
        },
      );
    },
  });
}
