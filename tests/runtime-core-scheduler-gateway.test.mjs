import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ContractValidationError,
  RuntimeExecutionError,
} from "../packages/polar-domain/src/index.mjs";
import {
  createAutomationGateway,
  createContractRegistry,
  createFileSchedulerStateStore,
  createHeartbeatGateway,
  createMiddlewarePipeline,
  createSchedulerGateway,
  createTaskBoardGateway,
  createTaskBoardRunLinker,
  registerAutomationContracts,
  registerHeartbeatContract,
  registerSchedulerContracts,
  registerTaskBoardContracts,
} from "../packages/polar-runtime-core/src/index.mjs";

function createAutomationRunRequest(overrides = {}) {
  return {
    automationId: "auto.daily-summary",
    runId: "run-auto-1",
    trigger: "schedule",
    profileId: "profile-default",
    executionPlan: {
      steps: ["collect", "summarize"],
    },
    capabilityScope: {
      allowedTools: ["memory.search"],
    },
    ...overrides,
  };
}

function createHeartbeatRunRequest(overrides = {}) {
  return {
    policyId: "policy-1",
    profileId: "profile-default",
    runId: "run-heartbeat-1",
    trigger: "schedule",
    timestampMs: Date.UTC(2026, 1, 23, 10, 0, 0),
    cadenceMinutes: 30,
    deliveryRule: "ok",
    activeCheckIds: ["check.tasks"],
    ...overrides,
  };
}

function setupSchedulerIntegration({
  includeRunEventLinker = true,
  automationExecutor = {},
  schedulerStateStore = {},
  now = () => Date.UTC(2026, 1, 23, 10, 0, 0),
} = {}) {
  const contractRegistry = createContractRegistry();
  registerAutomationContracts(contractRegistry);
  registerHeartbeatContract(contractRegistry);
  registerTaskBoardContracts(contractRegistry);
  registerSchedulerContracts(contractRegistry);

  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
  });

  const taskBoardGateway = createTaskBoardGateway({
    middlewarePipeline,
    now,
  });
  const runLinker = createTaskBoardRunLinker({
    taskBoardGateway,
  });
  const automationGateway = createAutomationGateway({
    middlewarePipeline,
    automationExecutor,
    ...(includeRunEventLinker ? { runEventLinker: runLinker } : {}),
  });
  const heartbeatGateway = createHeartbeatGateway({
    middlewarePipeline,
    ...(includeRunEventLinker ? { runEventLinker: runLinker } : {}),
  });
  const schedulerGateway = createSchedulerGateway({
    middlewarePipeline,
    automationGateway,
    heartbeatGateway,
    schedulerStateStore,
    ...(includeRunEventLinker ? { runEventLinker: runLinker } : {}),
    now,
  });

  return {
    taskBoardGateway,
    schedulerGateway,
  };
}

test("registerSchedulerContracts registers scheduler contracts once", () => {
  const contractRegistry = createContractRegistry();
  registerSchedulerContracts(contractRegistry);
  registerSchedulerContracts(contractRegistry);

  assert.deepEqual(contractRegistry.list(), [
    "runtime.scheduler.event-queue.list@1",
    "runtime.scheduler.event-queue.run-action@1",
    "runtime.scheduler.event.process@1",
    "runtime.scheduler.run-link.replay@1",
  ]);
});

test("scheduler processes persisted automation events and replays run-links idempotently", async () => {
  const { schedulerGateway, taskBoardGateway } = setupSchedulerIntegration();

  const processed = await schedulerGateway.processPersistedEvent({
    traceId: "trace-scheduler-auto-1",
    eventId: "event-auto-1",
    source: "automation",
    runId: "run-auto-1",
    recordedAtMs: Date.UTC(2026, 1, 23, 10, 0, 0),
    automationRequest: createAutomationRunRequest({
      runId: "run-auto-1",
    }),
  });

  assert.equal(processed.status, "processed");
  assert.equal(processed.source, "automation");
  assert.equal(processed.runStatus, "executed");
  assert.equal(processed.output.status, "executed");

  const tasks = await taskBoardGateway.listTasks({
    runId: "run-auto-1",
  });
  assert.equal(tasks.totalCount, 1);
  assert.equal(tasks.items[0].taskId, "automation:auto.daily-summary:run:run-auto-1");
  assert.equal(tasks.items[0].status, "done");

  const replayed = await schedulerGateway.replayRunLinks({
    source: "automation",
    fromSequence: 0,
  });
  assert.deepEqual(replayed, {
    status: "ok",
    source: "automation",
    fromSequence: 0,
    automationRecordCount: 1,
    heartbeatRecordCount: 0,
    linkedCount: 0,
    skippedCount: 1,
    rejectedCount: 0,
    totalCount: 1,
  });
});

