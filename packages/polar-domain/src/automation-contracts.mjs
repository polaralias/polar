import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "./runtime-contracts.mjs";

export const AUTOMATION_TRIGGER_TYPES = Object.freeze([
  "schedule",
  "event",
  "manual",
  "heartbeat",
]);

export const AUTOMATION_MODEL_LANES = Object.freeze(["local", "worker", "brain"]);

export const AUTOMATION_DRAFT_STATUSES = Object.freeze(["drafted", "rejected"]);
export const AUTOMATION_RUN_STATUSES = Object.freeze([
  "executed",
  "skipped",
  "blocked",
  "failed",
]);
export const AUTOMATION_SKIP_REASONS = Object.freeze([
  "policy_inactive",
  "queue_backpressure",
  "budget_exceeded",
]);
export const AUTOMATION_BLOCK_REASONS = Object.freeze(["approval_required"]);
export const AUTOMATION_PROFILE_RESOLUTION_SCOPES = Object.freeze([
  "session",
  "workspace",
  "global",
  "default",
  "direct",
]);

export const AUTOMATION_DRAFT_ACTION = Object.freeze({
  actionId: "automation.draft.from-intent",
  version: 1,
});

export const AUTOMATION_RUN_ACTION = Object.freeze({
  actionId: "automation.run.execute",
  version: 1,
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createAutomationContracts(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze([
    Object.freeze({
      actionId: AUTOMATION_DRAFT_ACTION.actionId,
      version: AUTOMATION_DRAFT_ACTION.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "automation.draft.from-intent.input",
        fields: {
          sessionId: stringField({ minLength: 1 }),
          userId: stringField({ minLength: 1 }),
          defaultProfileId: stringField({ minLength: 1 }),
          intentText: stringField({ minLength: 1 }),
          locale: stringField({ minLength: 1, required: false }),
          metadata: jsonField({ required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "automation.draft.from-intent.output",
        fields: {
          status: enumField(AUTOMATION_DRAFT_STATUSES),
          draftId: stringField({ minLength: 1 }),
          summary: stringField({ minLength: 1 }),
          triggerType: enumField(AUTOMATION_TRIGGER_TYPES),
          schedule: jsonField(),
          runScope: jsonField(),
          selectedModelLane: enumField(AUTOMATION_MODEL_LANES),
          approvalRequired: booleanField(),
          reason: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 20_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: AUTOMATION_RUN_ACTION.actionId,
      version: AUTOMATION_RUN_ACTION.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "automation.run.execute.input",
        fields: {
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
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "automation.run.execute.output",
        fields: {
          status: enumField(AUTOMATION_RUN_STATUSES),
          automationId: stringField({ minLength: 1 }),
          runId: stringField({ minLength: 1 }),
          trigger: enumField(AUTOMATION_TRIGGER_TYPES),
          selectedModelLane: enumField(AUTOMATION_MODEL_LANES),
          escalationApplied: booleanField(),
          stepCount: numberField({ min: 0 }),
          resolvedProfileScope: enumField(AUTOMATION_PROFILE_RESOLUTION_SCOPES, {
            required: false,
          }),
          skipReason: enumField(AUTOMATION_SKIP_REASONS, { required: false }),
          blockReason: enumField(
            [...AUTOMATION_BLOCK_REASONS, "profile_not_resolved"],
            { required: false },
          ),
          outcome: jsonField({ required: false }),
          failure: jsonField({ required: false }),
          retryEligible: booleanField(),
          deadLetterEligible: booleanField(),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 30_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
  ]);
}
