import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import { createSqlitePersonalityStore } from "../packages/polar-runtime-core/src/index.mjs";

test("sqlite personality store resolves precedence session > user > global", () => {
  const db = new Database(":memory:");
  try {
    let nowMs = Date.UTC(2026, 2, 1, 9, 0, 0);
    const store = createSqlitePersonalityStore({
      db,
      now: () => nowMs,
    });

    const global = store.upsertProfile({
      scope: "global",
      prompt: "Global: concise",
    });
    assert.equal(global.scope, "global");

    nowMs += 1_000;
    const user = store.upsertProfile({
      scope: "user",
      userId: "user-1",
      prompt: "User: very concise",
    });
    assert.equal(user.scope, "user");

    nowMs += 1_000;
    const session = store.upsertProfile({
      scope: "session",
      userId: "user-1",
      sessionId: "session-1",
      prompt: "Session: bullet points",
    });
    assert.equal(session.scope, "session");

    const effectiveSession = store.getEffectiveProfile({
      userId: "user-1",
      sessionId: "session-1",
    });
    assert.equal(effectiveSession?.scope, "session");
    assert.equal(effectiveSession?.prompt, "Session: bullet points");

    const effectiveUser = store.getEffectiveProfile({
      userId: "user-1",
      sessionId: "session-2",
    });
    assert.equal(effectiveUser?.scope, "user");
    assert.equal(effectiveUser?.prompt, "User: very concise");

    const effectiveGlobal = store.getEffectiveProfile({
      userId: "user-2",
      sessionId: "session-3",
    });
    assert.equal(effectiveGlobal?.scope, "global");
    assert.equal(effectiveGlobal?.prompt, "Global: concise");
  } finally {
    db.close();
  }
});

test("sqlite personality store validates max length and required scope fields", () => {
  const db = new Database(":memory:");
  try {
    const store = createSqlitePersonalityStore({ db });

    assert.throws(
      () =>
        store.upsertProfile({
          scope: "global",
          prompt: "x".repeat(2001),
        }),
      (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
    );

    assert.throws(
      () =>
        store.upsertProfile({
          scope: "user",
          prompt: "missing user id",
        }),
      (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
    );

    assert.throws(
      () =>
        store.upsertProfile({
          scope: "session",
          userId: "user-1",
          prompt: "missing session id",
        }),
      (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
    );

    assert.throws(
      () =>
        store.upsertProfile({
          scope: "global",
          prompt: "   ",
        }),
      (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
    );
  } finally {
    db.close();
  }
});
