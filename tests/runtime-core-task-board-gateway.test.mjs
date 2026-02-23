import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createMiddlewarePipeline,
  createTaskBoardGateway,
  registerTaskBoardContracts,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupTaskBoardGateway({
  middleware = [],
  initialTasks,
  now = () => Date.UTC(2026, 1, 22, 12, 0, 0),
} = {}) {
  const contractRegistry = createContractRegistry();
  registerTaskBoardContracts(contractRegistry);

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const gateway = createTaskBoardGateway({
    middlewarePipeline,
    initialTasks,
    now,
  });

  return {
    gateway,
    auditEvents,
  };
}

test("registerTaskBoardContracts registers task-board contracts once", () => {
  const contractRegistry = createContractRegistry();
  registerTaskBoardContracts(contractRegistry);
  registerTaskBoardContracts(contractRegistry);

  assert.deepEqual(contractRegistry.list(), [
    "task-board.event.list@1",
    "task-board.run-link.replay@1",
    "task-board.task.list@1",
    "task-board.task.transition@1",
    "task-board.task.upsert@1",
  ]);
});

test("task-board upsert/transition emits deterministic event stream", async () => {
  const middlewareEvents = [];
  const { gateway, auditEvents } = setupTaskBoardGateway({
    middleware: [
      {
        id: "capture",
        before(context) {
          middlewareEvents.push(`before:${context.actionId}`);
        },
        after(context) {
          middlewareEvents.push(`after:${context.output.status}`);
        },
      },
    ],
  });

  const upserted = await gateway.upsertTask({
    traceId: "trace-task-upsert-1",
    taskId: "task-1",
    title: "Review ingress diagnostics",
    assigneeType: "agent_profile",
    assigneeId: "profile.worker",
    status: "todo",
    sessionId: "session-1",
    runId: "run-1",
    artifactIds: ["artifact-b", "artifact-a", "artifact-a"],
    priority: 1,
    metadata: {
      source: "automation",
    },
  });
  assert.deepEqual(upserted, {
    status: "applied",
    taskId: "task-1",
    version: 1,
    previousVersion: 0,
    eventId: "task-event-1",
    task: {
      taskId: "task-1",
      title: "Review ingress diagnostics",
      status: "todo",
      assigneeType: "agent_profile",
      assigneeId: "profile.worker",
      sessionId: "session-1",
      runId: "run-1",
      artifactIds: ["artifact-a", "artifact-b"],
      priority: 1,
      metadata: {
        source: "automation",
      },
      version: 1,
      createdAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
      updatedAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
    },
  });

  const transitioned = await gateway.transitionTask({
    traceId: "trace-task-transition-1",
    taskId: "task-1",
    toStatus: "in_progress",
    assigneeType: "agent",
    assigneeId: "agent-main",
    actorId: "operator-1",
    reason: "Work started",
  });
  assert.deepEqual(transitioned, {
    status: "applied",
    taskId: "task-1",
    fromStatus: "todo",
    toStatus: "in_progress",
    version: 2,
    previousVersion: 1,
    eventId: "task-event-2",
    task: {
      taskId: "task-1",
      title: "Review ingress diagnostics",
      status: "in_progress",
      assigneeType: "agent",
      assigneeId: "agent-main",
      sessionId: "session-1",
      runId: "run-1",
      artifactIds: ["artifact-a", "artifact-b"],
      priority: 1,
      metadata: {
        source: "automation",
      },
      version: 2,
      createdAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
      updatedAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
    },
  });

  const events = await gateway.listTaskEvents({});
  assert.deepEqual(events, {
    status: "ok",
    items: [
      {
        eventId: "task-event-1",
        sequence: 0,
        eventType: "task_created",
        taskId: "task-1",
        version: 1,
        status: "todo",
        timestampMs: Date.UTC(2026, 1, 22, 12, 0, 0),
        payload: {
          source: "automation",
        },
      },
      {
        eventId: "task-event-2",
        sequence: 1,
        eventType: "task_transitioned",
        taskId: "task-1",
        version: 2,
        status: "in_progress",
        previousStatus: "todo",
        actorId: "operator-1",
        reason: "Work started",
        timestampMs: Date.UTC(2026, 1, 22, 12, 0, 0),
      },
    ],
    totalCount: 2,
  });

  assert.deepEqual(middlewareEvents, [
    "before:task-board.task.upsert",
    "after:applied",
    "before:task-board.task.transition",
    "after:applied",
    "before:task-board.event.list",
    "after:ok",
  ]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "task-board.task.transition" &&
        event.traceId === "trace-task-transition-1",
    ),
  );
});

test("task-board transition rejects invalid state changes deterministically", async () => {
  const { gateway } = setupTaskBoardGateway({
    initialTasks: [
      {
        taskId: "task-1",
        title: "Completed task",
        status: "done",
        assigneeType: "user",
        assigneeId: "user-1",
        version: 3,
        createdAtMs: Date.UTC(2026, 1, 20, 10, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 21, 10, 0, 0),
      },
    ],
  });

  const invalidTransition = await gateway.transitionTask({
    taskId: "task-1",
    toStatus: "blocked",
  });
  assert.deepEqual(invalidTransition, {
    status: "rejected",
    taskId: "task-1",
    fromStatus: "done",
    toStatus: "blocked",
    version: 3,
    previousVersion: 3,
    reason: "Invalid status transition from done to blocked",
  });

  const unknownTask = await gateway.transitionTask({
    taskId: "missing",
    toStatus: "todo",
  });
  assert.deepEqual(unknownTask, {
    status: "rejected",
    taskId: "missing",
    toStatus: "todo",
    version: 0,
    previousVersion: 0,
    reason: "Task is not registered",
  });

  const assigneePairMismatch = await gateway.transitionTask({
    taskId: "task-1",
    toStatus: "todo",
    assigneeType: "agent",
  });
  assert.deepEqual(assigneePairMismatch, {
    status: "rejected",
    taskId: "task-1",
    fromStatus: "done",
    toStatus: "todo",
    version: 3,
    previousVersion: 3,
    reason: "Assignee type and assignee id must be provided together",
  });
});

