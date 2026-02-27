import {
  CANONICAL_CHAT_ENVELOPE_SCHEMA,
  ContractValidationError,
  idField,
  jsonField,
  numberField,
  stringArrayField,
  stringField,
  createStrictObjectSchema,
} from "../../polar-domain/src/index.mjs";

const webIngressSchema = createStrictObjectSchema({
  schemaId: "chat.web.ingress.input",
  fields: {
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    text: stringField({ minLength: 1 }),
    messageId: stringField({ minLength: 1, required: false }),
    timestampMs: numberField({ min: 0, required: false }),
    locale: stringField({ minLength: 1, required: false }),
    threadId: stringField({ minLength: 1, required: false }),
    routingHints: stringArrayField({ minItems: 0, required: false }),
    metadata: jsonField({ required: false }),
  },
});

const telegramIngressSchema = createStrictObjectSchema({
  schemaId: "chat.telegram.ingress.input",
  fields: {
    chatId: idField({ minLength: 1 }),
    fromId: idField({ minLength: 1 }),
    text: stringField({ minLength: 1 }),
    messageId: idField({ minLength: 1, required: false }),
    updateId: idField({ minLength: 1, required: false }),
    timestampSeconds: numberField({ min: 0, required: false }),
    timestampMs: numberField({ min: 0, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    userId: stringField({ minLength: 1, required: false }),
    locale: stringField({ minLength: 1, required: false }),
    threadId: idField({ minLength: 1, required: false }),
    messageThreadId: idField({ minLength: 1, required: false }),
    replyToMessageId: idField({ minLength: 1, required: false }),
    routingHints: stringArrayField({ minItems: 0, required: false }),
    metadata: jsonField({ required: false }),
  },
});

const slackIngressSchema = createStrictObjectSchema({
  schemaId: "chat.slack.ingress.input",
  fields: {
    channelId: idField({ minLength: 1 }),
    userId: idField({ minLength: 1 }),
    text: stringField({ minLength: 1 }),
    messageTs: idField({ minLength: 1, required: false }),
    eventTs: idField({ minLength: 1, required: false }),
    eventId: idField({ minLength: 1, required: false }),
    messageId: stringField({ minLength: 1, required: false }),
    timestampMs: numberField({ min: 0, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    locale: stringField({ minLength: 1, required: false }),
    threadId: stringField({ minLength: 1, required: false }),
    threadTs: idField({ minLength: 1, required: false }),
    routingHints: stringArrayField({ minItems: 0, required: false }),
    metadata: jsonField({ required: false }),
  },
});

const discordIngressSchema = createStrictObjectSchema({
  schemaId: "chat.discord.ingress.input",
  fields: {
    channelId: idField({ minLength: 1 }),
    authorId: idField({ minLength: 1 }),
    text: stringField({ minLength: 1 }),
    guildId: idField({ minLength: 1, required: false }),
    messageId: idField({ minLength: 1, required: false }),
    eventId: idField({ minLength: 1, required: false }),
    timestampMs: numberField({ min: 0, required: false }),
    timestampIso: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    userId: stringField({ minLength: 1, required: false }),
    locale: stringField({ minLength: 1, required: false }),
    threadId: idField({ minLength: 1, required: false }),
    parentMessageId: idField({ minLength: 1, required: false }),
    routingHints: stringArrayField({ minItems: 0, required: false }),
    metadata: jsonField({ required: false }),
  },
});

function nowMs() {
  return Date.now();
}

/**
 * @param {unknown} value
 * @returns {number|undefined}
 */
function parseSlackTimestampToMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    if (value >= 1_000_000_000_000) {
      return Math.trunc(value);
    }

    return Math.trunc(value * 1000);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || !/^\d+(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  if (!normalized.includes(".") && parsed >= 1_000_000_000_000) {
    return Math.trunc(parsed);
  }

  return Math.trunc(parsed * 1000);
}

/**
 * @param {unknown} value
 * @returns {number|undefined}
 */
function parseIsoTimestampToMs(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return Math.trunc(parsed);
}

/**
 * @param {unknown} value
 * @param {import("../../polar-domain/src/runtime-contracts.mjs").StrictObjectSchema} schema
 * @param {string} adapterId
 * @returns {Record<string, unknown>}
 */
function parseIngress(value, schema, adapterId) {
  const validation = schema.validate(value);
  if (!validation.ok) {
    throw new ContractValidationError(
      `Invalid ${adapterId} ingress payload`,
      {
        adapterId,
        schemaId: schema.schemaId,
        errors: validation.errors ?? [],
      },
    );
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {Record<string, unknown>} envelope
 * @returns {Record<string, unknown>}
 */
function validateCanonicalEnvelopeOrThrow(envelope) {
  const validation = CANONICAL_CHAT_ENVELOPE_SCHEMA.validate(envelope);
  if (!validation.ok) {
    throw new ContractValidationError("Invalid canonical chat envelope", {
      schemaId: CANONICAL_CHAT_ENVELOPE_SCHEMA.schemaId,
      errors: validation.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {{ now?: () => number }} [options]
 */
export function createWebIngressAdapter(options = {}) {
  const { now = nowMs } = options;

  return Object.freeze({
    channel: "web",
    /**
     * @param {unknown} input
     * @returns {Record<string, unknown>}
     */
    normalize(input) {
      const parsed = parseIngress(input, webIngressSchema, "web");
      const timestampMs = /** @type {number|undefined} */ (parsed.timestampMs) ?? now();
      const messageId =
        /** @type {string|undefined} */ (parsed.messageId) ??
        `web:${parsed.sessionId}:${timestampMs}`;

      const envelope = {
        sessionId: parsed.sessionId,
        userId: parsed.userId,
        channel: "web",
        messageId,
        messageText: parsed.text,
        timestampMs,
        routingHints: parsed.routingHints ?? [],
        metadata: parsed.metadata ?? {},
      };
      if (parsed.locale !== undefined) {
        envelope.locale = parsed.locale;
      }
      if (parsed.threadId !== undefined) {
        envelope.threadId = parsed.threadId;
      }

      return validateCanonicalEnvelopeOrThrow(envelope);
    },
  });
}

/**
 * @param {{ now?: () => number }} [options]
 */
export function createTelegramIngressAdapter(options = {}) {
  const { now = nowMs } = options;

  return Object.freeze({
    channel: "telegram",
    /**
     * @param {unknown} input
     * @returns {Record<string, unknown>}
     */
    normalize(input) {
      const parsed = parseIngress(input, telegramIngressSchema, "telegram");

      const chatId = /** @type {string} */ (parsed.chatId);
      const fromId = /** @type {string} */ (parsed.fromId);
      const timestampMs =
        /** @type {number|undefined} */ (parsed.timestampMs) ??
        (typeof parsed.timestampSeconds === "number"
          ? parsed.timestampSeconds * 1000
          : now());

      const derivedMessageId = parsed.messageId
        ? `telegram:${chatId}:${parsed.messageId}`
        : parsed.updateId
          ? `telegram:update:${parsed.updateId}`
          : `telegram:${chatId}:${timestampMs}`;

      const metadata = {
        source: "telegram",
        chatId,
        fromId,
        ...(typeof parsed.metadata === "object" && parsed.metadata !== null
          ? parsed.metadata
          : {}),
      };
      if (parsed.updateId !== undefined) {
        metadata.updateId = parsed.updateId;
      }
      if (parsed.messageThreadId !== undefined) {
        metadata.messageThreadId = parsed.messageThreadId;
      }
      if (parsed.replyToMessageId !== undefined) {
        metadata.replyToMessageId = parsed.replyToMessageId;
      }

      const envelope = {
        sessionId: parsed.sessionId ?? `telegram:chat:${chatId}`,
        userId: parsed.userId ?? `telegram:user:${fromId}`,
        channel: "telegram",
        messageId: derivedMessageId,
        messageText: parsed.text,
        timestampMs,
        routingHints: parsed.routingHints ?? [],
        metadata,
      };
      if (parsed.locale !== undefined) {
        envelope.locale = parsed.locale;
      }
      const threadId =
        parsed.threadId ??
        (parsed.messageThreadId
          ? `telegram:topic:${chatId}:${parsed.messageThreadId}`
          : parsed.replyToMessageId
            ? `telegram:reply:${chatId}:${parsed.replyToMessageId}`
            : undefined);
      if (threadId !== undefined) {
        envelope.threadId = threadId;
      }

      return validateCanonicalEnvelopeOrThrow(envelope);
    },
  });
}

/**
 * @param {{ now?: () => number }} [options]
 */
export function createSlackIngressAdapter(options = {}) {
  const { now = nowMs } = options;

  return Object.freeze({
    channel: "slack",
    /**
     * @param {unknown} input
     * @returns {Record<string, unknown>}
     */
    normalize(input) {
      const parsed = parseIngress(input, slackIngressSchema, "slack");
      const channelId = /** @type {string} */ (parsed.channelId);
      const userId = /** @type {string} */ (parsed.userId);

      const timestampMs =
        /** @type {number|undefined} */ (parsed.timestampMs) ??
        parseSlackTimestampToMs(parsed.messageTs) ??
        parseSlackTimestampToMs(parsed.eventTs) ??
        now();

      const messageId =
        /** @type {string|undefined} */ (parsed.messageId) ??
        (parsed.messageTs
          ? `slack:${channelId}:${parsed.messageTs}`
          : parsed.eventId
            ? `slack:event:${parsed.eventId}`
            : `slack:${channelId}:${timestampMs}`);

      const threadId =
        /** @type {string|undefined} */ (parsed.threadId) ??
        (parsed.threadTs
          ? `slack:thread:${channelId}:${parsed.threadTs}`
          : undefined);

      const metadata = {
        source: "slack",
        channelId,
        userId,
        ...(typeof parsed.metadata === "object" && parsed.metadata !== null
          ? parsed.metadata
          : {}),
      };
      if (parsed.messageTs !== undefined) {
        metadata.messageTs = parsed.messageTs;
      }
      if (parsed.eventTs !== undefined) {
        metadata.eventTs = parsed.eventTs;
      }
      if (parsed.eventId !== undefined) {
        metadata.eventId = parsed.eventId;
      }
      if (parsed.threadTs !== undefined) {
        metadata.threadTs = parsed.threadTs;
      }

      const envelope = {
        sessionId: parsed.sessionId ?? `slack:channel:${channelId}`,
        userId,
        channel: "slack",
        messageId,
        messageText: parsed.text,
        timestampMs,
        routingHints: parsed.routingHints ?? [],
        metadata,
      };
      if (parsed.locale !== undefined) {
        envelope.locale = parsed.locale;
      }
      if (threadId !== undefined) {
        envelope.threadId = threadId;
      }

      return validateCanonicalEnvelopeOrThrow(envelope);
    },
  });
}

/**
 * @param {{ now?: () => number }} [options]
 */
export function createDiscordIngressAdapter(options = {}) {
  const { now = nowMs } = options;

  return Object.freeze({
    channel: "discord",
    /**
     * @param {unknown} input
     * @returns {Record<string, unknown>}
     */
    normalize(input) {
      const parsed = parseIngress(input, discordIngressSchema, "discord");
      const channelId = /** @type {string} */ (parsed.channelId);
      const authorId = /** @type {string} */ (parsed.authorId);

      const timestampMs =
        /** @type {number|undefined} */ (parsed.timestampMs) ??
        parseIsoTimestampToMs(parsed.timestampIso) ??
        now();

      const messageId = parsed.messageId
        ? `discord:${channelId}:${parsed.messageId}`
        : parsed.eventId
          ? `discord:event:${parsed.eventId}`
          : `discord:${channelId}:${timestampMs}`;

      const metadata = {
        source: "discord",
        channelId,
        authorId,
        ...(typeof parsed.metadata === "object" && parsed.metadata !== null
          ? parsed.metadata
          : {}),
      };
      if (parsed.guildId !== undefined) {
        metadata.guildId = parsed.guildId;
      }
      if (parsed.messageId !== undefined) {
        metadata.messageId = parsed.messageId;
      }
      if (parsed.eventId !== undefined) {
        metadata.eventId = parsed.eventId;
      }
      if (parsed.timestampIso !== undefined) {
        metadata.timestampIso = parsed.timestampIso;
      }
      if (parsed.parentMessageId !== undefined) {
        metadata.parentMessageId = parsed.parentMessageId;
      }

      const envelope = {
        sessionId: parsed.sessionId ?? `discord:channel:${channelId}`,
        userId: parsed.userId ?? `discord:user:${authorId}`,
        channel: "discord",
        messageId,
        messageText: parsed.text,
        timestampMs,
        routingHints: parsed.routingHints ?? [],
        metadata,
      };
      if (parsed.locale !== undefined) {
        envelope.locale = parsed.locale;
      }
      const threadId =
        parsed.threadId ??
        (parsed.parentMessageId
          ? `discord:thread:${channelId}:${parsed.parentMessageId}`
          : undefined);
      if (threadId !== undefined) {
        envelope.threadId = threadId;
      }

      return validateCanonicalEnvelopeOrThrow(envelope);
    },
  });
}

function assertProbeEnvelopeChannel(adapter, envelope) {
  if (typeof envelope !== "object" || envelope === null) {
    throw new Error(`Ingress health probe for ${adapter} returned invalid envelope`);
  }

  const channel = /** @type {Record<string, unknown>} */ (envelope).channel;
  if (channel !== adapter) {
    throw new Error(
      `Ingress health probe for ${adapter} returned unexpected channel "${String(channel)}"`,
    );
  }
}

/**
 * @param {{ now?: () => number }} [options]
 */
export function createDefaultIngressHealthFixtures(options = {}) {
  const { now = nowMs } = options;
  const timestampMs = now();

  return Object.freeze({
    web: Object.freeze({
      sessionId: "health:web:session",
      userId: "health:web:user",
      messageId: "health:web:message",
      text: "health check",
      timestampMs,
      metadata: Object.freeze({ source: "health-probe" }),
    }),
    telegram: Object.freeze({
      chatId: "health:telegram:chat",
      fromId: "health:telegram:user",
      messageId: "health:telegram:message",
      text: "health check",
      timestampMs,
      metadata: Object.freeze({ source: "health-probe" }),
    }),
    slack: Object.freeze({
      channelId: "health:slack:channel",
      userId: "health:slack:user",
      messageId: "health:slack:message",
      text: "health check",
      timestampMs,
      metadata: Object.freeze({ source: "health-probe" }),
    }),
    discord: Object.freeze({
      channelId: "health:discord:channel",
      authorId: "health:discord:user",
      messageId: "health:discord:message",
      text: "health check",
      timestampMs,
      metadata: Object.freeze({ source: "health-probe" }),
    }),
  });
}

/**
 * @param {{ now?: () => number }} [options]
 */
export function createDefaultIngressHealthChecks(options = {}) {
  const normalizers = createDefaultIngressNormalizers(options);
  const fixtures = createDefaultIngressHealthFixtures(options);

  return Object.freeze({
    web: async () => {
      const envelope = await normalizers.web(fixtures.web);
      assertProbeEnvelopeChannel("web", envelope);
      return { status: "healthy" };
    },
    telegram: async () => {
      const envelope = await normalizers.telegram(fixtures.telegram);
      assertProbeEnvelopeChannel("telegram", envelope);
      return { status: "healthy" };
    },
    slack: async () => {
      const envelope = await normalizers.slack(fixtures.slack);
      assertProbeEnvelopeChannel("slack", envelope);
      return { status: "healthy" };
    },
    discord: async () => {
      const envelope = await normalizers.discord(fixtures.discord);
      assertProbeEnvelopeChannel("discord", envelope);
      return { status: "healthy" };
    },
  });
}

/**
 * @param {{ now?: () => number }} [options]
 */
export function createDefaultIngressNormalizers(options = {}) {
  const web = createWebIngressAdapter(options);
  const telegram = createTelegramIngressAdapter(options);
  const slack = createSlackIngressAdapter(options);
  const discord = createDiscordIngressAdapter(options);

  return Object.freeze({
    web: web.normalize,
    telegram: telegram.normalize,
    slack: slack.normalize,
    discord: discord.normalize,
  });
}

/**
 * Transport-only adapter boundary for web/telegram/slack/discord ingress and egress.
 */
export function createChannelAdapterRegistry() {
  const adapters = new Map();

  return Object.freeze({
    register(channelId, adapter) {
      if (typeof channelId !== "string" || channelId.length === 0) {
        throw new Error("channelId must be a non-empty string");
      }

      if (adapters.has(channelId)) {
        throw new Error(`channel adapter already registered: ${channelId}`);
      }

      adapters.set(channelId, adapter);
    },
    get(channelId) {
      return adapters.get(channelId);
    },
    list() {
      return Object.freeze([...adapters.keys()].sort((left, right) => left.localeCompare(right)));
    },
  });
}
