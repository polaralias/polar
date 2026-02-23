import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "./runtime-contracts.mjs";
import { HANDOFF_ROUTING_EVENT_STATUSES } from "./handoff-telemetry-contracts.mjs";
import {
  USAGE_TELEMETRY_EVENT_STATUSES,
  USAGE_TELEMETRY_MODEL_LANES,
  USAGE_TELEMETRY_OPERATIONS,
} from "./usage-telemetry-contracts.mjs";
import {
  TASK_BOARD_ASSIGNEE_TYPES,
  TASK_BOARD_STATUSES,
} from "./task-board-contracts.mjs";

export const TELEMETRY_ALERT_SCOPES = Object.freeze([
  "usage",
  "handoff",
  "all",
]);
export const TELEMETRY_ALERT_STATUSES = Object.freeze(["ok"]);
export const TELEMETRY_ALERT_SOURCES = Object.freeze(["usage", "handoff"]);
export const TELEMETRY_ALERT_SEVERITIES = Object.freeze([
  "warning",
  "critical",
]);

export const TELEMETRY_ALERT_ACTION = Object.freeze({
  actionId: "runtime.telemetry.alerts.list",
  version: 1,
});
export const TELEMETRY_ALERT_ROUTE_ACTION = Object.freeze({
  actionId: "runtime.telemetry.alerts.route",
  version: 1,
});

function createListInputFields() {
  return {
    scope: enumField(TELEMETRY_ALERT_SCOPES, { required: false }),
    minimumSampleSize: numberField({ min: 1, max: 10_000, required: false }),
    usageFromSequence: numberField({ min: 1, required: false }),
    usageLimit: numberField({ min: 1, max: 500, required: false }),
    usageOperation: enumField(USAGE_TELEMETRY_OPERATIONS, { required: false }),
    usageProviderId: stringField({ minLength: 1, required: false }),
    usageRequestedProviderId: stringField({ minLength: 1, required: false }),
    usageStatus: enumField(USAGE_TELEMETRY_EVENT_STATUSES, {
      required: false,
    }),
    usageModelLane: enumField(USAGE_TELEMETRY_MODEL_LANES, {
      required: false,
    }),
    usageFallbackUsed: booleanField({ required: false }),
    usageExecutionType: enumField(
      ["tool", "handoff", "automation", "heartbeat"],
      { required: false },
    ),
    usageFailureRateWarning: numberField({
      min: 0,
      max: 1,
      required: false,
    }),
    usageFailureRateCritical: numberField({
      min: 0,
      max: 1,
      required: false,
    }),
    usageFallbackRateWarning: numberField({
      min: 0,
      max: 1,
      required: false,
    }),
    usageFallbackRateCritical: numberField({
      min: 0,
      max: 1,
      required: false,
    }),
    usageAverageDurationMsWarning: numberField({
      min: 0,
      required: false,
    }),
    usageAverageDurationMsCritical: numberField({
      min: 0,
      required: false,
    }),
    handoffFromSequence: numberField({ min: 1, required: false }),
    handoffLimit: numberField({ min: 1, max: 500, required: false }),
    handoffMode: enumField(["direct", "delegate", "fanout-fanin"], {
      required: false,
    }),
    handoffRouteAdjustedOnly: booleanField({ required: false }),
    handoffProfileResolutionStatus: enumField(["resolved", "not_resolved"], {
      required: false,
    }),
    handoffSessionId: stringField({ minLength: 1, required: false }),
    handoffWorkspaceId: stringField({ minLength: 1, required: false }),
    handoffSourceAgentId: stringField({ minLength: 1, required: false }),
    handoffStatus: enumField(HANDOFF_ROUTING_EVENT_STATUSES, {
      required: false,
    }),
    handoffFailureRateWarning: numberField({
      min: 0,
      max: 1,
      required: false,
    }),
    handoffFailureRateCritical: numberField({
      min: 0,
      max: 1,
      required: false,
    }),
    handoffRouteAdjustedRateWarning: numberField({
      min: 0,
      max: 1,
      required: false,
    }),
    handoffRouteAdjustedRateCritical: numberField({
      min: 0,
      max: 1,
      required: false,
    }),
  };
}

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createTelemetryAlertContract(options = {}) {
  const { trustClass = "native", riskClass = "low" } = options;

  return Object.freeze({
    actionId: TELEMETRY_ALERT_ACTION.actionId,
    version: TELEMETRY_ALERT_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "runtime.telemetry.alerts.list.input",
      fields: createListInputFields(),
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "runtime.telemetry.alerts.list.output",
      fields: {
        status: enumField(TELEMETRY_ALERT_STATUSES),
        evaluatedAtMs: numberField({ min: 0 }),
        scope: enumField(TELEMETRY_ALERT_SCOPES),
        minimumSampleSize: numberField({ min: 1 }),
        alertCount: numberField({ min: 0 }),
        alerts: jsonField(),
        usageWindow: jsonField(),
        handoffWindow: jsonField(),
      },
    }),
    riskClass,
    trustClass,
    timeoutMs: 10_000,
    retryPolicy: {
      maxAttempts: 1,
    },
  });
}

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createTelemetryAlertRouteContract(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze({
    actionId: TELEMETRY_ALERT_ROUTE_ACTION.actionId,
    version: TELEMETRY_ALERT_ROUTE_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "runtime.telemetry.alerts.route.input",
      fields: {
        ...createListInputFields(),
        minimumSeverity: enumField(TELEMETRY_ALERT_SEVERITIES, {
          required: false,
        }),
        maxAlerts: numberField({ min: 1, max: 200, required: false }),
        assigneeType: enumField(TASK_BOARD_ASSIGNEE_TYPES),
        assigneeId: stringField({ minLength: 1 }),
        taskStatus: enumField(TASK_BOARD_STATUSES, { required: false }),
        taskIdPrefix: stringField({ minLength: 1, required: false }),
        titlePrefix: stringField({ minLength: 1, required: false }),
        actorId: stringField({ minLength: 1, required: false }),
        sessionId: stringField({ minLength: 1, required: false }),
        runId: stringField({ minLength: 1, required: false }),
        metadata: jsonField({ required: false }),
        dryRun: booleanField({ required: false }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "runtime.telemetry.alerts.route.output",
      fields: {
        status: enumField(["ok"]),
        evaluatedAtMs: numberField({ min: 0 }),
        scope: enumField(TELEMETRY_ALERT_SCOPES),
        minimumSampleSize: numberField({ min: 1 }),
        minimumSeverity: enumField(TELEMETRY_ALERT_SEVERITIES),
        maxAlerts: numberField({ min: 1, max: 200 }),
        alertCount: numberField({ min: 0 }),
        routedCount: numberField({ min: 0 }),
        previewCount: numberField({ min: 0 }),
        skippedCount: numberField({ min: 0 }),
        rejectedCount: numberField({ min: 0 }),
        items: jsonField(),
        alerts: jsonField(),
        usageWindow: jsonField(),
        handoffWindow: jsonField(),
      },
    }),
    riskClass,
    trustClass,
    timeoutMs: 20_000,
    retryPolicy: {
      maxAttempts: 1,
    },
  });
}