test("scheduler processes persisted heartbeat events and emits linked task-board outcomes", async () => {
  const { schedulerGateway, taskBoardGateway } = setupSchedulerIntegration();

  const processed = await schedulerGateway.processPersistedEvent({
    eventId: "event-heartbeat-1",
    source: "heartbeat",
    runId: "run-heartbeat-1",
    recordedAtMs: Date.UTC(2026, 1, 23, 10, 15, 0),
    heartbeatRequest: createHeartbeatRunRequest({
      runId: "run-heartbeat-1",
    }),
  });

  assert.equal(processed.status, "processed");
  assert.equal(processed.source, "heartbeat");
  assert.equal(processed.runStatus, "executed");

  const tasks = await taskBoardGateway.listTasks({
    runId: "run-heartbeat-1",
  });
  assert.equal(tasks.totalCount, 1);
  assert.equal(tasks.items[0].taskId, "heartbeat:policy-1:run:run-heartbeat-1");
  assert.equal(tasks.items[0].status, "done");
});

test("scheduler returns deterministic rejected status for malformed persisted events", async () => {
  const { schedulerGateway } = setupSchedulerIntegration();

  const missingPayload = await schedulerGateway.processPersistedEvent({
    eventId: "event-auto-missing",
    source: "automation",
    runId: "run-auto-missing",
    recordedAtMs: Date.UTC(2026, 1, 23, 10, 30, 0),
  });
  assert.deepEqual(missingPayload, {
    status: "rejected",
    eventId: "event-auto-missing",
    source: "automation",
    runId: "run-auto-missing",
    sequence: 0,
    attempt: 1,
    maxAttempts: 1,
    rejectionCode: "POLAR_SCHEDULER_EVENT_PAYLOAD_MISSING",
    reason: "Missing automation request payload",
  });

  const runIdMismatch = await schedulerGateway.processPersistedEvent({
    eventId: "event-auto-mismatch",
    source: "automation",
    runId: "run-auto-mismatch",
    recordedAtMs: Date.UTC(2026, 1, 23, 10, 31, 0),
    automationRequest: createAutomationRunRequest({
      runId: "different-run-id",
    }),
  });
  assert.deepEqual(runIdMismatch, {
    status: "rejected",
    eventId: "event-auto-mismatch",
    source: "automation",
    runId: "run-auto-mismatch",
    sequence: 1,
    attempt: 1,
    maxAttempts: 1,
    rejectionCode: "POLAR_SCHEDULER_EVENT_RUN_ID_MISMATCH",
    reason: "Persisted scheduler event runId does not match payload runId",
  });

  const invalidAutomationPayload = await schedulerGateway.processPersistedEvent({
    eventId: "event-auto-invalid",
    source: "automation",
    runId: "run-auto-invalid",
    recordedAtMs: Date.UTC(2026, 1, 23, 10, 32, 0),
    automationRequest: {
      automationId: "auto.invalid",
      runId: "run-auto-invalid",
    },
  });
  assert.equal(invalidAutomationPayload.status, "rejected");
  assert.equal(
    invalidAutomationPayload.rejectionCode,
    "POLAR_CONTRACT_VALIDATION_ERROR",
  );
  assert.match(
    invalidAutomationPayload.reason,
    /^Invalid automation\.gateway\.run\.request/,
  );

  const processed = await schedulerGateway.processPersistedEvent({
    eventId: "event-auto-dup",
    source: "automation",
    runId: "run-auto-dup",
    recordedAtMs: Date.UTC(2026, 1, 23, 10, 33, 0),
    automationRequest: createAutomationRunRequest({
      runId: "run-auto-dup",
    }),
  });
  assert.equal(processed.status, "processed");

  const duplicate = await schedulerGateway.processPersistedEvent({
    eventId: "event-auto-dup",
    source: "automation",
    runId: "run-auto-dup",
    recordedAtMs: Date.UTC(2026, 1, 23, 10, 34, 0),
    automationRequest: createAutomationRunRequest({
      runId: "run-auto-dup",
    }),
  });
  assert.deepEqual(duplicate, {
    status: "rejected",
    eventId: "event-auto-dup",
    source: "automation",
    runId: "run-auto-dup",
    sequence: 4,
    attempt: 1,
    maxAttempts: 1,
    rejectionCode: "POLAR_SCHEDULER_EVENT_DUPLICATE",
    reason: "Persisted scheduler event is already processed",
  });
});

