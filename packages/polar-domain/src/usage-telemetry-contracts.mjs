import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "./runtime-contracts.mjs";

export const USAGE_TELEMETRY_STATUSES = Object.freeze(["ok"]);
export const USAGE_TELEMETRY_OPERATIONS = Object.freeze([
  "generate",
  "stream",
  "embed",
]);
export const USAGE_TELEMETRY_EVENT_STATUSES = Object.freeze([
  "completed",
  "failed",
]);
export const USAGE_TELEMETRY_MODEL_LANES = Object.freeze([
  "local",
  "worker",
  "brain",
]);

export const USAGE_TELEMETRY_ACTION = Object.freeze({
  actionId: "runtime.usage-telemetry.list",
  version: 1,
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createUsageTelemetryContract(options = {}) {
  const { trustClass = "native", riskClass = "low" } = options;

  return Object.freeze({
    actionId: USAGE_TELEMETRY_ACTION.actionId,
    version: USAGE_TELEMETRY_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "runtime.usage-telemetry.list.input",
      fields: {
        fromSequence: numberField({ min: 1, required: false }),
        limit: numberField({ min: 1, max: 500, required: false }),
        operation: enumField(USAGE_TELEMETRY_OPERATIONS, {
          required: false,
        }),
        providerId: stringField({ minLength: 1, required: false }),
        requestedProviderId: stringField({ minLength: 1, required: false }),
        status: enumField(USAGE_TELEMETRY_EVENT_STATUSES, {
          required: false,
        }),
        modelLane: enumField(USAGE_TELEMETRY_MODEL_LANES, {
          required: false,
        }),
        fallbackUsed: booleanField({ required: false }),
        executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
          required: false,
        }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "runtime.usage-telemetry.list.output",
      fields: {
        status: enumField(USAGE_TELEMETRY_STATUSES),
        fromSequence: numberField({ min: 1 }),
        returnedCount: numberField({ min: 0 }),
        totalCount: numberField({ min: 0 }),
        nextFromSequence: numberField({ min: 1, required: false }),
        items: jsonField(),
        summary: jsonField(),
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
