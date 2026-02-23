import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createAutomationGateway,
  createContractRegistry,
  createHeartbeatGateway,
  createMiddlewarePipeline,
  createTaskBoardGateway,
  createTaskBoardRunLinker,
  registerAutomationContracts,
  registerHeartbeatContract,
  registerTaskBoardContracts,
} from "../packages/polar-runtime-core/src/index.mjs";

function createAutomationRunRequest(overrides = {}) {
  return {
    automationId: "auto.daily-summary",
    runId: "run-1",
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
    runId: "hb-run-1",
    trigger: "schedule",
    timestampMs: Date.UTC(2026, 1, 22, 12, 0, 0),
    cadenceMinutes: 30,
    deliveryRule: "ok",
    activeCheckIds: ["check.tasks"],
    ...overrides,
  };
}

function setupLinkedGateways({
  now = () => Date.UTC(2026, 1, 22, 12, 0, 0),
} = {}) {
  const contractRegistry = createContractRegistry();
  registerAutomationContracts(contractRegistry);
  registerHeartbeatContract(contractRegistry);
  registerTaskBoardContracts(contractRegistry);

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
    runEventLinker: runLinker,
  });
  const heartbeatGateway = createHeartbeatGateway({
    middlewarePipeline,
    runEventLinker: runLinker,
  });

  return {
    taskBoardGateway,
    runLinker,
    automationGateway,
    heartbeatGateway,
  };
}

test("task-board run linker records automation run outcomes as linked tasks/events", async () => {
  const { taskBoardGateway, automationGateway } = setupLinkedGateways();

  const executed = await automationGateway.executeRun(createAutomationRunRequest());
  assert.equal(executed.status, "executed");

  const tasks = await taskBoardGateway.listTasks({
    runId: "run-1",
  });
  assert.deepEqual(tasks, {
    status: "ok",
    items: [
      {
        taskId: "automation:auto.daily-summary:run:run-1",
        title: "Automation run auto.daily-summary",
        status: "done",
        assigneeType: "agent_profile",
        assigneeId: "profile-default",
        runId: "run-1",
        metadata: {
          source: "automation",
          automationId: "auto.daily-summary",
          trigger: "schedule",
          output: {
            status: "executed",
            automationId: "auto.daily-summary",
            runId: "run-1",
            trigger: "schedule",
            selectedModelLane: "local",
            escalationApplied: false,
            stepCount: 2,
            outcome: {
              message: "Automation run executed with default executor",
            },
            retryEligible: false,
            deadLetterEligible: false,
          },
        },
        version: 2,
        createdAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
      },
    ],
    totalCount: 1,
  });

  const events = await taskBoardGateway.listTaskEvents({
    taskId: "automation:auto.daily-summary:run:run-1",
  });
  assert.deepEqual(events, {
    status: "ok",
    items: [
      {
        eventId: "task-event-1",
        sequence: 0,
        eventType: "task_created",
        taskId: "automation:auto.daily-summary:run:run-1",
        version: 1,
        status: "todo",
        timestampMs: Date.UTC(2026, 1, 22, 12, 0, 0),
        payload: {
          source: "automation",
          automationId: "auto.daily-summary",
          trigger: "schedule",
          output: {
            status: "executed",
            automationId: "auto.daily-summary",
            runId: "run-1",
            trigger: "schedule",
            selectedModelLane: "local",
            escalationApplied: false,
            stepCount: 2,
            outcome: {
              message: "Automation run executed with default executor",
            },
            retryEligible: false,
            deadLetterEligible: false,
          },
        },
      },
      {
        eventId: "task-event-2",
        sequence: 1,
        eventType: "task_transitioned",
        taskId: "automation:auto.daily-summary:run:run-1",
        version: 2,
        status: "done",
        previousStatus: "todo",
        timestampMs: Date.UTC(2026, 1, 22, 12, 0, 0),
        payload: {
          source: "automation",
          automationId: "auto.daily-summary",
          trigger: "schedule",
          output: {
            status: "executed",
            automationId: "auto.daily-summary",
            runId: "run-1",
            trigger: "schedule",
            selectedModelLane: "local",
            escalationApplied: false,
            stepCount: 2,
            outcome: {
              message: "Automation run executed with default executor",
            },
            retryEligible: false,
            deadLetterEligible: false,
          },
        },
      },
    ],
    totalCount: 2,
  });
});

