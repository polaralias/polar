import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createChannelAdapterRegistry,
  createDefaultIngressHealthChecks,
  createDiscordIngressAdapter,
  createSlackIngressAdapter,
  createTelegramIngressAdapter,
  createWebIngressAdapter,
} from "../packages/polar-adapter-channels/src/index.mjs";

test("web ingress adapter normalizes payload into canonical envelope", () => {
  const adapter = createWebIngressAdapter({
    now: () => 1_700_000_000_000,
  });

  const result = adapter.normalize({
    sessionId: "session-1",
    userId: "user-1",
    text: "hello from web",
  });

  assert.deepEqual(result, {
    sessionId: "session-1",
    userId: "user-1",
    channel: "web",
    messageId: "web:session-1:1700000000000",
    messageText: "hello from web",
    timestampMs: 1_700_000_000_000,
    routingHints: [],
    metadata: {},
  });
});

test("telegram ingress adapter derives ids and metadata deterministically", () => {
  const adapter = createTelegramIngressAdapter({
    now: () => 1_700_000_100_000,
  });

  const result = adapter.normalize({
    chatId: 99,
    fromId: 7,
    messageId: 42,
    updateId: 55,
    messageThreadId: 9001,
    text: "hello from telegram",
    timestampSeconds: 1_700_000_200,
  });

  assert.deepEqual(result, {
    sessionId: "telegram:chat:99",
    userId: "telegram:user:7",
    channel: "telegram",
    messageId: "telegram:99:42",
    messageText: "hello from telegram",
    timestampMs: 1_700_000_200_000,
    threadId: "telegram:topic:9001:99",
    routingHints: [],
    metadata: {
      source: "telegram",
      chatId: "99",
      fromId: "7",
      updateId: "55",
      messageThreadId: "9001",
    },
  });
});

test("telegram ingress uses stable chat-scoped sessionId for normal, reply, and topic turns", () => {
  const adapter = createTelegramIngressAdapter({
    now: () => 1_700_000_150_000,
  });

  const normalTurn = adapter.normalize({
    chatId: "chat-1",
    fromId: "user-1",
    messageId: "m-1",
    text: "normal",
  });
  assert.equal(normalTurn.sessionId, "telegram:chat:chat-1");
  assert.equal(normalTurn.threadId, undefined);

  const replyTurn = adapter.normalize({
    chatId: "chat-1",
    fromId: "user-1",
    messageId: "m-2",
    replyToMessageId: "m-1",
    text: "reply",
  });
  assert.equal(replyTurn.sessionId, "telegram:chat:chat-1");
  assert.equal(replyTurn.threadId, "telegram:reply:chat-1:m-1");
  assert.equal(replyTurn.metadata.replyToMessageId, "m-1");

  const topicTurn = adapter.normalize({
    chatId: "chat-1",
    fromId: "user-1",
    messageId: "m-3",
    messageThreadId: "topic-9",
    text: "topic",
  });
  assert.equal(topicTurn.sessionId, "telegram:chat:chat-1");
  assert.equal(topicTurn.threadId, "telegram:topic:topic-9:chat-1");
});

test("slack ingress adapter derives ids and metadata deterministically", () => {
  const adapter = createSlackIngressAdapter({
    now: () => 1_700_000_300_000,
  });

  const result = adapter.normalize({
    channelId: "C123",
    userId: "U777",
    messageTs: "1700000300.123456",
    eventTs: "1700000300.123457",
    eventId: "Ev-22",
    threadTs: "1700000200.000001",
    text: "hello from slack",
    metadata: { origin: "socket-mode" },
  });

  assert.deepEqual(result, {
    sessionId: "slack:channel:C123",
    userId: "U777",
    channel: "slack",
    messageId: "slack:C123:1700000300.123456",
    messageText: "hello from slack",
    timestampMs: 1_700_000_300_123,
    threadId: "slack:thread:C123:1700000200.000001",
    routingHints: [],
    metadata: {
      source: "slack",
      channelId: "C123",
      userId: "U777",
      messageTs: "1700000300.123456",
      eventTs: "1700000300.123457",
      eventId: "Ev-22",
      threadTs: "1700000200.000001",
      origin: "socket-mode",
    },
  });
});

