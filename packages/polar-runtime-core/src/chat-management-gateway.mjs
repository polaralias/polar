import {
  CHAT_CHANNELS,
  CHAT_MANAGEMENT_ACTIONS,
  CHAT_MESSAGE_ROLES,
  ContractValidationError,
  RuntimeExecutionError,
  booleanField,
  createChatManagementContracts,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringArrayField,
  stringField,
} from "@polar/domain";

const appendMessageRequestSchema = createStrictObjectSchema({
  schemaId: "chat.management.gateway.message.append.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    messageId: stringField({ minLength: 1 }),
    role: enumField(CHAT_MESSAGE_ROLES),
    text: stringField({ minLength: 1 }),
    timestampMs: numberField({ min: 0 }),
    threadId: stringField({ minLength: 1, required: false }),
    metadata: jsonField({ required: false }),
  },
});

const listSessionsRequestSchema = createStrictObjectSchema({
  schemaId: "chat.management.gateway.session.list.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    channel: enumField(CHAT_CHANNELS, { required: false }),
    query: stringField({ minLength: 1, required: false }),
    includeArchived: booleanField({ required: false }),
    cursor: stringField({ minLength: 1, required: false }),
    limit: numberField({ min: 1, max: 100, required: false }),
  },
});

const historyRequestSchema = createStrictObjectSchema({
  schemaId: "chat.management.gateway.session.history.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1 }),
    cursor: stringField({ minLength: 1, required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
  },
});

const searchRequestSchema = createStrictObjectSchema({
  schemaId: "chat.management.gateway.message.search.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    query: stringField({ minLength: 1 }),
    sessionId: stringField({ minLength: 1, required: false }),
    channel: enumField(CHAT_CHANNELS, { required: false }),
    includeArchived: booleanField({ required: false }),
    cursor: stringField({ minLength: 1, required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
  },
});

const retentionRequestSchema = createStrictObjectSchema({
  schemaId: "chat.management.gateway.session.retention.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1 }),
    retentionDays: numberField({ min: 1, max: 3_650 }),
    archiveNow: booleanField({ required: false }),
    actorId: stringField({ minLength: 1, required: false }),
    reason: stringField({ minLength: 1, required: false }),
  },
});

const sessionRecordSchema = createStrictObjectSchema({
  schemaId: "chat.management.gateway.session-record",
  fields: {
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    channel: enumField(CHAT_CHANNELS),
    title: stringField({ minLength: 1, required: false }),
    tags: stringArrayField({ minItems: 0, required: false }),
    archived: booleanField({ required: false }),
    retentionDays: numberField({ min: 1, max: 3_650, required: false }),
    createdAtMs: numberField({ min: 0 }),
    updatedAtMs: numberField({ min: 0 }),
    lastMessageAtMs: numberField({ min: 0, required: false }),
    metadata: jsonField({ required: false }),
  },
});

const messageRecordSchema = createStrictObjectSchema({
  schemaId: "chat.management.gateway.message-record",
  fields: {
    messageId: stringField({ minLength: 1 }),
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    role: enumField(CHAT_MESSAGE_ROLES),
    text: stringField({ minLength: 1 }),
    timestampMs: numberField({ min: 0 }),
    threadId: stringField({ minLength: 1, required: false }),
    metadata: jsonField({ required: false }),
  },
});

/**
 * @param {unknown} value
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function validateRequest(value, schemaId) {
  const schema = {
    [appendMessageRequestSchema.schemaId]: appendMessageRequestSchema,
    [listSessionsRequestSchema.schemaId]: listSessionsRequestSchema,
    [historyRequestSchema.schemaId]: historyRequestSchema,
    [searchRequestSchema.schemaId]: searchRequestSchema,
    [retentionRequestSchema.schemaId]: retentionRequestSchema,
    [sessionRecordSchema.schemaId]: sessionRecordSchema,
    [messageRecordSchema.schemaId]: messageRecordSchema,
  }[schemaId];

  const validation = schema.validate(value);
  if (!validation.ok) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: validation.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {readonly string[]|undefined} value
 * @returns {readonly string[]}
 */
function normalizeTags(value) {
  const tags = value ?? [];
  const deduped = new Set();
  for (const tag of tags) {
    if (typeof tag === "string" && tag.length > 0) {
      deduped.add(tag);
    }
  }

  return Object.freeze([...deduped].sort((left, right) => left.localeCompare(right)));
}

/**
 * @param {string} sessionId
 * @returns {"web"|"telegram"|"slack"|"discord"|"other"}
 */
function inferChannelFromSessionId(sessionId) {
  if (sessionId.startsWith("telegram:chat:")) {
    return "telegram";
  }
  if (sessionId.startsWith("slack:channel:")) {
    return "slack";
  }
  if (sessionId.startsWith("discord:channel:")) {
    return "discord";
  }
  if (sessionId.startsWith("web:")) {
    return "web";
  }
  return "other";
}

/**
 * @param {{
 *   sessionId: string,
 *   userId: string,
 *   timestampMs: number
 * }} input
 * @returns {Record<string, unknown>}
 */
function createAutoSessionRecord(input) {
  return normalizeSessionRecord({
    sessionId: input.sessionId,
    userId: input.userId,
    channel: inferChannelFromSessionId(input.sessionId),
    createdAtMs: input.timestampMs,
    updatedAtMs: input.timestampMs,
  });
}

/**
 * @param {string|undefined} cursor
 * @param {string} schemaId
 * @returns {number}
 */
function parseCursor(cursor, schemaId) {
  if (cursor === undefined) {
    return 0;
  }

  if (!/^\d+$/.test(cursor)) {
    throw new ContractValidationError("Invalid chat-management cursor", {
      schemaId,
      errors: [`${schemaId}.cursor must be an unsigned integer string`],
    });
  }

  const offset = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ContractValidationError("Invalid chat-management cursor", {
      schemaId,
      errors: [`${schemaId}.cursor must be a safe non-negative integer`],
    });
  }

  return offset;
}

