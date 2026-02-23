import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createDefaultIngressHealthChecks,
  createDefaultIngressNormalizers,
} from "../packages/polar-adapter-channels/src/index.mjs";
import {
  createChatIngressGateway,
  createContractRegistry,
  createMiddlewarePipeline,
  registerChatIngressContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupGateway({ middleware = [], normalizers, healthChecks } = {}) {
  const contractRegistry = createContractRegistry();
  registerChatIngressContract(contractRegistry);

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const gateway = createChatIngressGateway({
    middlewarePipeline,
    normalizers:
      normalizers ??
      createDefaultIngressNormalizers({
        now: () => 1_700_000_300_000,
      }),
    healthChecks:
      healthChecks ??
      createDefaultIngressHealthChecks({
        now: () => 1_700_000_300_000,
      }),
    now: () => 1_700_000_300_999,
  });

  return {
    gateway,
    auditEvents,
    contractRegistry,
  };
}

test("registerChatIngressContract registers ingress contract once", () => {
  const registry = createContractRegistry();
  registerChatIngressContract(registry);
  registerChatIngressContract(registry);

  assert.deepEqual(registry.list(), [
    "chat.ingress.health.check@1",
    "chat.ingress.normalize@1",
  ]);
});

test("chat ingress gateway normalizes web, telegram, slack, and discord payloads through middleware", async () => {
  const middlewareEvents = [];
  const { gateway, auditEvents } = setupGateway({
    middleware: [
      {
        id: "capture",
        before(context) {
          middlewareEvents.push(`before:${context.input.adapter}`);
        },
        after(context) {
          middlewareEvents.push(`after:${context.output.channel}`);
        },
      },
    ],
  });

  const webResult = await gateway.normalize({
    executionType: "tool",
    traceId: "trace-chat-1",
    adapter: "web",
    payload: {
      sessionId: "s1",
      userId: "u1",
      messageId: "m1",
      text: "hello parity",
      timestampMs: 1_700_000_300_000,
      locale: "en-US",
      threadId: "thread-a",
      routingHints: ["priority"],
      metadata: { origin: "web-ui" },
    },
  });

  const telegramResult = await gateway.normalize({
    executionType: "tool",
    traceId: "trace-chat-2",
    adapter: "telegram",
    payload: {
      chatId: "chat-1",
      fromId: "from-1",
      sessionId: "s1",
      userId: "u1",
      messageId: "m1",
      text: "hello parity",
      timestampMs: 1_700_000_300_000,
      locale: "en-US",
      threadId: "thread-a",
      routingHints: ["priority"],
      metadata: { origin: "web-ui" },
    },
  });

  const slackResult = await gateway.normalize({
    executionType: "tool",
    traceId: "trace-chat-3",
    adapter: "slack",
    payload: {
      channelId: "channel-1",
      userId: "u1",
      sessionId: "s1",
      messageId: "m1",
      text: "hello parity",
      timestampMs: 1_700_000_300_000,
      locale: "en-US",
      threadId: "thread-a",
      routingHints: ["priority"],
      metadata: { origin: "web-ui" },
    },
  });

  const discordResult = await gateway.normalize({
    executionType: "tool",
    traceId: "trace-chat-4",
    adapter: "discord",
    payload: {
      channelId: "channel-1",
      authorId: "author-1",
      sessionId: "s1",
      userId: "u1",
      messageId: "m1",
      text: "hello parity",
      timestampMs: 1_700_000_300_000,
      locale: "en-US",
      threadId: "thread-a",
      routingHints: ["priority"],
      metadata: { origin: "web-ui" },
    },
  });

  assert.equal(webResult.messageText, telegramResult.messageText);
  assert.equal(webResult.sessionId, telegramResult.sessionId);
  assert.equal(webResult.userId, telegramResult.userId);
  assert.equal(webResult.timestampMs, telegramResult.timestampMs);
  assert.equal(webResult.locale, telegramResult.locale);
  assert.equal(webResult.threadId, telegramResult.threadId);
  assert.deepEqual(webResult.routingHints, telegramResult.routingHints);
  assert.equal(webResult.messageText, slackResult.messageText);
  assert.equal(webResult.sessionId, slackResult.sessionId);
  assert.equal(webResult.userId, slackResult.userId);
  assert.equal(webResult.timestampMs, slackResult.timestampMs);
  assert.equal(webResult.locale, slackResult.locale);
  assert.equal(webResult.threadId, slackResult.threadId);
  assert.deepEqual(webResult.routingHints, slackResult.routingHints);
  assert.equal(webResult.messageText, discordResult.messageText);
  assert.equal(webResult.sessionId, discordResult.sessionId);
  assert.equal(webResult.userId, discordResult.userId);
  assert.equal(webResult.timestampMs, discordResult.timestampMs);
  assert.equal(webResult.locale, discordResult.locale);
  assert.equal(webResult.threadId, discordResult.threadId);
  assert.deepEqual(webResult.routingHints, discordResult.routingHints);
  assert.equal(webResult.messageId, "m1");
  assert.equal(telegramResult.messageId, "telegram:chat-1:m1");
  assert.equal(slackResult.messageId, "m1");
  assert.equal(discordResult.messageId, "discord:channel-1:m1");

  assert.deepEqual(middlewareEvents, [
    "before:web",
    "after:web",
    "before:telegram",
    "after:telegram",
    "before:slack",
    "after:slack",
    "before:discord",
    "after:discord",
  ]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "chat.ingress.normalize" &&
        event.traceId === "trace-chat-1",
    ),
  );
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "chat.ingress.normalize" &&
        event.traceId === "trace-chat-2",
    ),
  );
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "chat.ingress.normalize" &&
        event.traceId === "trace-chat-3",
    ),
  );
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "chat.ingress.normalize" &&
        event.traceId === "trace-chat-4",
    ),
  );
});

