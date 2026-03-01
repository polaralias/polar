import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  createAutomationRunner,
  createSqliteAutomationJobStore,
  createSqliteRunEventLinker,
} from "../packages/polar-runtime-core/src/index.mjs";

function createControlPlaneStub({ orchestrateResult = { status: "completed", text: "done" } } = {}) {
  const calls = [];
  return {
    calls,
    controlPlane: {
      async orchestrate(request) {
        calls.push(request);
        return orchestrateResult;
      },
      async resolveProfile() {
        return {
          status: "resolved",
          profileId: "profile-default",
        };
      },
    },
  };
}

test("automation runner ticks due jobs through orchestrate and records ledger", async () => {
  const db = new Database(":memory:");
  try {
    let nowMs = Date.UTC(2026, 2, 1, 12, 0, 0);
    const jobStore = createSqliteAutomationJobStore({ db, now: () => nowMs });
    const runEventLinker = createSqliteRunEventLinker({ db, now: () => nowMs });

    await jobStore.createJob({
      id: "auto-reminder",
      ownerUserId: "user-1",
      sessionId: "telegram:chat:1",
      schedule: "every 1 hours",
      promptTemplate: "Reminder: hydrate",
      limits: {
        maxNotificationsPerDay: 3,
      },
    });

    nowMs += 3_600_000;
    const { controlPlane, calls } = createControlPlaneStub();
    const runner = createAutomationRunner({
      controlPlane,
      automationJobStore: jobStore,
      runEventLinker,
      now: () => nowMs,
    });

    const result = await runner.tick();
    assert.equal(result.status, "ok");
    assert.equal(result.dueCount, 1);
    assert.equal(result.runCount, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sessionId, "telegram:chat:1");
    assert.equal(calls[0].userId, "user-1");
    assert.equal(calls[0].metadata.executionType, "automation");

    const ledger = runEventLinker.listAutomationRunLedger({ id: "auto-reminder", limit: 10 });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].automationId, "auto-reminder");
    assert.equal(ledger[0].output.status, "executed");
  } finally {
    db.close();
  }
});

test("automation runner records failure output when orchestrate throws", async () => {
  const db = new Database(":memory:");
  try {
    let nowMs = Date.UTC(2026, 2, 1, 12, 0, 0);
    const jobStore = createSqliteAutomationJobStore({ db, now: () => nowMs });
    const runEventLinker = createSqliteRunEventLinker({ db, now: () => nowMs });

    await jobStore.createJob({
      id: "auto-fail",
      ownerUserId: "user-1",
      sessionId: "telegram:chat:1",
      schedule: "every 1 hours",
      promptTemplate: "Reminder",
    });

    nowMs += 3_600_000;
    const runner = createAutomationRunner({
      controlPlane: {
        async orchestrate() {
          throw new Error("network unavailable");
        },
      },
      automationJobStore: jobStore,
      runEventLinker,
      now: () => nowMs,
    });

    const result = await runner.tick();
    assert.equal(result.runCount, 1);

    const ledger = runEventLinker.listAutomationRunLedger({ id: "auto-fail", limit: 10 });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].output.status, "failed");
    assert.equal(ledger[0].output.failure.code, "POLAR_AUTOMATION_RUNNER_ERROR");
  } finally {
    db.close();
  }
});

test("automation runner blocks inbox body reads without explicit mail.read_body capability", async () => {
  const db = new Database(":memory:");
  try {
    let nowMs = Date.UTC(2026, 2, 1, 12, 0, 0);
    const jobStore = createSqliteAutomationJobStore({ db, now: () => nowMs });
    const runEventLinker = createSqliteRunEventLinker({ db, now: () => nowMs });

    await jobStore.createJob({
      id: "auto-inbox-body",
      ownerUserId: "user-1",
      sessionId: "telegram:chat:1",
      schedule: "every 1 hours",
      promptTemplate: "Check inbox",
      limits: {
        maxNotificationsPerDay: 3,
        inbox: {
          mode: "read_body",
          capabilities: ["mail.search_headers"],
        },
      },
    });

    nowMs += 3_600_000;
    const orchestrateCalls = [];
    const runner = createAutomationRunner({
      controlPlane: {
        async orchestrate(request) {
          orchestrateCalls.push(request);
          return { status: "completed", text: "done" };
        },
        async proactiveInboxCheckHeaders() {
          return {
            status: "completed",
            connectorStatus: "configured",
            headerCount: 1,
            headers: [
              {
                messageId: "msg-1",
                subject: "New message",
                from: "ops@example.com",
              },
            ],
          };
        },
        async proactiveInboxReadBody() {
          return {
            status: "blocked",
            blockedReason:
              "capability_mail.read_body_requires_explicit_permission",
            connectorStatus: "configured",
            messageId: "msg-1",
          };
        },
      },
      automationJobStore: jobStore,
      runEventLinker,
      now: () => nowMs,
    });

    const result = await runner.tick();
    assert.equal(result.runCount, 1);
    assert.equal(result.runs[0].status, "failed");
    assert.equal(orchestrateCalls.length, 0);

    const ledger = runEventLinker.listAutomationRunLedger({
      id: "auto-inbox-body",
      limit: 10,
    });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].output.status, "failed");
    assert.equal(
      ledger[0].output.failure.code,
      "POLAR_AUTOMATION_INBOX_BODY_BLOCKED",
    );
  } finally {
    db.close();
  }
});

test("automation delivery sink receives orchestrator output for channel delivery", async () => {
  const db = new Database(":memory:");
  try {
    let nowMs = Date.UTC(2026, 2, 1, 12, 0, 0);
    const jobStore = createSqliteAutomationJobStore({ db, now: () => nowMs });
    const runEventLinker = createSqliteRunEventLinker({ db, now: () => nowMs });

    await jobStore.createJob({
      id: "auto-delivery",
      ownerUserId: "user-1",
      sessionId: "telegram:chat:1",
      schedule: "every 1 hours",
      promptTemplate: "Reminder: hydrate",
    });

    nowMs += 3_600_000;
    const delivered = [];
    const runner = createAutomationRunner({
      controlPlane: {
        async orchestrate() {
          return { status: "completed", text: "Hydration reminder delivered." };
        },
      },
      automationJobStore: jobStore,
      runEventLinker,
      now: () => nowMs,
      async deliverySink({ orchestrateResult, runId, job }) {
        delivered.push({
          runId,
          jobId: job.id,
          text: orchestrateResult.text,
        });
        return { status: "sent", channel: "telegram", runId };
      },
    });

    const result = await runner.tick();
    assert.equal(result.runCount, 1);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].jobId, "auto-delivery");
    assert.equal(delivered[0].text, "Hydration reminder delivered.");
  } finally {
    db.close();
  }
});