test("task-board run linker maps automation skip outcomes to blocked task state", async () => {
  const { taskBoardGateway, automationGateway } = setupLinkedGateways();

  const skipped = await automationGateway.executeRun(
    createAutomationRunRequest({
      runId: "run-skip-1",
      active: false,
    }),
  );
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.skipReason, "policy_inactive");

  const tasks = await taskBoardGateway.listTasks({
    runId: "run-skip-1",
  });
  assert.equal(tasks.totalCount, 1);
  assert.equal(tasks.items[0].status, "blocked");

  const events = await taskBoardGateway.listTaskEvents({
    taskId: "automation:auto.daily-summary:run:run-skip-1",
  });
  assert.equal(events.totalCount, 2);
  assert.equal(events.items[1].reason, "Automation skipped: policy_inactive");
});

test("task-board run linker records heartbeat outcomes as linked tasks/events", async () => {
  const { taskBoardGateway, heartbeatGateway } = setupLinkedGateways();

  const result = await heartbeatGateway.tick(
    createHeartbeatRunRequest({
      runId: "hb-run-1",
    }),
  );
  assert.equal(result.status, "executed");

  const tasks = await taskBoardGateway.listTasks({
    runId: "hb-run-1",
  });
  assert.equal(tasks.totalCount, 1);
  assert.equal(tasks.items[0].taskId, "heartbeat:policy-1:run:hb-run-1");
  assert.equal(tasks.items[0].status, "done");
  assert.equal(tasks.items[0].assigneeType, "agent_profile");
  assert.equal(tasks.items[0].assigneeId, "profile-default");

  const events = await taskBoardGateway.listTaskEvents({
    taskId: "heartbeat:policy-1:run:hb-run-1",
  });
  assert.equal(events.totalCount, 2);
  assert.equal(events.items[0].eventType, "task_created");
  assert.equal(events.items[1].eventType, "task_transitioned");
  assert.equal(events.items[1].status, "done");
});

test("task-board run linker rejects invalid run-link payloads deterministically", async () => {
  const { runLinker } = setupLinkedGateways();

  await assert.rejects(
    async () =>
      runLinker.recordAutomationRun({
        automationId: "auto.x",
        runId: "run-x",
        profileId: "profile-default",
        trigger: "schedule",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      runLinker.recordHeartbeatRun({
        policyId: "policy-1",
        runId: "run-y",
        profileId: "profile-default",
        trigger: "heartbeat",
        output: {
          status: "executed",
        },
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("task-board run linker can replay recorded runs idempotently", async () => {
  const { taskBoardGateway, runLinker, automationGateway, heartbeatGateway } =
    setupLinkedGateways();

  await automationGateway.executeRun(
    createAutomationRunRequest({
      runId: "run-replay-1",
    }),
  );
  await heartbeatGateway.tick(
    createHeartbeatRunRequest({
      runId: "hb-run-replay-1",
    }),
  );

  const replayResult = await runLinker.replayRecordedRuns({
    source: "all",
    fromSequence: 0,
  });
  assert.deepEqual(replayResult, {
    status: "ok",
    source: "all",
    fromSequence: 0,
    automationRecordCount: 1,
    heartbeatRecordCount: 1,
    linkedCount: 0,
    skippedCount: 2,
    rejectedCount: 0,
    totalCount: 2,
  });

  const automationEvents = await taskBoardGateway.listTaskEvents({
    taskId: "automation:auto.daily-summary:run:run-replay-1",
  });
  const heartbeatEvents = await taskBoardGateway.listTaskEvents({
    taskId: "heartbeat:policy-1:run:hb-run-replay-1",
  });
  assert.equal(automationEvents.totalCount, 2);
  assert.equal(heartbeatEvents.totalCount, 2);
});
