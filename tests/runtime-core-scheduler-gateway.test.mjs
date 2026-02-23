import test from "node:test";
import assert from "node:assert/strict";

import {
  ContractValidationError,
  RuntimeExecutionError,
} from "../packages/polar-domain/src/index.mjs";
import {
  createAutomationGateway,
  createContractRegistry,
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
    ...(includeRunEventLinker ? { runEventLinker: runLinker } : {}),
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
    rejectionCode: "POLAR_SCHEDULER_EVENT_DUPLICATE",
    reason: "Persisted scheduler event is already processed",
  });
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
