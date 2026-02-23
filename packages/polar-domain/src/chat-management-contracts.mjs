import { CHAT_CHANNELS } from "./chat-contracts.mjs";
import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "./runtime-contracts.mjs";

export const CHAT_MESSAGE_ROLES = Object.freeze(["user", "assistant", "system"]);

export const CHAT_MANAGEMENT_ACTIONS = Object.freeze({
  appendMessage: Object.freeze({
    actionId: "chat.message.append",
    version: 1,
  }),
  listSessions: Object.freeze({
    actionId: "chat.session.list",
    version: 1,
  }),
  getSessionHistory: Object.freeze({
    actionId: "chat.session.history.get",
    version: 1,
  }),
  searchMessages: Object.freeze({
    actionId: "chat.message.search",
    version: 1,
  }),
  applyRetention: Object.freeze({
    actionId: "chat.session.retention.apply",
    version: 1,
  }),
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createChatManagementContracts(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze([
    Object.freeze({
      actionId: CHAT_MANAGEMENT_ACTIONS.appendMessage.actionId,
      version: CHAT_MANAGEMENT_ACTIONS.appendMessage.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "chat.message.append.input",
        fields: {
          sessionId: stringField({ minLength: 1 }),
          userId: stringField({ minLength: 1 }),
          messageId: stringField({ minLength: 1 }),
          role: enumField(CHAT_MESSAGE_ROLES),
          text: stringField({ minLength: 1 }),
          timestampMs: numberField({ min: 0 }),
          threadId: stringField({ minLength: 1, required: false }),
          metadata: jsonField({ required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "chat.message.append.output",
        fields: {
          status: enumField(["appended", "rejected"]),
          sessionId: stringField({ minLength: 1 }),
          messageId: stringField({ minLength: 1 }),
          messageCount: numberField({ min: 0 }),
          reason: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 10_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: CHAT_MANAGEMENT_ACTIONS.listSessions.actionId,
      version: CHAT_MANAGEMENT_ACTIONS.listSessions.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "chat.session.list.input",
        fields: {
          channel: enumField(CHAT_CHANNELS, { required: false }),
          query: stringField({ minLength: 1, required: false }),
          includeArchived: booleanField({ required: false }),
          cursor: stringField({ minLength: 1, required: false }),
          limit: numberField({ min: 1, max: 100, required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "chat.session.list.output",
        fields: {
          status: enumField(["ok"]),
          items: jsonField(),
          totalCount: numberField({ min: 0 }),
          nextCursor: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 15_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: CHAT_MANAGEMENT_ACTIONS.getSessionHistory.actionId,
      version: CHAT_MANAGEMENT_ACTIONS.getSessionHistory.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "chat.session.history.get.input",
        fields: {
          sessionId: stringField({ minLength: 1 }),
          cursor: stringField({ minLength: 1, required: false }),
          limit: numberField({ min: 1, max: 500, required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "chat.session.history.get.output",
        fields: {
          status: enumField(["ok", "not_found"]),
          sessionId: stringField({ minLength: 1 }),
          items: jsonField(),
          totalCount: numberField({ min: 0 }),
          nextCursor: stringField({ minLength: 1, required: false }),
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
      actionId: CHAT_MANAGEMENT_ACTIONS.searchMessages.actionId,
      version: CHAT_MANAGEMENT_ACTIONS.searchMessages.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "chat.message.search.input",
        fields: {
          query: stringField({ minLength: 1 }),
          sessionId: stringField({ minLength: 1, required: false }),
          channel: enumField(CHAT_CHANNELS, { required: false }),
          includeArchived: booleanField({ required: false }),
          cursor: stringField({ minLength: 1, required: false }),
          limit: numberField({ min: 1, max: 500, required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "chat.message.search.output",
        fields: {
          status: enumField(["ok"]),
          items: jsonField(),
          totalCount: numberField({ min: 0 }),
          nextCursor: stringField({ minLength: 1, required: false }),
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
      actionId: CHAT_MANAGEMENT_ACTIONS.applyRetention.actionId,
      version: CHAT_MANAGEMENT_ACTIONS.applyRetention.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "chat.session.retention.apply.input",
        fields: {
          sessionId: stringField({ minLength: 1 }),
          retentionDays: numberField({ min: 1, max: 3_650 }),
          archiveNow: booleanField({ required: false }),
          actorId: stringField({ minLength: 1, required: false }),
          reason: stringField({ minLength: 1, required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "chat.session.retention.apply.output",
        fields: {
          status: enumField(["applied", "rejected"]),
          sessionId: stringField({ minLength: 1 }),
          retentionDays: numberField({ min: 1, max: 3_650 }),
          archived: booleanField(),
          reason: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 10_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
  ]);
}
