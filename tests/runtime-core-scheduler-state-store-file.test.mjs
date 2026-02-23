import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ContractValidationError,
  RuntimeExecutionError,
} from "../packages/polar-domain/src/index.mjs";
import { createFileSchedulerStateStore } from "../packages/polar-runtime-core/src/index.mjs";

test("createFileSchedulerStateStore validates configuration", () => {
  assert.throws(
    () =>
      createFileSchedulerStateStore({
        filePath: "",
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR",
  );
});

test("file scheduler state store persists and validates queue events", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "polar-scheduler-store-"));
  const stateFilePath = join(tempDirectory, "scheduler-state.json");

  try {
    const stateStore = createFileSchedulerStateStore({
      filePath: stateFilePath,
      now: () => Date.UTC(2026, 1, 23, 12, 30, 0),
    });

    assert.equal(
      await stateStore.hasProcessedEvent({
        eventId: "event-1",
      }),
      false,
    );

    await stateStore.storeProcessedEvent({
      sequence: 0,
      eventId: "event-1",
      source: "automation",
      runId: "run-1",
      status: "processed",
    });
    await stateStore.storeProcessedEvent({
      sequence: 1,
      eventId: "event-1",
      source: "automation",
      runId: "run-1",
      status: "processed",
    });

    assert.equal(
      await stateStore.hasProcessedEvent({
        eventId: "event-1",
      }),
      true,
    );
    const processedEvents = await stateStore.listProcessedEvents();
    assert.equal(processedEvents.length, 1);
    assert.equal(processedEvents[0].eventId, "event-1");

    await stateStore.storeRetryEvent({
      sequence: 0,
      eventId: "event-retry-1",
      source: "automation",
      runId: "run-retry-1",
      attempt: 1,
      maxAttempts: 3,
      retryAtMs: Date.UTC(2026, 1, 23, 12, 35, 0),
      reason: "execution_failed_retry",
    });
    await stateStore.storeDeadLetterEvent({
      sequence: 0,
      eventId: "event-dead-letter-1",
      source: "automation",
      runId: "run-dead-letter-1",
      attempt: 3,
      maxAttempts: 3,
      reason: "max_attempts_exhausted",
    });

    const retryEvents = await stateStore.listRetryEvents();
    assert.equal(retryEvents.length, 1);
    assert.equal(retryEvents[0].eventId, "event-retry-1");

    const deadLetterEvents = await stateStore.listDeadLetterEvents();
    assert.equal(deadLetterEvents.length, 1);
    assert.equal(deadLetterEvents[0].eventId, "event-dead-letter-1");

    const removedRetry = await stateStore.removeRetryEvent({
      eventId: "event-retry-1",
    });
    assert.equal(removedRetry, true);
    assert.equal((await stateStore.listRetryEvents()).length, 0);

    const removedDeadLetter = await stateStore.removeDeadLetterEvent({
      eventId: "event-dead-letter-1",
    });
    assert.equal(removedDeadLetter, true);
    assert.equal((await stateStore.listDeadLetterEvents()).length, 0);

    const missingRetryRemoval = await stateStore.removeRetryEvent({
      eventId: "event-retry-missing",
    });
    assert.equal(missingRetryRemoval, false);

    await assert.rejects(
      async () =>
        stateStore.storeRetryEvent({
          sequence: 1,
          eventId: "event-retry-invalid",
          source: "automation",
          runId: "run-retry-invalid",
          attempt: 1,
          maxAttempts: 3,
          retryAtMs: Date.UTC(2026, 1, 23, 12, 45, 0),
        }),
      (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
    );

    await assert.rejects(
      async () =>
        stateStore.removeDeadLetterEvent({
          eventId: "",
        }),
      (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
    );

    await stateStore.clear();
    assert.equal((await stateStore.listProcessedEvents()).length, 0);
    assert.equal((await stateStore.listRetryEvents()).length, 0);
    assert.equal((await stateStore.listDeadLetterEvents()).length, 0);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
