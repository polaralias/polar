import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  ContractValidationError,
} from "../packages/polar-domain/src/index.mjs";
import {
  createSqliteAutomationJobStore,
  isWithinQuietHours,
  parseAutomationSchedule,
} from "../packages/polar-runtime-core/src/index.mjs";

test("parseAutomationSchedule parses supported interval and daily patterns", () => {
  assert.deepEqual(parseAutomationSchedule("every 15 minutes"), {
    kind: "interval",
    intervalMs: 900000,
  });
  assert.deepEqual(parseAutomationSchedule("every 2 hours"), {
    kind: "interval",
    intervalMs: 7200000,
  });
  assert.deepEqual(parseAutomationSchedule("daily at 09:30"), {
    kind: "daily",
    hour: 9,
    minute: 30,
  });
  assert.equal(parseAutomationSchedule("weekly monday"), null);
});

test("isWithinQuietHours handles overnight windows", () => {
  const quiet = { startHour: 22, endHour: 7 };
  const at23 = Date.UTC(2026, 2, 1, 23, 0, 0);
  const at06 = Date.UTC(2026, 2, 1, 6, 0, 0);
  const at13 = Date.UTC(2026, 2, 1, 13, 0, 0);
  assert.equal(isWithinQuietHours(quiet, at23), true);
  assert.equal(isWithinQuietHours(quiet, at06), true);
  assert.equal(isWithinQuietHours(quiet, at13), false);
});

test("sqlite automation job store persists create/list/update/disable lifecycle", async () => {
  const db = new Database(":memory:");
  try {
    let nowMs = Date.UTC(2026, 2, 1, 12, 0, 0);
    const store = createSqliteAutomationJobStore({
      db,
      now: () => nowMs,
    });

    const created = await store.createJob({
      ownerUserId: "user-1",
      sessionId: "telegram:chat:1",
      schedule: "every 1 hours",
      promptTemplate: "Remind me to stretch",
    });

    assert.equal(created.status, "created");
    assert.equal(created.job.enabled, true);
    assert.equal(created.job.ownerUserId, "user-1");
    assert.equal(created.job.limits.maxNotificationsPerDay, 3);

    const listed = await store.listJobs({
      ownerUserId: "user-1",
      enabled: true,
    });
    assert.equal(listed.status, "ok");
    assert.equal(listed.totalCount, 1);
    assert.equal(listed.items[0].id, created.job.id);

    const fetched = await store.getJob({ id: created.job.id });
    assert.equal(fetched.status, "found");
    assert.equal(fetched.job.id, created.job.id);

    nowMs += 1000;
    const updated = await store.updateJob({
      id: created.job.id,
      schedule: "every 2 hours",
      limits: {
        maxNotificationsPerDay: 1,
      },
    });
    assert.equal(updated.status, "updated");
    assert.equal(updated.job.schedule, "every 2 hours");
    assert.equal(updated.job.limits.maxNotificationsPerDay, 1);

    nowMs += 1000;
    const disabled = await store.disableJob({ id: created.job.id });
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.job.enabled, false);

    const enabledAfterDisable = await store.listJobs({ enabled: true });
    assert.equal(enabledAfterDisable.totalCount, 0);

    const deleted = await store.deleteJob({ id: created.job.id });
    assert.equal(deleted.status, "deleted");

    const missingAfterDelete = await store.getJob({ id: created.job.id });
    assert.equal(missingAfterDelete.status, "not_found");
  } finally {
    db.close();
  }
});

test("sqlite automation job store lists due jobs and enforces per-day cap", async () => {
  const db = new Database(":memory:");
  try {
    let nowMs = Date.UTC(2026, 2, 1, 12, 0, 0);
    const store = createSqliteAutomationJobStore({
      db,
      now: () => nowMs,
    });

    const created = await store.createJob({
      id: "auto-1",
      ownerUserId: "user-1",
      sessionId: "telegram:chat:1",
      schedule: "every 1 hours",
      promptTemplate: "Do thing",
      quietHours: { startHour: 22, endHour: 7 },
      limits: { maxNotificationsPerDay: 1 },
    });

    const oneHourLater = nowMs + 3_600_000;
    let due = await store.listDueJobs({ asOfMs: oneHourLater });
    assert.equal(due.totalCount, 1);
    assert.equal(due.items[0].id, created.job.id);

    db.prepare(`
      INSERT INTO polar_run_events (source, id, runId, profileId, trigger, output, metadata, createdAtMs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "automation",
      "auto-1",
      "run-1",
      "profile-1",
      "schedule",
      JSON.stringify({ status: "executed" }),
      JSON.stringify({}),
      oneHourLater,
    );

    due = await store.listDueJobs({ asOfMs: oneHourLater + 60_000 });
    assert.equal(due.totalCount, 0);
  } finally {
    db.close();
  }
});

test("sqlite automation job store rejects invalid request shapes", async () => {
  const db = new Database(":memory:");
  try {
    const store = createSqliteAutomationJobStore({ db });

    await assert.rejects(
      async () =>
        store.createJob({
          ownerUserId: "",
          sessionId: "session-1",
          schedule: "every 1 hours",
          promptTemplate: "x",
        }),
      (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
    );

    await assert.rejects(
      async () =>
        store.updateJob({
          id: "job-1",
        }),
      (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
    );
  } finally {
    db.close();
  }
});