test("task-board list is deterministic with filtering and cursor pagination", async () => {
  const { gateway } = setupTaskBoardGateway({
    initialTasks: [
      {
        taskId: "task-3",
        title: "Done item",
        status: "done",
        assigneeType: "user",
        assigneeId: "user-1",
        sessionId: "session-1",
        version: 1,
        createdAtMs: Date.UTC(2026, 1, 20, 10, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 20, 11, 0, 0),
      },
      {
        taskId: "task-1",
        title: "Active work",
        status: "in_progress",
        assigneeType: "agent",
        assigneeId: "agent-main",
        sessionId: "session-1",
        runId: "run-1",
        version: 2,
        createdAtMs: Date.UTC(2026, 1, 21, 10, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 22, 9, 0, 0),
      },
      {
        taskId: "task-2",
        title: "Blocked work",
        status: "blocked",
        assigneeType: "agent_profile",
        assigneeId: "profile.worker",
        sessionId: "session-2",
        version: 1,
        createdAtMs: Date.UTC(2026, 1, 21, 12, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 22, 8, 0, 0),
      },
    ],
  });

  const first = await gateway.listTasks({
    includeDone: false,
    limit: 1,
  });
  assert.deepEqual(first, {
    status: "ok",
    items: [
      {
        taskId: "task-1",
        title: "Active work",
        status: "in_progress",
        assigneeType: "agent",
        assigneeId: "agent-main",
        sessionId: "session-1",
        runId: "run-1",
        version: 2,
        createdAtMs: Date.UTC(2026, 1, 21, 10, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 22, 9, 0, 0),
      },
    ],
    totalCount: 2,
    nextCursor: "1",
  });

  const second = await gateway.listTasks({
    includeDone: false,
    limit: 1,
    cursor: "1",
  });
  assert.deepEqual(second, {
    status: "ok",
    items: [
      {
        taskId: "task-2",
        title: "Blocked work",
        status: "blocked",
        assigneeType: "agent_profile",
        assigneeId: "profile.worker",
        sessionId: "session-2",
        version: 1,
        createdAtMs: Date.UTC(2026, 1, 21, 12, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 22, 8, 0, 0),
      },
    ],
    totalCount: 2,
  });

  const filtered = await gateway.listTasks({
    assigneeType: "agent",
    assigneeId: "agent-main",
  });
  assert.deepEqual(filtered, {
    status: "ok",
    items: [
      {
        taskId: "task-1",
        title: "Active work",
        status: "in_progress",
        assigneeType: "agent",
        assigneeId: "agent-main",
        sessionId: "session-1",
        runId: "run-1",
        version: 2,
        createdAtMs: Date.UTC(2026, 1, 21, 10, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 22, 9, 0, 0),
      },
    ],
    totalCount: 1,
  });
});

test("task-board replay run links is idempotent with deterministic replay keys", async () => {
  const { gateway } = setupTaskBoardGateway();

  const firstReplay = await gateway.replayRunLinks({
    records: [
      {
        replayKey: "automation:auto.daily-summary:run:run-1",
        taskId: "automation:auto.daily-summary:run:run-1",
        title: "Automation run auto.daily-summary",
        assigneeType: "agent_profile",
        assigneeId: "profile-default",
        toStatus: "done",
        runId: "run-1",
        metadata: {
          source: "automation",
        },
      },
    ],
  });
  assert.deepEqual(firstReplay, {
    status: "ok",
    linkedCount: 1,
    skippedCount: 0,
    rejectedCount: 0,
    totalCount: 1,
    items: [
      {
        replayKey: "automation:auto.daily-summary:run:run-1",
        taskId: "automation:auto.daily-summary:run:run-1",
        status: "linked",
        version: 2,
      },
    ],
  });

  const secondReplay = await gateway.replayRunLinks({
    records: [
      {
        replayKey: "automation:auto.daily-summary:run:run-1",
        taskId: "automation:auto.daily-summary:run:run-1",
        title: "Automation run auto.daily-summary",
        assigneeType: "agent_profile",
        assigneeId: "profile-default",
        toStatus: "done",
        runId: "run-1",
        metadata: {
          source: "automation",
        },
      },
    ],
  });
  assert.deepEqual(secondReplay, {
    status: "ok",
    linkedCount: 0,
    skippedCount: 1,
    rejectedCount: 0,
    totalCount: 1,
    items: [
      {
        replayKey: "automation:auto.daily-summary:run:run-1",
        taskId: "automation:auto.daily-summary:run:run-1",
        status: "skipped_duplicate",
      },
    ],
  });

  const tasks = await gateway.listTasks({
    runId: "run-1",
  });
  assert.equal(tasks.totalCount, 1);
  assert.equal(tasks.items[0].status, "done");
  assert.equal(tasks.items[0].version, 2);
});

test("task-board gateway rejects invalid request shapes and cursor format", async () => {
  const { gateway } = setupTaskBoardGateway();

  await assert.rejects(
    async () =>
      gateway.upsertTask({
        taskId: "task-1",
        title: "x",
        assigneeType: "agent",
        assigneeId: "agent-main",
        priority: 7,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      gateway.listTaskEvents({
        cursor: "not-a-number",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      gateway.replayRunLinks({
        records: {
          replayKey: "x",
        },
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