test("chat ingress gateway preserves multi-turn session and thread continuity with channel-native threading fields", async () => {
  const { gateway } = setupGateway();

  const webTurn1 = await gateway.normalize({
    adapter: "web",
    payload: {
      sessionId: "web-session-1",
      userId: "web-user-1",
      threadId: "web-thread-1",
      text: "turn one",
    },
  });
  const webTurn2 = await gateway.normalize({
    adapter: "web",
    payload: {
      sessionId: "web-session-1",
      userId: "web-user-1",
      threadId: "web-thread-1",
      text: "turn two",
    },
  });
  assert.equal(webTurn1.sessionId, webTurn2.sessionId);
  assert.equal(webTurn1.threadId, webTurn2.threadId);

  const telegramTurn1 = await gateway.normalize({
    adapter: "telegram",
    payload: {
      chatId: "chat-1",
      fromId: "from-1",
      messageId: "m-1",
      messageThreadId: "topic-9",
      text: "turn one",
    },
  });
  const telegramTurn2 = await gateway.normalize({
    adapter: "telegram",
    payload: {
      chatId: "chat-1",
      fromId: "from-1",
      messageId: "m-2",
      messageThreadId: "topic-9",
      text: "turn two",
    },
  });
  assert.equal(telegramTurn1.sessionId, telegramTurn2.sessionId);
  assert.equal(telegramTurn1.threadId, telegramTurn2.threadId);
  assert.equal(telegramTurn1.threadId, "telegram:topic:chat-1:topic-9");

  const slackTurn1 = await gateway.normalize({
    adapter: "slack",
    payload: {
      channelId: "channel-1",
      userId: "u1",
      messageTs: "1700000700.000001",
      threadTs: "1700000600.000001",
      text: "turn one",
    },
  });
  const slackTurn2 = await gateway.normalize({
    adapter: "slack",
    payload: {
      channelId: "channel-1",
      userId: "u1",
      messageTs: "1700000701.000001",
      threadTs: "1700000600.000001",
      text: "turn two",
    },
  });
  assert.equal(slackTurn1.sessionId, slackTurn2.sessionId);
  assert.equal(slackTurn1.threadId, slackTurn2.threadId);

  const discordTurn1 = await gateway.normalize({
    adapter: "discord",
    payload: {
      channelId: "d-1",
      authorId: "a-1",
      messageId: "m-1",
      parentMessageId: "root-1",
      text: "turn one",
    },
  });
  const discordTurn2 = await gateway.normalize({
    adapter: "discord",
    payload: {
      channelId: "d-1",
      authorId: "a-1",
      messageId: "m-2",
      parentMessageId: "root-1",
      text: "turn two",
    },
  });
  assert.equal(discordTurn1.sessionId, discordTurn2.sessionId);
  assert.equal(discordTurn1.threadId, discordTurn2.threadId);
  assert.equal(discordTurn1.threadId, "discord:thread:d-1:root-1");
});

