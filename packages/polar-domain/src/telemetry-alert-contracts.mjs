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
      fields: {
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
      },
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
