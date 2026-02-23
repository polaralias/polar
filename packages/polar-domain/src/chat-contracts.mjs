import {
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringArrayField,
  stringField,
} from "./runtime-contracts.mjs";

export const CHAT_CHANNELS = Object.freeze([
  "web",
  "telegram",
  "slack",
  "discord",
  "other",
]);

export const INGRESS_ADAPTERS = Object.freeze(["web", "telegram", "slack", "discord"]);

export const CHAT_INGRESS_ACTION = Object.freeze({
  actionId: "chat.ingress.normalize",
  version: 1,
});

export const CHAT_INGRESS_HEALTH_ACTION = Object.freeze({
  actionId: "chat.ingress.health.check",
  version: 1,
});

export const INGRESS_HEALTH_STATUSES = Object.freeze(["healthy", "unhealthy"]);

export const CANONICAL_CHAT_ENVELOPE_SCHEMA = createStrictObjectSchema({
  schemaId: "chat.ingress.canonical.envelope",
  fields: {
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    channel: enumField(CHAT_CHANNELS),
    messageId: stringField({ minLength: 1 }),
    messageText: stringField({ minLength: 1 }),
    timestampMs: numberField({ min: 0 }),
    locale: stringField({ minLength: 1, required: false }),
    threadId: stringField({ minLength: 1, required: false }),
    routingHints: stringArrayField({ minItems: 0 }),
    metadata: jsonField(),
  },
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createChatIngressContract(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze({
    actionId: CHAT_INGRESS_ACTION.actionId,
    version: CHAT_INGRESS_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "chat.ingress.normalize.input",
      fields: {
        adapter: enumField(INGRESS_ADAPTERS),
        payload: jsonField(),
      },
    }),
    outputSchema: CANONICAL_CHAT_ENVELOPE_SCHEMA,
    riskClass,
    trustClass,
    timeoutMs: 30_000,
    retryPolicy: {
      maxAttempts: 1,
    },
  });
}

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createChatIngressHealthContract(options = {}) {
  const { trustClass = "native", riskClass = "low" } = options;

  return Object.freeze({
    actionId: CHAT_INGRESS_HEALTH_ACTION.actionId,
    version: CHAT_INGRESS_HEALTH_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "chat.ingress.health.check.input",
      fields: {
        adapter: enumField(INGRESS_ADAPTERS, { required: false }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "chat.ingress.health.check.output",
      fields: {
        status: enumField(INGRESS_HEALTH_STATUSES),
        checkedAtMs: numberField({ min: 0 }),
        resultCount: numberField({ min: 1 }),
        results: jsonField(),
      },
    }),
    riskClass,
    trustClass,
    timeoutMs: 15_000,
    retryPolicy: {
      maxAttempts: 1,
    },
  });
}