test("scheduler orchestrates retry and dead-letter dispositions for failed runs", async () => {
  const nowMs = Date.UTC(2026, 1, 23, 11, 0, 0);
  const schedulerStoreCalls = {
    processed: [],
    retry: [],
    deadLetter: [],
  };

  const { schedulerGateway } = setupSchedulerIntegration({
    now: () => nowMs,
    automationExecutor: {
      async executePlan(request) {
        if (request.runId === "run-auto-retry") {
          return {
            status: "failed",
            failure: {
              code: "POLAR_AUTOMATION_FAILURE",
              message: "Retryable automation failure",
            },
            retryEligible: true,
            deadLetterEligible: false,
          };
        }

        return {
          status: "failed",
          failure: {
            code: "POLAR_AUTOMATION_FAILURE",
            message: "Terminal automation failure",
          },
          retryEligible: false,
          deadLetterEligible: true,
        };
      },
    },
    schedulerStateStore: {
      async storeProcessedEvent(event) {
        schedulerStoreCalls.processed.push(event);
      },
      async storeRetryEvent(event) {
        schedulerStoreCalls.retry.push(event);
      },
      async storeDeadLetterEvent(event) {
        schedulerStoreCalls.deadLetter.push(event);
      },
    },
  });

  const retryResult = await schedulerGateway.processPersistedEvent({
    eventId: "event-auto-retry-1",
    source: "automation",
    runId: "run-auto-retry",
    recordedAtMs: Date.UTC(2026, 1, 23, 10, 30, 0),
    attempt: 1,
    maxAttempts: 3,
    retryBackoffMs: 120_000,
    automationRequest: createAutomationRunRequest({
      runId: "run-auto-retry",
    }),
  });

  assert.equal(retryResult.status, "processed");
  assert.equal(retryResult.runStatus, "failed");
  assert.equal(retryResult.attempt, 1);
  assert.equal(retryResult.maxAttempts, 3);
  assert.equal(retryResult.disposition, "retry_scheduled");
  assert.equal(retryResult.nextAttempt, 2);
  assert.equal(retryResult.retryAtMs, nowMs + 120_000);

  const deadLetterResult = await schedulerGateway.processPersistedEvent({
    eventId: "event-auto-dead-letter-1",
    source: "automation",
    runId: "run-auto-dead-letter",
    recordedAtMs: Date.UTC(2026, 1, 23, 10, 35, 0),
    attempt: 3,
    maxAttempts: 3,
    retryBackoffMs: 120_000,
    automationRequest: createAutomationRunRequest({
      runId: "run-auto-dead-letter",
    }),
  });

  assert.equal(deadLetterResult.status, "processed");
  assert.equal(deadLetterResult.runStatus, "failed");
  assert.equal(deadLetterResult.attempt, 3);
  assert.equal(deadLetterResult.maxAttempts, 3);
  assert.equal(deadLetterResult.disposition, "dead_lettered");
  assert.equal(deadLetterResult.deadLetterReason, "run_failed_dead_letter_eligible");

  const retryEvents = schedulerGateway.listRetryEvents();
  assert.equal(retryEvents.length, 1);
  assert.equal(retryEvents[0].eventId, "event-auto-retry-1");
  assert.equal(retryEvents[0].attempt, 1);
  assert.equal(retryEvents[0].maxAttempts, 3);

  const deadLetterEvents = schedulerGateway.listDeadLetterEvents();
  assert.equal(deadLetterEvents.length, 1);
  assert.equal(deadLetterEvents[0].eventId, "event-auto-dead-letter-1");
  assert.equal(deadLetterEvents[0].reason, "run_failed_dead_letter_eligible");

  assert.equal(schedulerStoreCalls.processed.length, 2);
  assert.equal(schedulerStoreCalls.retry.length, 1);
  assert.equal(schedulerStoreCalls.deadLetter.length, 1);
});

