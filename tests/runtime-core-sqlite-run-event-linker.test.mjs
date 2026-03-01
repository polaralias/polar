import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ContractValidationError,
  RuntimeExecutionError,
} from "../packages/polar-domain/src/index.mjs";
import { createSqliteRunEventLinker } from "../packages/polar-runtime-core/src/index.mjs";

test("createSqliteRunEventLinker validates configuration", () => {
  assert.throws(
    () =>
      createSqliteRunEventLinker({
        db: null,
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR",
  );
});

test("sqlite run event linker persists automation and heartbeat records", async () => {
  const db = new Database(":memory:");
  try {
    const runEventLinker = createSqliteRunEventLinker({
      db,
      now: () => Date.UTC(2026, 1, 25, 9, 0, 0),
    });

    await runEventLinker.recordAutomationRun({
      automationId: "auto.daily-summary",
      runId: "run-1",
      profileId: "profile-default",
      trigger: "schedule",
      output: {
        status: "executed",
      },
      metadata: {
        sessionId: "session-1",
      },
    });

    await runEventLinker.recordHeartbeatRun({
      policyId: "policy-1",
      runId: "hb-run-1",
      profileId: "profile-default",
      trigger: "schedule",
      output: {
        status: "executed",
      },
      metadata: {
        sessionId: "session-1",
      },
    });

    const automationLedger = runEventLinker.listAutomationRunLedger({});
    assert.equal(automationLedger.length, 1);
    assert.equal(automationLedger[0].automationId, "auto.daily-summary");
    assert.equal(automationLedger[0].runId, "run-1");
    assert.equal(automationLedger[0].sequence, 1);

    const heartbeatLedger = runEventLinker.listHeartbeatRunLedger({});
    assert.equal(heartbeatLedger.length, 1);
    assert.equal(heartbeatLedger[0].policyId, "policy-1");
    assert.equal(heartbeatLedger[0].runId, "hb-run-1");
    assert.equal(heartbeatLedger[0].sequence, 2);
  } finally {
    db.close();
  }
});

test("sqlite run event linker records survive restart", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "polar-run-ledger-"));
  const dbPath = join(tempDirectory, "run-ledger.db");

  try {
    const firstDb = new Database(dbPath);
    const firstLinker = createSqliteRunEventLinker({
      db: firstDb,
      now: () => Date.UTC(2026, 1, 25, 9, 5, 0),
    });
    await firstLinker.recordAutomationRun({
      automationId: "auto.persisted",
      runId: "run-persisted-1",
      profileId: "profile-default",
      trigger: "schedule",
      output: {
        status: "executed",
      },
    });
    firstDb.close();

    const secondDb = new Database(dbPath);
    const secondLinker = createSqliteRunEventLinker({
      db: secondDb,
    });
    const ledger = secondLinker.listAutomationRunLedger({
      fromSequence: 0,
    });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].automationId, "auto.persisted");
    assert.equal(ledger[0].runId, "run-persisted-1");
    secondDb.close();
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("sqlite run event linker enforces strict payload shape", async () => {
  const db = new Database(":memory:");
  try {
    const runEventLinker = createSqliteRunEventLinker({
      db,
    });

    await assert.rejects(
      async () =>
        runEventLinker.recordAutomationRun({
          automationId: "auto.daily-summary",
          runId: "run-1",
          profileId: "profile-default",
          trigger: "schedule",
          output: {
            status: "executed",
          },
          unexpected: true,
        }),
      (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
    );
  } finally {
    db.close();
  }
});
