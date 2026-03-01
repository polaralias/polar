import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  ContractValidationError,
  RuntimeExecutionError,
} from "../packages/polar-domain/src/index.mjs";
import { createSqliteFeedbackEventStore } from "../packages/polar-runtime-core/src/index.mjs";

test("createSqliteFeedbackEventStore validates configuration", () => {
  assert.throws(
    () =>
      createSqliteFeedbackEventStore({
        db: null,
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR",
  );
});

test("sqlite feedback event store records and lists append-only events", async () => {
  const db = new Database(":memory:");
  try {
    let nowMs = Date.UTC(2026, 1, 24, 9, 0, 0);
    const store = createSqliteFeedbackEventStore({
      db,
      now: () => nowMs,
    });

    const first = await store.recordEvent({
      type: "reaction_added",
      sessionId: "telegram:chat:42",
      messageId: "msg_a_100",
      emoji: "👍",
      polarity: "positive",
      payload: {
        telegramMessageId: 100,
        targetMessageText: "Great summary",
        timestampMs: nowMs,
      },
    });
    assert.equal(first.status, "recorded");
    assert.equal(typeof first.id, "string");
    assert.equal(first.polarity, "positive");

    nowMs += 500;
    await store.recordEvent({
      type: "reaction_added",
      sessionId: "telegram:chat:42",
      messageId: "msg_a_101",
      emoji: "👎",
      polarity: "negative",
      payload: {
        telegramMessageId: 101,
        targetMessageText: "Needs improvement",
        timestampMs: nowMs,
      },
    });

    const listed = await store.listEvents({
      sessionId: "telegram:chat:42",
      limit: 10,
    });
    assert.equal(listed.status, "ok");
    assert.equal(listed.totalCount, 2);
    assert.equal(listed.items.length, 2);
    assert.deepEqual(
      listed.items.map((item) => item.messageId),
      ["msg_a_101", "msg_a_100"],
    );

    const negativeOnly = await store.listEvents({
      sessionId: "telegram:chat:42",
      polarity: "negative",
      limit: 10,
    });
    assert.equal(negativeOnly.totalCount, 1);
    assert.equal(negativeOnly.items[0].emoji, "👎");
    assert.equal(
      negativeOnly.items[0].payload.targetMessageText,
      "Needs improvement",
    );
  } finally {
    db.close();
  }
});

test("sqlite feedback event store enforces strict request shape", async () => {
  const db = new Database(":memory:");
  try {
    const store = createSqliteFeedbackEventStore({ db });

    await assert.rejects(
      async () =>
        store.recordEvent({
          type: "reaction_added",
          sessionId: "telegram:chat:42",
          unexpected: true,
        }),
      (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
    );

    await assert.rejects(
      async () =>
        store.listEvents({
          limit: 0,
        }),
      (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
    );
  } finally {
    db.close();
  }
});
