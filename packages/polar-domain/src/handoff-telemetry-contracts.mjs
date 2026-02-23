import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
} from "./runtime-contracts.mjs";

export const HANDOFF_ROUTING_TELEMETRY_STATUSES = Object.freeze(["ok"]);
export const HANDOFF_ROUTING_TELEMETRY_PROFILE_RESOLUTION_STATUSES = Object.freeze([
  "resolved",
  "not_resolved",
]);

export const HANDOFF_ROUTING_TELEMETRY_ACTION = Object.freeze({
  actionId: "agent.handoff.routing-telemetry.list",
  version: 1,
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createHandoffRoutingTelemetryContract(options = {}) {
  const { trustClass = "native", riskClass = "low" } = options;

  return Object.freeze({
    actionId: HANDOFF_ROUTING_TELEMETRY_ACTION.actionId,
    version: HANDOFF_ROUTING_TELEMETRY_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "agent.handoff.routing-telemetry.list.input",
      fields: {
        fromSequence: numberField({ min: 1, required: false }),
        limit: numberField({ min: 1, max: 500, required: false }),
        mode: enumField(["direct", "delegate", "fanout-fanin"], {
          required: false,
        }),
        routeAdjustedOnly: booleanField({ required: false }),
        profileResolutionStatus: enumField(
          HANDOFF_ROUTING_TELEMETRY_PROFILE_RESOLUTION_STATUSES,
          {
            required: false,
          },
        ),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "agent.handoff.routing-telemetry.list.output",
      fields: {
        status: enumField(HANDOFF_ROUTING_TELEMETRY_STATUSES),
        fromSequence: numberField({ min: 1 }),
        returnedCount: numberField({ min: 0 }),
        totalCount: numberField({ min: 0 }),
        nextFromSequence: numberField({ min: 1, required: false }),
        items: jsonField(),
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