test("scheduler consults persisted event state and validates retry orchestration inputs", async () => {
  const { schedulerGateway } = setupSchedulerIntegration({
    schedulerStateStore: {
      async hasProcessedEvent({ eventId }) {
        return eventId === "event-persisted-duplicate";
      },
    },
  });

  const duplicate = await schedulerGateway.processPersistedEvent({
    eventId: "event-persisted-duplicate",
    source: "automation",
    runId: "run-persisted-duplicate",
    recordedAtMs: Date.UTC(2026, 1, 23, 11, 15, 0),
    automationRequest: createAutomationRunRequest({
      runId: "run-persisted-duplicate",
    }),
  });
  assert.deepEqual(duplicate, {
    status: "rejected",
    eventId: "event-persisted-duplicate",
    source: "automation",
    runId: "run-persisted-duplicate",
    sequence: 0,
    attempt: 1,
    maxAttempts: 1,
    rejectionCode: "POLAR_SCHEDULER_EVENT_DUPLICATE",
    reason: "Persisted scheduler event is already processed",
  });

  const attemptExceedsMax = await schedulerGateway.processPersistedEvent({
    eventId: "event-attempt-exceeds",
    source: "automation",
    runId: "run-attempt-exceeds",
    recordedAtMs: Date.UTC(2026, 1, 23, 11, 16, 0),
    attempt: 3,
    maxAttempts: 2,
    automationRequest: createAutomationRunRequest({
      runId: "run-attempt-exceeds",
    }),
  });
  assert.deepEqual(attemptExceedsMax, {
    status: "rejected",
    eventId: "event-attempt-exceeds",
    source: "automation",
    runId: "run-attempt-exceeds",
    sequence: 1,
    attempt: 3,
    maxAttempts: 2,
    rejectionCode: "POLAR_SCHEDULER_EVENT_ATTEMPT_EXCEEDS_MAX",
    reason: "Persisted scheduler event attempt exceeds maxAttempts",
  });

  const invalidRetryBackoff = await schedulerGateway.processPersistedEvent({
    eventId: "event-invalid-retry-backoff",
    source: "automation",
    runId: "run-invalid-retry-backoff",
    recordedAtMs: Date.UTC(2026, 1, 23, 11, 17, 0),
    retryBackoffMs: 12.5,
    automationRequest: createAutomationRunRequest({
      runId: "run-invalid-retry-backoff",
    }),
  });
  assert.deepEqual(invalidRetryBackoff, {
    status: "rejected",
    eventId: "event-invalid-retry-backoff",
    source: "automation",
    runId: "run-invalid-retry-backoff",
    sequence: 2,
    attempt: 1,
    maxAttempts: 1,
    rejectionCode: "POLAR_SCHEDULER_EVENT_RETRY_BACKOFF_INVALID",
    reason: "Persisted scheduler event retryBackoffMs must be a non-negative integer",
  });
});

test("scheduler exposes typed queue diagnostics with deterministic filters", async () => {
  const nowMs = Date.UTC(2026, 1, 23, 11, 30, 0);
  const { schedulerGateway } = setupSchedulerIntegration({
    now: () => nowMs,
    automationExecutor: {
      async executePlan(request) {
        if (request.runId === "run-queue-failed") {
          return {
            status: "failed",
            failure: {
              code: "POLAR_AUTOMATION_FAILURE",
              message: "Queue diagnostics failure",
            },
            retryEligible: true,
          };
        }

        return {
          status: "executed",
        };
      },
    },
  });

  await schedulerGateway.processPersistedEvent({
    eventId: "event-queue-ok",
    source: "automation",
    runId: "run-queue-ok",
    recordedAtMs: Date.UTC(2026, 1, 23, 11, 20, 0),
    automationRequest: createAutomationRunRequest({
      runId: "run-queue-ok",
    }),
  });
  await schedulerGateway.processPersistedEvent({
    eventId: "event-queue-failed",
    source: "automation",
    runId: "run-queue-failed",
    recordedAtMs: Date.UTC(2026, 1, 23, 11, 21, 0),
    attempt: 1,
    maxAttempts: 3,
    retryBackoffMs: 30_000,
    automationRequest: createAutomationRunRequest({
      runId: "run-queue-failed",
    }),
  });

  const processedPage = await schedulerGateway.listEventQueue({
    queue: "processed",
    limit: 1,
  });
  assert.equal(processedPage.status, "ok");
  assert.equal(processedPage.queue, "processed");
  assert.equal(processedPage.fromSequence, 0);
  assert.equal(processedPage.returnedCount, 1);
  assert.equal(processedPage.totalCount, 2);
  assert.equal(processedPage.nextFromSequence, 1);

  const failedProcessed = await schedulerGateway.listEventQueue({
    queue: "processed",
    runStatus: "failed",
  });
  assert.equal(failedProcessed.returnedCount, 1);
  assert.equal(failedProcessed.items[0].eventId, "event-queue-failed");
  assert.equal(failedProcessed.items[0].disposition, "retry_scheduled");
  assert.deepEqual(failedProcessed.summary.statusBreakdown, [
    {
      status: "processed",
      count: 1,
    },
  ]);
  assert.deepEqual(failedProcessed.summary.runStatusBreakdown, [
    {
      runStatus: "failed",
      count: 1,
    },
  ]);
  assert.deepEqual(failedProcessed.summary.dispositionBreakdown, [
    {
      disposition: "retry_scheduled",
      count: 1,
    },
  ]);

  const retryQueue = await schedulerGateway.listEventQueue({
    queue: "retry",
    runId: "run-queue-failed",
  });
  assert.deepEqual(retryQueue, {
    status: "ok",
    queue: "retry",
    fromSequence: 0,
    returnedCount: 1,
    totalCount: 1,
    items: [
      {
        sequence: 0,
        eventId: "event-queue-failed",
        source: "automation",
        runId: "run-queue-failed",
        attempt: 1,
        maxAttempts: 3,
        retryAtMs: nowMs + 30_000,
        reason: "run_failed_retry_eligible",
        requestPayload: createAutomationRunRequest({
          runId: "run-queue-failed",
        }),
      },
    ],
    summary: {
      queue: "retry",
      totalCount: 1,
      uniqueRunCount: 1,
      sourceBreakdown: [
        {
          source: "automation",
          count: 1,
        },
      ],
      firstSequence: 0,
      lastSequence: 0,
      nextRetryAtMs: nowMs + 30_000,
      latestRetryAtMs: nowMs + 30_000,
    },
  });
});

