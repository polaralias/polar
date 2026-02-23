import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  stringField,
} from "./runtime-contracts.mjs";

export const TOOL_LIFECYCLE_ACTION = Object.freeze({
  actionId: "tool.lifecycle",
  version: 1,
});

export const TOOL_LIFECYCLE_PHASES = Object.freeze(["before", "after"]);
export const TOOL_LIFECYCLE_SOURCES = Object.freeze(["pi-agent-loop"]);

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createToolLifecycleContract(options = {}) {
  const { trustClass = "native", riskClass = "high" } = options;

  return Object.freeze({
    actionId: TOOL_LIFECYCLE_ACTION.actionId,
    version: TOOL_LIFECYCLE_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "tool.lifecycle.input",
      fields: {
        phase: enumField(TOOL_LIFECYCLE_PHASES),
        toolCallId: stringField({ minLength: 1 }),
        toolName: stringField({ minLength: 1 }),
        source: enumField(TOOL_LIFECYCLE_SOURCES),
        payloadJson: stringField({ minLength: 1, required: false }),
        isError: booleanField({ required: false }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "tool.lifecycle.output",
      fields: {
        status: enumField(["accepted"]),
        phase: enumField(TOOL_LIFECYCLE_PHASES),
        toolCallId: stringField({ minLength: 1 }),
        toolName: stringField({ minLength: 1 }),
        source: enumField(TOOL_LIFECYCLE_SOURCES),
      },
    }),
    riskClass,
    trustClass,
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 1,
    },
  });
}