test("chat ingress gateway rejects unknown adapters before execution", async () => {
  const { gateway } = setupGateway();

  await assert.rejects(
    async () =>
      gateway.normalize({
        adapter: "sms",
        payload: {},
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("chat ingress gateway health checks run through middleware and report healthy adapters", async () => {
  const middlewareEvents = [];
  const { gateway, auditEvents } = setupGateway({
    middleware: [
      {
        id: "capture-health",
        before(context) {
          middlewareEvents.push(`before:${context.actionId}`);
        },
        after(context) {
          middlewareEvents.push(`after:${context.output.status}`);
        },
      },
    ],
  });

  const result = await gateway.checkHealth({
    executionType: "tool",
    traceId: "trace-health-1",
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.checkedAtMs, 1_700_000_300_999);
  assert.equal(result.resultCount, 4);
  assert.deepEqual(result.results, [
    { adapter: "web", status: "healthy" },
    { adapter: "telegram", status: "healthy" },
    { adapter: "slack", status: "healthy" },
    { adapter: "discord", status: "healthy" },
  ]);
  assert.deepEqual(middlewareEvents, [
    "before:chat.ingress.health.check",
    "after:healthy",
  ]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "chat.ingress.health.check" &&
        event.traceId === "trace-health-1",
    ),
  );
});

test("chat ingress gateway health checks report unhealthy when adapter check is missing", async () => {
  const defaultHealthChecks = createDefaultIngressHealthChecks({
    now: () => 1_700_000_300_000,
  });

  const { gateway } = setupGateway({
    healthChecks: {
      web: defaultHealthChecks.web,
      telegram: defaultHealthChecks.telegram,
      slack: defaultHealthChecks.slack,
    },
  });

  const result = await gateway.checkHealth();

  assert.equal(result.status, "unhealthy");
  assert.equal(result.resultCount, 4);
  assert.deepEqual(result.results, [
    { adapter: "web", status: "healthy" },
    { adapter: "telegram", status: "healthy" },
    { adapter: "slack", status: "healthy" },
    {
      adapter: "discord",
      status: "unhealthy",
      reason: "Ingress health check is not configured",
    },
  ]);
});

test("chat ingress gateway health checks reject invalid request shapes", async () => {
  const { gateway } = setupGateway();

  await assert.rejects(
    async () =>
      gateway.checkHealth({
        adapter: "sms",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("chat ingress gateway preserves deterministic validation failure across adapters", async () => {
  const { gateway } = setupGateway();

  const failures = [];
  for (const adapter of ["web", "telegram", "slack", "discord"]) {
    try {
      await gateway.normalize({
        adapter,
        payload:
          adapter === "web"
            ? {
                sessionId: "s1",
                userId: "u1",
                text: "",
              }
            : adapter === "telegram"
              ? {
                chatId: 1,
                fromId: 2,
                text: "",
              }
              : adapter === "slack"
                ? {
                  channelId: "c1",
                  userId: "u1",
                  text: "",
                }
                : {
                  channelId: "c1",
                  authorId: "a1",
                  text: "",
                },
      });
      assert.fail("expected validation error");
    } catch (error) {
      failures.push(error);
    }
  }

  assert.equal(failures.length, 4);
  assert.equal(failures[0].code, "POLAR_CONTRACT_VALIDATION_ERROR");
  assert.equal(failures[1].code, "POLAR_CONTRACT_VALIDATION_ERROR");
  assert.equal(failures[2].code, "POLAR_CONTRACT_VALIDATION_ERROR");
  assert.equal(failures[3].code, "POLAR_CONTRACT_VALIDATION_ERROR");
});