test("discord ingress adapter derives ids and metadata deterministically", () => {
  const adapter = createDiscordIngressAdapter({
    now: () => 1_700_000_400_000,
  });

  const result = adapter.normalize({
    channelId: "D-42",
    authorId: "A-77",
    guildId: "G-11",
    messageId: "M-19",
    eventId: "E-13",
    parentMessageId: "PM-1",
    timestampIso: "2023-11-14T22:18:20.000Z",
    text: "hello from discord",
    metadata: { origin: "gateway" },
  });

  assert.deepEqual(result, {
    sessionId: "discord:channel:D-42",
    userId: "discord:user:A-77",
    channel: "discord",
    messageId: "discord:D-42:M-19",
    messageText: "hello from discord",
    timestampMs: 1_700_000_300_000,
    threadId: "discord:thread:D-42:PM-1",
    routingHints: [],
    metadata: {
      source: "discord",
      channelId: "D-42",
      authorId: "A-77",
      guildId: "G-11",
      messageId: "M-19",
      eventId: "E-13",
      timestampIso: "2023-11-14T22:18:20.000Z",
      parentMessageId: "PM-1",
      origin: "gateway",
    },
  });
});

test("adapters preserve deterministic multi-turn session and thread continuity", () => {
  const now = () => 1_700_000_600_000;
  const web = createWebIngressAdapter({ now });
  const telegram = createTelegramIngressAdapter({ now });
  const slack = createSlackIngressAdapter({ now });
  const discord = createDiscordIngressAdapter({ now });

  const webTurn1 = web.normalize({
    sessionId: "web-session-1",
    userId: "web-user-1",
    threadId: "web-thread-1",
    text: "turn one",
  });
  const webTurn2 = web.normalize({
    sessionId: "web-session-1",
    userId: "web-user-1",
    threadId: "web-thread-1",
    text: "turn two",
  });
  assert.equal(webTurn1.sessionId, webTurn2.sessionId);
  assert.equal(webTurn1.threadId, webTurn2.threadId);

  const telegramTurn1 = telegram.normalize({
    chatId: 77,
    fromId: 11,
    messageId: 100,
    messageThreadId: 2024,
    text: "turn one",
  });
  const telegramTurn2 = telegram.normalize({
    chatId: 77,
    fromId: 11,
    messageId: 101,
    messageThreadId: 2024,
    text: "turn two",
  });
  assert.equal(telegramTurn1.sessionId, telegramTurn2.sessionId);
  assert.equal(telegramTurn1.threadId, telegramTurn2.threadId);

  const slackTurn1 = slack.normalize({
    channelId: "C-11",
    userId: "U-9",
    messageTs: "1700000600.000001",
    threadTs: "1700000500.000001",
    text: "turn one",
  });
  const slackTurn2 = slack.normalize({
    channelId: "C-11",
    userId: "U-9",
    messageTs: "1700000601.000001",
    threadTs: "1700000500.000001",
    text: "turn two",
  });
  assert.equal(slackTurn1.sessionId, slackTurn2.sessionId);
  assert.equal(slackTurn1.threadId, slackTurn2.threadId);

  const discordTurn1 = discord.normalize({
    channelId: "D-11",
    authorId: "A-9",
    messageId: "M-1",
    parentMessageId: "P-ROOT",
    text: "turn one",
  });
  const discordTurn2 = discord.normalize({
    channelId: "D-11",
    authorId: "A-9",
    messageId: "M-2",
    parentMessageId: "P-ROOT",
    text: "turn two",
  });
  assert.equal(discordTurn1.sessionId, discordTurn2.sessionId);
  assert.equal(discordTurn1.threadId, discordTurn2.threadId);
});

test("web, telegram, slack, and discord adapters reject invalid payloads with deterministic typed errors", () => {
  const web = createWebIngressAdapter();
  const telegram = createTelegramIngressAdapter();
  const slack = createSlackIngressAdapter();
  const discord = createDiscordIngressAdapter();

  assert.throws(
    () =>
      web.normalize({
        sessionId: "s1",
        userId: "u1",
        text: "",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  assert.throws(
    () =>
      telegram.normalize({
        chatId: 1,
        fromId: 2,
        text: "",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  assert.throws(
    () =>
      slack.normalize({
        channelId: "C1",
        userId: "U1",
        text: "",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  assert.throws(
    () =>
      discord.normalize({
        channelId: "D1",
        authorId: "A1",
        text: "",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("channel adapter registry supports register/get/list with deterministic ordering", () => {
  const registry = createChannelAdapterRegistry();
  registry.register("discord", { normalize() {} });
  registry.register("slack", { normalize() {} });
  registry.register("telegram", { normalize() {} });
  registry.register("web", { normalize() {} });

  assert.equal(typeof registry.get("web").normalize, "function");
  assert.deepEqual(registry.list(), ["discord", "slack", "telegram", "web"]);
});

test("default ingress health checks report healthy across web, telegram, slack, and discord", async () => {
  const healthChecks = createDefaultIngressHealthChecks({
    now: () => 1_700_000_500_000,
  });

  const adapters = ["web", "telegram", "slack", "discord"];
  for (const adapter of adapters) {
    const result = await healthChecks[adapter]();
    assert.deepEqual(result, { status: "healthy" });
  }
});
