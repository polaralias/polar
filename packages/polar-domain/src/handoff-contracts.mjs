import {
  createStrictObjectSchema,
  enumField,
  jsonField,
  stringArrayField,
  stringField,
} from "./runtime-contracts.mjs";

export const HANDOFF_ROUTING_MODES = Object.freeze([
  "direct",
  "delegate",
  "fanout-fanin",
]);

export const HANDOFF_STATUSES = Object.freeze(["completed", "failed"]);
export const HANDOFF_PROFILE_RESOLUTION_SCOPES = Object.freeze([
  "session",
  "workspace",
  "global",
  "default",
  "direct",
]);

export const HANDOFF_ACTION = Object.freeze({
  actionId: "agent.handoff.execute",
  version: 1,
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createHandoffContract(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze({
    actionId: HANDOFF_ACTION.actionId,
    version: HANDOFF_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "agent.handoff.execute.input",
      fields: {
        mode: enumField(HANDOFF_ROUTING_MODES),
        sourceAgentId: stringField({ minLength: 1 }),
        targetAgentId: stringField({ minLength: 1, required: false }),
        targetAgentIds: stringArrayField({ minItems: 1, required: false }),
        reason: stringField({ minLength: 1 }),
        sessionId: stringField({ minLength: 1 }),
        workspaceId: stringField({ minLength: 1, required: false }),
        userId: stringField({ minLength: 1 }),
        profileId: stringField({ minLength: 1, required: false }),
        defaultProfileId: stringField({ minLength: 1, required: false }),
        resolvedProfileScope: enumField(HANDOFF_PROFILE_RESOLUTION_SCOPES, {
          required: false,
        }),
        capabilityScope: jsonField(),
        payload: jsonField(),
        policyContext: jsonField({ required: false }),
        budgetContext: jsonField({ required: false }),
        traceMetadata: jsonField({ required: false }),
        routingDiagnostics: jsonField({ required: false }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "agent.handoff.execute.output",
      fields: {
        status: enumField(HANDOFF_STATUSES),
        mode: enumField(HANDOFF_ROUTING_MODES),
        sourceAgentId: stringField({ minLength: 1 }),
        targetAgentId: stringField({ minLength: 1, required: false }),
        targetAgentIds: stringArrayField({ minItems: 1, required: false }),
        profileId: stringField({ minLength: 1, required: false }),
        resolvedProfileScope: enumField(HANDOFF_PROFILE_RESOLUTION_SCOPES, {
          required: false,
        }),
        capabilityScope: jsonField(),
        outputPayload: jsonField({ required: false }),
        failure: jsonField({ required: false }),
        routingDiagnostics: jsonField({ required: false }),
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