/**
 * @param {Record<string, unknown>} session
 * @returns {Record<string, unknown>}
 */
function normalizeSessionRecord(session) {
  return validateRequest(
    {
      ...session,
      tags: normalizeTags(
        /** @type {readonly string[]|undefined} */ (session.tags),
      ),
      archived: session.archived === true,
    },
    sessionRecordSchema.schemaId,
  );
}

/**
 * @param {readonly Record<string, unknown>[]|undefined} value
 * @returns {readonly Record<string, unknown>[]}
 */
function sortMessages(value) {
  const messages = value ?? [];
  return Object.freeze(
    [...messages].sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) {
        return left.timestampMs - right.timestampMs;
      }

      return left.messageId.localeCompare(right.messageId);
    }),
  );
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerChatManagementContracts(contractRegistry) {
  for (const contract of createChatManagementContracts()) {
    if (!contractRegistry.has(contract.actionId, contract.version)) {
      contractRegistry.register(contract);
    }
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   initialSessions?: readonly Record<string, unknown>[],
 *   initialMessages?: readonly Record<string, unknown>[],
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat",
 *   now?: () => number
 * }} config
 */
export function createChatManagementGateway({
  middlewarePipeline,
  initialSessions = [],
  initialMessages = [],
  defaultExecutionType = "tool",
  now = () => Date.now(),
}) {
  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const sessions = new Map();
  /** @type {Map<string, Record<string, unknown>[]>} */
  const messagesBySession = new Map();

  const ensureMessageCollection = (sessionId) => {
    if (!messagesBySession.has(sessionId)) {
      messagesBySession.set(sessionId, []);
    }

    return /** @type {Record<string, unknown>[]} */ (messagesBySession.get(sessionId));
  };

  for (const initialSession of initialSessions) {
    const normalized = normalizeSessionRecord(initialSession);
    sessions.set(/** @type {string} */ (normalized.sessionId), normalized);
    ensureMessageCollection(/** @type {string} */ (normalized.sessionId));
  }

  for (const initialMessage of initialMessages) {
    const normalizedMessage = validateRequest(
      initialMessage,
      messageRecordSchema.schemaId,
    );
    const sessionId = /** @type {string} */ (normalizedMessage.sessionId);
    if (!sessions.has(sessionId)) {
      throw new RuntimeExecutionError(
        "Initial message references unknown session",
        {
          sessionId,
          messageId: normalizedMessage.messageId,
        },
      );
    }
    const existingMessages = ensureMessageCollection(sessionId);
    existingMessages.push(normalizedMessage);
  }

  for (const [sessionId, messageList] of messagesBySession.entries()) {
    const sorted = sortMessages(messageList);
    messagesBySession.set(sessionId, [...sorted]);
    const session = sessions.get(sessionId);
    if (session && sorted.length > 0) {
      const latestMessage = sorted[sorted.length - 1];
      sessions.set(
        sessionId,
        normalizeSessionRecord({
          ...session,
          lastMessageAtMs: latestMessage.timestampMs,
          updatedAtMs: Math.max(session.updatedAtMs, latestMessage.timestampMs),
        }),
      );
    }
  }

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async appendMessage(request) {
      const parsed = validateRequest(request, appendMessageRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: CHAT_MANAGEMENT_ACTIONS.appendMessage.actionId,
          version: CHAT_MANAGEMENT_ACTIONS.appendMessage.version,
          input: {
            sessionId: parsed.sessionId,
            userId: parsed.userId,
            messageId: parsed.messageId,
            role: parsed.role,
            text: parsed.text,
            timestampMs: parsed.timestampMs,
            ...(parsed.threadId !== undefined ? { threadId: parsed.threadId } : {}),
            ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
          },
        },
        async (input) => {
          const sessionId = /** @type {string} */ (input.sessionId);
          let session = sessions.get(sessionId);
          if (!session) {
            session = createAutoSessionRecord({
              sessionId,
              userId: /** @type {string} */ (input.userId),
              timestampMs: /** @type {number} */ (input.timestampMs),
            });
            sessions.set(sessionId, session);
            ensureMessageCollection(sessionId);
          }

          const messageList = ensureMessageCollection(sessionId);
          if (
            messageList.some(
              (message) => message.messageId === /** @type {string} */ (input.messageId),
            )
          ) {
            return {
              status: "rejected",
              sessionId,
              messageId: input.messageId,
              messageCount: messageList.length,
              reason: "Message already exists in session",
            };
          }

          const normalizedMessage = validateRequest(
            input,
            messageRecordSchema.schemaId,
          );
          const nextMessages = [
            ...messageList,
            normalizedMessage,
          ];
          const sortedMessages = sortMessages(nextMessages);
          messagesBySession.set(sessionId, [...sortedMessages]);

          const latestMessage = sortedMessages[sortedMessages.length - 1];
          sessions.set(
            sessionId,
            normalizeSessionRecord({
              ...session,
              userId: normalizedMessage.userId,
              updatedAtMs: Math.max(session.updatedAtMs, normalizedMessage.timestampMs),
              lastMessageAtMs: latestMessage.timestampMs,
            }),
          );

          return {
            status: "appended",
            sessionId,
            messageId: normalizedMessage.messageId,
            messageCount: sortedMessages.length,
          };
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async listSessions(request) {
      const parsed = validateRequest(request, listSessionsRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: CHAT_MANAGEMENT_ACTIONS.listSessions.actionId,
          version: CHAT_MANAGEMENT_ACTIONS.listSessions.version,
          input: {
            ...(parsed.channel !== undefined ? { channel: parsed.channel } : {}),
            ...(parsed.query !== undefined ? { query: parsed.query } : {}),
            ...(parsed.includeArchived !== undefined
              ? { includeArchived: parsed.includeArchived }
              : {}),
            ...(parsed.cursor !== undefined ? { cursor: parsed.cursor } : {}),
            ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
          },
        },
        async (input) => {
          const includeArchived = input.includeArchived === true;
          const query =
            typeof input.query === "string"
              ? input.query.trim().toLowerCase()
              : null;
          const offset = parseCursor(
            /** @type {string|undefined} */ (input.cursor),
            listSessionsRequestSchema.schemaId,
          );
          const limit = /** @type {number|undefined} */ (input.limit) ?? 50;

          const filteredSessions = [...sessions.values()]
            .filter((session) => {
              if (!includeArchived && session.archived === true) {
                return false;
              }

              if (
                input.channel !== undefined &&
                session.channel !== input.channel
              ) {
                return false;
              }

              if (!query) {
                return true;
              }

              const searchable = [
                session.sessionId,
                session.userId,
                typeof session.title === "string" ? session.title : "",
                ...(Array.isArray(session.tags) ? session.tags : []),
              ].join(" ").toLowerCase();
              return searchable.includes(query);
            })
            .sort((left, right) => {
              if (left.updatedAtMs !== right.updatedAtMs) {
                return right.updatedAtMs - left.updatedAtMs;
              }

              return left.sessionId.localeCompare(right.sessionId);
            });

          const totalCount = filteredSessions.length;
          const pagedSessions = filteredSessions.slice(offset, offset + limit);
          const nextOffset = offset + limit;
          const items = Object.freeze(
            pagedSessions.map((session) => {
              const messageList = ensureMessageCollection(session.sessionId);
              return Object.freeze({
                sessionId: session.sessionId,
                userId: session.userId,
                channel: session.channel,
                ...(typeof session.title === "string"
                  ? { title: session.title }
                  : {}),
                tags: session.tags ?? [],
                archived: session.archived === true,
                ...(session.retentionDays !== undefined
                  ? { retentionDays: session.retentionDays }
                  : {}),
                messageCount: messageList.length,
                ...(session.lastMessageAtMs !== undefined
                  ? { lastMessageAtMs: session.lastMessageAtMs }
                  : {}),
                updatedAtMs: session.updatedAtMs,
              });
            }),
          );

          return {
            status: "ok",
            items,
            totalCount,
            ...(nextOffset < totalCount
              ? {
                  nextCursor: String(nextOffset),
                }
              : {}),
          };
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async getSessionHistory(request) {
      const parsed = validateRequest(request, historyRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: CHAT_MANAGEMENT_ACTIONS.getSessionHistory.actionId,
          version: CHAT_MANAGEMENT_ACTIONS.getSessionHistory.version,
          input: {
            sessionId: parsed.sessionId,
            ...(parsed.cursor !== undefined ? { cursor: parsed.cursor } : {}),
            ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
          },
        },
        async (input) => {
          const sessionId = /** @type {string} */ (input.sessionId);
          if (!sessions.has(sessionId)) {
            return {
              status: "not_found",
              sessionId,
              items: Object.freeze([]),
              totalCount: 0,
            };
          }

          const offset = parseCursor(
            /** @type {string|undefined} */ (input.cursor),
            historyRequestSchema.schemaId,
          );
          const limit = /** @type {number|undefined} */ (input.limit) ?? 100;
          const sortedMessages = sortMessages(ensureMessageCollection(sessionId));
          const totalCount = sortedMessages.length;
          const pagedMessages = sortedMessages.slice(offset, offset + limit);
          const nextOffset = offset + limit;

          const items = Object.freeze(
            pagedMessages.map((message) =>
              Object.freeze({
                messageId: message.messageId,
                userId: message.userId,
                role: message.role,
                text: message.text,
                timestampMs: message.timestampMs,
                ...(message.threadId !== undefined
                  ? { threadId: message.threadId }
                  : {}),
                ...(message.metadata !== undefined
                  ? { metadata: message.metadata }
                  : {}),
              }),
            ),
          );

          return {
            status: "ok",
            sessionId,
            items,
            totalCount,
            ...(nextOffset < totalCount
              ? {
                  nextCursor: String(nextOffset),
                }
              : {}),
          };
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async searchMessages(request) {
      const parsed = validateRequest(request, searchRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: CHAT_MANAGEMENT_ACTIONS.searchMessages.actionId,
          version: CHAT_MANAGEMENT_ACTIONS.searchMessages.version,
          input: {
            query: parsed.query,
            ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
            ...(parsed.channel !== undefined ? { channel: parsed.channel } : {}),
            ...(parsed.includeArchived !== undefined
              ? { includeArchived: parsed.includeArchived }
              : {}),
            ...(parsed.cursor !== undefined ? { cursor: parsed.cursor } : {}),
            ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
          },
        },
        async (input) => {
          const query = /** @type {string} */ (input.query).toLowerCase();
          const includeArchived = input.includeArchived === true;
          const offset = parseCursor(
            /** @type {string|undefined} */ (input.cursor),
            searchRequestSchema.schemaId,
          );
          const limit = /** @type {number|undefined} */ (input.limit) ?? 100;

          const matches = [];
          for (const session of sessions.values()) {
            if (!includeArchived && session.archived === true) {
              continue;
            }

            if (
              input.sessionId !== undefined &&
              session.sessionId !== input.sessionId
            ) {
              continue;
            }

            if (input.channel !== undefined && session.channel !== input.channel) {
              continue;
            }

            const messages = ensureMessageCollection(session.sessionId);
            for (const message of messages) {
              if (!message.text.toLowerCase().includes(query)) {
                continue;
              }

              matches.push(
                Object.freeze({
                  sessionId: session.sessionId,
                  channel: session.channel,
                  messageId: message.messageId,
                  userId: message.userId,
                  role: message.role,
                  text: message.text,
                  timestampMs: message.timestampMs,
                }),
              );
            }
          }

          matches.sort((left, right) => {
            if (left.timestampMs !== right.timestampMs) {
              return right.timestampMs - left.timestampMs;
            }

            return left.messageId.localeCompare(right.messageId);
          });

          const totalCount = matches.length;
          const pagedMatches = matches.slice(offset, offset + limit);
          const nextOffset = offset + limit;

          return {
            status: "ok",
            items: Object.freeze([...pagedMatches]),
            totalCount,
            ...(nextOffset < totalCount
              ? {
                  nextCursor: String(nextOffset),
                }
              : {}),
          };
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async applyRetentionPolicy(request) {
      const parsed = validateRequest(request, retentionRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: CHAT_MANAGEMENT_ACTIONS.applyRetention.actionId,
          version: CHAT_MANAGEMENT_ACTIONS.applyRetention.version,
          input: {
            sessionId: parsed.sessionId,
            retentionDays: parsed.retentionDays,
            ...(parsed.archiveNow !== undefined
              ? { archiveNow: parsed.archiveNow }
              : {}),
            ...(parsed.actorId !== undefined ? { actorId: parsed.actorId } : {}),
            ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
          },
        },
        async (input) => {
          const sessionId = /** @type {string} */ (input.sessionId);
          const retentionDays = /** @type {number} */ (input.retentionDays);
          const session = sessions.get(sessionId);
          if (!session) {
            return {
              status: "rejected",
              sessionId,
              retentionDays,
              archived: false,
              reason: "Session is not registered",
            };
          }

          const cutoffMs = now() - retentionDays * 24 * 60 * 60 * 1000;
          const previousMessages = ensureMessageCollection(sessionId);
          const keptMessages = previousMessages.filter(
            (message) => message.timestampMs >= cutoffMs,
          );
          messagesBySession.set(sessionId, [...sortMessages(keptMessages)]);

          const latestMessage = keptMessages.length > 0
            ? keptMessages[keptMessages.length - 1]
            : undefined;
          const archived = input.archiveNow === true || session.archived === true;
          const updatedSession = normalizeSessionRecord({
            ...session,
            archived,
            retentionDays,
            updatedAtMs: now(),
            ...(latestMessage
              ? { lastMessageAtMs: latestMessage.timestampMs }
              : {}),
          });
          sessions.set(sessionId, updatedSession);

          const purgedCount = previousMessages.length - keptMessages.length;
          return {
            status: "applied",
            sessionId,
            retentionDays,
            archived,
            ...(purgedCount > 0
              ? {
                  reason: `Purged ${purgedCount} message(s) by retention policy`,
                }
              : {}),
          };
        },
      );
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listSessionsState() {
      return Object.freeze(
        [...sessions.values()]
          .map((session) => Object.freeze({ ...session }))
          .sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
      );
    },
  });
}
