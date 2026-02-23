import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringArrayField,
  stringField,
} from "./runtime-contracts.mjs";

export const HEARTBEAT_TRIGGERS = Object.freeze(["schedule", "manual", "event"]);
export const HEARTBEAT_MODEL_LANES = Object.freeze(["local", "worker", "brain"]);
export const HEARTBEAT_ESCALATION_TARGETS = Object.freeze(["worker", "brain"]);
export const HEARTBEAT_DELIVERY_RULES = Object.freeze([
  "ok",
  "alerts",
  "indicators",
]);
export const HEARTBEAT_RUN_STATUSES = Object.freeze(["executed", "skipped"]);
export const HEARTBEAT_SKIP_REASONS = Object.freeze([
  "policy_inactive",
  "outside_active_hours",
  "no_active_checks",
  "queue_backpressure",
  "budget_exceeded",
  "profile_not_resolved",
]);
export const HEARTBEAT_PROFILE_RESOLUTION_SCOPES = Object.freeze([
  "session",
  "workspace",
  "global",
  "default",
  "direct",
]);

export const HEARTBEAT_TICK_ACTION = Object.freeze({
  actionId: "heartbeat.tick.execute",
  version: 1,
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createHeartbeatContract(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze({
    actionId: HEARTBEAT_TICK_ACTION.actionId,
    version: HEARTBEAT_TICK_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "heartbeat.tick.execute.input",
      fields: {
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
        escalationTargetLane: enumField(HEARTBEAT_ESCALATION_TARGETS, {
          required: false,
        }),
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
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "heartbeat.tick.execute.output",
      fields: {
        status: enumField(HEARTBEAT_RUN_STATUSES),
        policyId: stringField({ minLength: 1 }),
        profileId: stringField({ minLength: 1, required: false }),
        runId: stringField({ minLength: 1 }),
        trigger: enumField(HEARTBEAT_TRIGGERS),
        selectedModelLane: enumField(HEARTBEAT_MODEL_LANES),
        escalationApplied: booleanField(),
        checkCount: numberField({ min: 0 }),
        resolvedProfileScope: enumField(HEARTBEAT_PROFILE_RESOLUTION_SCOPES, {
          required: false,
        }),
        deliveryRule: enumField(HEARTBEAT_DELIVERY_RULES),
        skipReason: enumField(HEARTBEAT_SKIP_REASONS, { required: false }),
        executionPlan: jsonField(),
        outcome: jsonField({ required: false }),
      },
    }),
    riskClass,
    trustClass,
    timeoutMs: 30_000,
    retryPolicy: {
      maxAttempts: 1,
    },
  });
}