test("scheduler supports typed queue run-actions for retry and dead-letter dismissals", async () => {
  const nowMs = Date.UTC(2026, 1, 23, 11, 40, 0);
  const { schedulerGateway } = setupSchedulerIntegration({
    now: () => nowMs,
    automationExecutor: {
      async executePlan(request) {
        if (request.runId === "run-dismiss-retry") {
          return {
            status: "failed",
            failure: {
              code: "POLAR_AUTOMATION_FAILURE",
              message: "Retry queue dismissal fixture",
            },
            retryEligible: true,
            deadLetterEligible: false,
          };
        }

        return {
          status: "failed",
          failure: {
            code: "POLAR_AUTOMATION_FAILURE",
            message: "Dead-letter queue dismissal fixture",
          },
          retryEligible: false,
          deadLetterEligible: true,
        };
      },
    },
  });

  await schedulerGateway.processPersistedEvent({
    eventId: "event-dismiss-retry",
    source: "automation",
    runId: "run-dismiss-retry",
    recordedAtMs: Date.UTC(2026, 1, 23, 11, 30, 0),
    attempt: 1,
    maxAttempts: 3,
    retryBackoffMs: 10_000,
    automationRequest: createAutomationRunRequest({
      runId: "run-dismiss-retry",
    }),
  });
  await schedulerGateway.processPersistedEvent({
    eventId: "event-dismiss-dead-letter",
    source: "automation",
    runId: "run-dismiss-dead-letter",
    recordedAtMs: Date.UTC(2026, 1, 23, 11, 31, 0),
    attempt: 3,
    maxAttempts: 3,
    retryBackoffMs: 10_000,
    automationRequest: createAutomationRunRequest({
      runId: "run-dismiss-dead-letter",
    }),
  });

  const dismissedRetry = await schedulerGateway.runQueueAction({
    queue: "retry",
    action: "dismiss",
    eventId: "event-dismiss-retry",
  });
  assert.deepEqual(dismissedRetry, {
    status: "applied",
    queue: "retry",
    action: "dismiss",
    eventId: "event-dismiss-retry",
    sequence: 0,
    source: "automation",
    runId: "run-dismiss-retry",
    attempt: 1,
    maxAttempts: 3,
    appliedAtMs: nowMs,
  });

  const retryQueueAfterDismiss = await schedulerGateway.listEventQueue({
    queue: "retry",
  });
  assert.equal(retryQueueAfterDismiss.totalCount, 0);

  const dismissedDeadLetter = await schedulerGateway.runQueueAction({
    queue: "dead_letter",
    action: "dismiss",
    eventId: "event-dismiss-dead-letter",
  });
  assert.deepEqual(dismissedDeadLetter, {
    status: "applied",
    queue: "dead_letter",
    action: "dismiss",
    eventId: "event-dismiss-dead-letter",
    sequence: 0,
    source: "automation",
    runId: "run-dismiss-dead-letter",
    attempt: 3,
    maxAttempts: 3,
    appliedAtMs: nowMs,
  });

  const deadLetterQueueAfterDismiss = await schedulerGateway.listEventQueue({
    queue: "dead_letter",
  });
  assert.equal(deadLetterQueueAfterDismiss.totalCount, 0);

  const missing = await schedulerGateway.runQueueAction({
    queue: "retry",
    action: "dismiss",
    eventId: "event-missing",
  });
  assert.deepEqual(missing, {
    status: "not_found",
    queue: "retry",
    action: "dismiss",
    eventId: "event-missing",
  });
});

