import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createChatManagementGateway,
  createContractRegistry,
  createMiddlewarePipeline,
  registerChatManagementContracts,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupChatManagementGateway({
  middleware = [],
  initialSessions,
  initialMessages,
  now = () => Date.UTC(2026, 1, 22, 12, 0, 0),
} = {}) {
  const contractRegistry = createContractRegistry();
  registerChatManagementContracts(contractRegistry);

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const gateway = createChatManagementGateway({
    middlewarePipeline,
    initialSessions,
    initialMessages,
    now,
  });

  return {
    gateway,
    auditEvents,
  };
}

test("registerChatManagementContracts registers chat-management contracts once", () => {
  const contractRegistry = createContractRegistry();
  registerChatManagementContracts(contractRegistry);
  registerChatManagementContracts(contractRegistry);

  assert.deepEqual(contractRegistry.list(), [
    "chat.message.append@1",
    "chat.message.search@1",
    "chat.session.history.get@1",
    "chat.session.list@1",
    "chat.session.retention.apply@1",
  ]);
});

test("chat-management lists sessions with deterministic filtering", async () => {
  const { gateway, auditEvents } = setupChatManagementGateway({
    initialSessions: [
      {
        sessionId: "session.telegram",
        userId: "user-1",
        channel: "telegram",
        title: "Telegram planning",
        tags: ["planning", "urgent"],
        createdAtMs: Date.UTC(2026, 1, 20, 10, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 20, 10, 0, 0),
      },
      {
        sessionId: "session.slack",
        userId: "user-2",
        channel: "slack",
        title: "Slack archive",
        tags: ["archive"],
        archived: true,
        createdAtMs: Date.UTC(2026, 1, 19, 10, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 19, 10, 0, 0),
      },
    ],
    initialMessages: [
      {
        messageId: "m-1",
        sessionId: "session.telegram",
        userId: "user-1",
        role: "user",
        text: "Need planning help",
        timestampMs: Date.UTC(2026, 1, 21, 10, 0, 0),
      },
    ],
  });

  const listed = await gateway.listSessions({
    traceId: "trace-chat-list-1",
    channel: "telegram",
    query: "planning",
  });

  assert.deepEqual(listed, {
    status: "ok",
    items: [
      {
        sessionId: "session.telegram",
        userId: "user-1",
        channel: "telegram",
        title: "Telegram planning",
        tags: ["planning", "urgent"],
        archived: false,
        messageCount: 1,
        lastMessageAtMs: Date.UTC(2026, 1, 21, 10, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 21, 10, 0, 0),
      },
    ],
    totalCount: 1,
  });

  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "chat.session.list" &&
        event.traceId === "trace-chat-list-1",
    ),
  );
});

test("chat-management appends messages and rejects invalid append states", async () => {
  const { gateway } = setupChatManagementGateway({
    initialSessions: [
      {
        sessionId: "session-1",
        userId: "user-1",
        channel: "web",
        createdAtMs: Date.UTC(2026, 1, 22, 9, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 22, 9, 0, 0),
      },
    ],
  });

  const appended = await gateway.appendMessage({
    sessionId: "session-1",
    userId: "user-1",
    messageId: "msg-1",
    role: "user",
    text: "hello",
    timestampMs: Date.UTC(2026, 1, 22, 9, 5, 0),
  });
  assert.deepEqual(appended, {
    status: "appended",
    sessionId: "session-1",
    messageId: "msg-1",
    messageCount: 1,
  });

  const duplicate = await gateway.appendMessage({
    sessionId: "session-1",
    userId: "user-1",
    messageId: "msg-1",
    role: "assistant",
    text: "duplicate",
    timestampMs: Date.UTC(2026, 1, 22, 9, 6, 0),
  });
  assert.deepEqual(duplicate, {
    status: "rejected",
    sessionId: "session-1",
    messageId: "msg-1",
    messageCount: 1,
    reason: "Message already exists in session",
  });

  const unknownSession = await gateway.appendMessage({
    sessionId: "session-missing",
    userId: "user-1",
    messageId: "msg-x",
    role: "user",
    text: "x",
    timestampMs: Date.UTC(2026, 1, 22, 9, 6, 0),
  });
  assert.deepEqual(unknownSession, {
    status: "rejected",
    sessionId: "session-missing",
    messageId: "msg-x",
    messageCount: 0,
    reason: "Session is not registered",
  });
});

test("chat-management supports history, search, and retention lifecycle", async () => {
  const nowMs = Date.UTC(2026, 1, 22, 12, 0, 0);
  const { gateway } = setupChatManagementGateway({
    now: () => nowMs,
    initialSessions: [
      {
        sessionId: "session-1",
        userId: "user-1",
        channel: "web",
        createdAtMs: Date.UTC(2026, 0, 1, 10, 0, 0),
        updatedAtMs: Date.UTC(2026, 0, 1, 10, 0, 0),
      },
    ],
    initialMessages: [
      {
        messageId: "old-1",
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        text: "old planning note",
        timestampMs: Date.UTC(2025, 11, 1, 9, 0, 0),
      },
      {
        messageId: "new-1",
        sessionId: "session-1",
        userId: "user-1",
        role: "assistant",
        text: "new planning summary",
        timestampMs: Date.UTC(2026, 1, 20, 9, 0, 0),
      },
    ],
  });

  const history = await gateway.getSessionHistory({
    sessionId: "session-1",
    limit: 1,
  });
  assert.deepEqual(history, {
    status: "ok",
    sessionId: "session-1",
    items: [
      {
        messageId: "old-1",
        userId: "user-1",
        role: "user",
        text: "old planning note",
        timestampMs: Date.UTC(2025, 11, 1, 9, 0, 0),
      },
    ],
    totalCount: 2,
    nextCursor: "1",
  });

  const search = await gateway.searchMessages({
    query: "planning",
  });
  assert.deepEqual(search, {
    status: "ok",
    items: [
      {
        sessionId: "session-1",
        channel: "web",
        messageId: "new-1",
        userId: "user-1",
        role: "assistant",
        text: "new planning summary",
        timestampMs: Date.UTC(2026, 1, 20, 9, 0, 0),
      },
      {
        sessionId: "session-1",
        channel: "web",
        messageId: "old-1",
        userId: "user-1",
        role: "user",
        text: "old planning note",
        timestampMs: Date.UTC(2025, 11, 1, 9, 0, 0),
      },
    ],
    totalCount: 2,
  });

  const retention = await gateway.applyRetentionPolicy({
    sessionId: "session-1",
    retentionDays: 30,
    archiveNow: true,
  });
  assert.deepEqual(retention, {
    status: "applied",
    sessionId: "session-1",
    retentionDays: 30,
    archived: true,
    reason: "Purged 1 message(s) by retention policy",
  });

  const retainedHistory = await gateway.getSessionHistory({
    sessionId: "session-1",
  });
  assert.deepEqual(retainedHistory, {
    status: "ok",
    sessionId: "session-1",
    items: [
      {
        messageId: "new-1",
        userId: "user-1",
        role: "assistant",
        text: "new planning summary",
        timestampMs: Date.UTC(2026, 1, 20, 9, 0, 0),
      },
    ],
    totalCount: 1,
  });
});

test("chat-management rejects invalid request shapes deterministically", async () => {
  const { gateway } = setupChatManagementGateway();

  await assert.rejects(
    async () =>
      gateway.listSessions({
        limit: 0,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      gateway.searchMessages({
        query: "x",
        cursor: "NaN",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
