import {
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringArrayField,
  stringField,
} from "./runtime-contracts.mjs";

export const PROACTIVE_INBOX_CAPABILITIES = Object.freeze([
  "mail.search_headers",
  "mail.read_body",
]);

export const PROACTIVE_INBOX_STATUSES = Object.freeze([
  "completed",
  "blocked",
  "degraded",
]);

export const PROACTIVE_INBOX_MODES = Object.freeze([
  "headers_only",
  "read_body",
]);

export const PROACTIVE_INBOX_ACTIONS = Object.freeze({
  checkHeaders: Object.freeze({
    actionId: "proactive-inbox.check-headers",
    version: 1,
  }),
  readBody: Object.freeze({
    actionId: "proactive-inbox.read-body",
    version: 1,
  }),
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createProactiveInboxContracts(options = {}) {
  const { trustClass = "native", riskClass = "high" } = options;

  return Object.freeze([
    Object.freeze({
      actionId: PROACTIVE_INBOX_ACTIONS.checkHeaders.actionId,
      version: PROACTIVE_INBOX_ACTIONS.checkHeaders.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "proactive-inbox.check-headers.input",
        fields: {
          sessionId: stringField({ minLength: 1 }),
          userId: stringField({ minLength: 1 }),
          connectorId: stringField({ minLength: 1, required: false }),
          lookbackHours: numberField({ min: 1, max: 168, required: false }),
          maxHeaders: numberField({ min: 1, max: 100, required: false }),
          capabilities: stringArrayField({ minItems: 1, required: false }),
          mode: enumField(PROACTIVE_INBOX_MODES, { required: false }),
          metadata: jsonField({ required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "proactive-inbox.check-headers.output",
        fields: {
          status: enumField(PROACTIVE_INBOX_STATUSES),
          mode: enumField(PROACTIVE_INBOX_MODES),
          blockedReason: stringField({ minLength: 1, required: false }),
          degradedReason: stringField({ minLength: 1, required: false }),
          connectorStatus: enumField(["configured", "not_configured"]),
          headerCount: numberField({ min: 0 }),
          headers: jsonField(),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 15_000,
      retryPolicy: { maxAttempts: 1 },
    }),
    Object.freeze({
      actionId: PROACTIVE_INBOX_ACTIONS.readBody.actionId,
      version: PROACTIVE_INBOX_ACTIONS.readBody.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "proactive-inbox.read-body.input",
        fields: {
          sessionId: stringField({ minLength: 1 }),
          userId: stringField({ minLength: 1 }),
          messageId: stringField({ minLength: 1 }),
          connectorId: stringField({ minLength: 1, required: false }),
          capabilities: stringArrayField({ minItems: 1, required: false }),
          metadata: jsonField({ required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "proactive-inbox.read-body.output",
        fields: {
          status: enumField(PROACTIVE_INBOX_STATUSES),
          blockedReason: stringField({ minLength: 1, required: false }),
          degradedReason: stringField({ minLength: 1, required: false }),
          connectorStatus: enumField(["configured", "not_configured"]),
          messageId: stringField({ minLength: 1 }),
          body: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass: "critical",
      trustClass,
      timeoutMs: 15_000,
      retryPolicy: { maxAttempts: 1 },
    }),
  ]);
}