test("scheduler queue diagnostics reject invalid queue filter combinations", async () => {
  const { schedulerGateway } = setupSchedulerIntegration();

  await assert.rejects(
    async () =>
      schedulerGateway.listEventQueue({
        queue: "retry",
        status: "failed",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("file scheduler state store persists queue events across gateway instances", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "polar-scheduler-state-"));
  const stateFilePath = join(tempDirectory, "scheduler-state.json");

  try {
    const stateStore = createFileSchedulerStateStore({
      filePath: stateFilePath,
      now: () => Date.UTC(2026, 1, 23, 12, 0, 0),
    });
    const nowMs = Date.UTC(2026, 1, 23, 12, 0, 0);
    const firstIntegration = setupSchedulerIntegration({
      now: () => nowMs,
      schedulerStateStore: stateStore,
      automationExecutor: {
        async executePlan() {
          return {
            status: "failed",
            retryEligible: true,
          };
        },
      },
    });

    const firstProcessed = await firstIntegration.schedulerGateway.processPersistedEvent({
      eventId: "event-file-store-1",
      source: "automation",
      runId: "run-file-store-1",
      recordedAtMs: Date.UTC(2026, 1, 23, 11, 55, 0),
      attempt: 1,
      maxAttempts: 2,
      retryBackoffMs: 60_000,
      automationRequest: createAutomationRunRequest({
        runId: "run-file-store-1",
      }),
    });
    assert.equal(firstProcessed.status, "processed");
    assert.equal(firstProcessed.disposition, "retry_scheduled");

    const secondIntegration = setupSchedulerIntegration({
      schedulerStateStore: createFileSchedulerStateStore({
        filePath: stateFilePath,
      }),
    });
    const duplicate = await secondIntegration.schedulerGateway.processPersistedEvent({
      eventId: "event-file-store-1",
      source: "automation",
      runId: "run-file-store-1",
      recordedAtMs: Date.UTC(2026, 1, 23, 11, 56, 0),
      automationRequest: createAutomationRunRequest({
        runId: "run-file-store-1",
      }),
    });
    assert.deepEqual(duplicate, {
      status: "rejected",
      eventId: "event-file-store-1",
      source: "automation",
      runId: "run-file-store-1",
      sequence: 0,
      attempt: 1,
      maxAttempts: 1,
      rejectionCode: "POLAR_SCHEDULER_EVENT_DUPLICATE",
      reason: "Persisted scheduler event is already processed",
    });

    const persistedProcessed = await secondIntegration.schedulerGateway.listEventQueue({
      queue: "processed",
    });
    assert.equal(persistedProcessed.totalCount, 1);
    assert.equal(persistedProcessed.items[0].eventId, "event-file-store-1");

    const persistedRetry = await secondIntegration.schedulerGateway.listEventQueue({
      queue: "retry",
    });
    assert.equal(persistedRetry.totalCount, 1);
    assert.equal(persistedRetry.items[0].eventId, "event-file-store-1");
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("scheduler preserves request-level validation failures and replay configuration errors", async () => {
  const { schedulerGateway } = setupSchedulerIntegration();

  await assert.rejects(
    async () =>
      schedulerGateway.processPersistedEvent({
        eventId: "event-invalid",
        source: "automation",
        runId: "run-invalid",
        recordedAtMs: Date.UTC(2026, 1, 23, 11, 0, 0),
        automationRequest: createAutomationRunRequest({
          runId: "run-invalid",
        }),
        unexpected: true,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      schedulerGateway.runQueueAction({
        queue: "processed",
        action: "dismiss",
        eventId: "event-invalid-action",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  const { schedulerGateway: withoutReplayGateway } = setupSchedulerIntegration({
    includeRunEventLinker: false,
  });
  await assert.rejects(
    async () => withoutReplayGateway.replayRunLinks({}),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR",
  );
});
