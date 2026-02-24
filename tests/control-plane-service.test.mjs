import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import { createControlPlaneService } from "../packages/polar-control-plane/src/index.mjs";

test("control-plane service health reports contract and record counts", async () => {
  const service = createControlPlaneService();

  const initialHealth = service.health();
  assert.deepEqual(initialHealth, {
    status: "ok",
    contractCount: 27,
    recordCount: 0,
    sessionCount: 0,
    taskCount: 0,
    taskEventCount: 0,
    taskReplayKeyCount: 0,
    handoffRoutingTelemetryCount: 0,
    usageTelemetryCount: 0,
  });

  await service.upsertConfig({
    resourceType: "profile",
    resourceId: "default",
    config: {
      modelLane: "worker",
    },
  });

  assert.deepEqual(service.health(), {
    status: "ok",
    contractCount: 27,
    recordCount: 1,
    sessionCount: 0,
    taskCount: 0,
    taskEventCount: 0,
    taskReplayKeyCount: 0,
    handoffRoutingTelemetryCount: 0,
    usageTelemetryCount: 0,
  });
});

test("control-plane service proxies typed config operations", async () => {
  const service = createControlPlaneService();

  const upserted = await service.upsertConfig({
    resourceType: "automation",
    resourceId: "daily-report",
    config: {
      enabled: true,
      schedule: {
        kind: "hourly",
        intervalHours: 24,
      },
    },
  });
  assert.equal(upserted.status, "applied");

  const fetched = await service.getConfig({
    resourceType: "automation",
    resourceId: "daily-report",
  });
  assert.deepEqual(fetched, {
    status: "found",
    resourceType: "automation",
    resourceId: "daily-report",
    version: 1,
    config: {
      enabled: true,
      schedule: {
        kind: "hourly",
        intervalHours: 24,
      },
    },
  });

  const listed = await service.listConfigs({
    resourceType: "automation",
    includeValues: true,
  });
  assert.deepEqual(listed, {
    status: "ok",
    resourceType: "automation",
    items: [
      {
        resourceId: "daily-report",
        version: 1,
        config: {
          enabled: true,
          schedule: {
            kind: "hourly",
            intervalHours: 24,
          },
        },
      },
    ],
    totalCount: 1,
  });
});

test("control-plane service proxies runtime profile resolution with scope precedence", async () => {
  const service = createControlPlaneService();

  await service.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.global",
    config: {
      modelLane: "worker",
    },
  });
  await service.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.workspace",
    config: {
      modelLane: "brain",
    },
  });
  await service.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.session",
    config: {
      modelLane: "local",
    },
  });
  await service.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:global",
    config: {
      profileId: "profile.global",
    },
  });
  await service.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:workspace:workspace-1",
    config: {
      profileId: "profile.workspace",
    },
  });
  await service.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:session:session-1",
    config: {
      profileId: "profile.session",
    },
  });

  const resolved = await service.resolveProfile({
    sessionId: "session-1",
    workspaceId: "workspace-1",
    defaultProfileId: "profile.global",
  });
  assert.deepEqual(resolved, {
    status: "resolved",
    resolvedScope: "session",
    profileId: "profile.session",
    profileVersion: 1,
    pinResourceId: "profile-pin:session:session-1",
    profileConfig: {
      modelLane: "local",
    },
  });

  const workspaceResolved = await service.resolveProfile({
    sessionId: "session-unknown",
    workspaceId: "workspace-1",
    includeProfileConfig: false,
  });
  assert.deepEqual(workspaceResolved, {
    status: "resolved",
    resolvedScope: "workspace",
    profileId: "profile.workspace",
    profileVersion: 1,
    pinResourceId: "profile-pin:workspace:workspace-1",
  });
});

test("control-plane service proxies chat-management operations", async () => {
  const service = createControlPlaneService({
    initialSessions: [
      {
        sessionId: "session-1",
        userId: "user-1",
        channel: "telegram",
        title: "Telegram session",
        createdAtMs: Date.UTC(2026, 1, 21, 10, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 21, 10, 0, 0),
      },
    ],
  });

  await service.appendMessage({
    sessionId: "session-1",
    userId: "user-1",
    messageId: "msg-1",
    role: "user",
    text: "Need a recap",
    timestampMs: Date.UTC(2026, 1, 22, 11, 0, 0),
  });

  const sessions = await service.listSessions({
    channel: "telegram",
  });
  assert.deepEqual(sessions, {
    status: "ok",
    items: [
      {
        sessionId: "session-1",
        userId: "user-1",
        channel: "telegram",
        title: "Telegram session",
        tags: [],
        archived: false,
        messageCount: 1,
        lastMessageAtMs: Date.UTC(2026, 1, 22, 11, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 22, 11, 0, 0),
      },
    ],
    totalCount: 1,
  });

  const history = await service.getSessionHistory({
    sessionId: "session-1",
  });
  assert.deepEqual(history, {
    status: "ok",
    sessionId: "session-1",
    items: [
      {
        messageId: "msg-1",
        userId: "user-1",
        role: "user",
        text: "Need a recap",
        timestampMs: Date.UTC(2026, 1, 22, 11, 0, 0),
      },
    ],
    totalCount: 1,
  });

  const searched = await service.searchMessages({
    query: "recap",
  });
  assert.deepEqual(searched, {
    status: "ok",
    items: [
      {
        sessionId: "session-1",
        channel: "telegram",
        messageId: "msg-1",
        userId: "user-1",
        role: "user",
        text: "Need a recap",
        timestampMs: Date.UTC(2026, 1, 22, 11, 0, 0),
      },
    ],
    totalCount: 1,
  });
});

test("control-plane service proxies ingress health diagnostics", async () => {
  const nowMs = Date.UTC(2026, 1, 23, 8, 30, 0);
  const middlewareEvents = [];

  const service = createControlPlaneService({
    now: () => nowMs,
    middleware: [
      {
        id: "capture-ingress-health",
        before(context) {
          if (context.actionId === "chat.ingress.health.check") {
            middlewareEvents.push(`before:${context.actionId}`);
          }
        },
        after(context) {
          if (context.actionId === "chat.ingress.health.check") {
            middlewareEvents.push(`after:${context.output.status}`);
          }
        },
      },
    ],
  });

  const result = await service.checkIngressHealth({
    traceId: "trace-ingress-health-1",
  });

  assert.deepEqual(result, {
    status: "healthy",
    checkedAtMs: nowMs,
    resultCount: 4,
    results: [
      { adapter: "web", status: "healthy" },
      { adapter: "telegram", status: "healthy" },
      { adapter: "slack", status: "healthy" },
      { adapter: "discord", status: "healthy" },
    ],
  });
  assert.deepEqual(middlewareEvents, [
    "before:chat.ingress.health.check",
    "after:healthy",
  ]);
});

test("control-plane service proxies task-board operations", async () => {
  const nowMs = Date.UTC(2026, 1, 22, 12, 0, 0);
  const service = createControlPlaneService({
    now: () => nowMs,
  });

  const upserted = await service.upsertTask({
    taskId: "task-1",
    title: "Follow up automation failure",
    assigneeType: "agent_profile",
    assigneeId: "profile.worker",
    sessionId: "session-1",
    status: "todo",
  });
  assert.deepEqual(upserted, {
    status: "applied",
    taskId: "task-1",
    version: 1,
    previousVersion: 0,
    eventId: "task-event-1",
    task: {
      taskId: "task-1",
      title: "Follow up automation failure",
      status: "todo",
      assigneeType: "agent_profile",
      assigneeId: "profile.worker",
      sessionId: "session-1",
      version: 1,
      createdAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
      updatedAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
    },
  });

  const transitioned = await service.transitionTask({
    taskId: "task-1",
    toStatus: "in_progress",
    assigneeType: "agent",
    assigneeId: "agent-main",
    actorId: "operator-1",
    reason: "Start remediation",
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
      title: "Follow up automation failure",
      status: "in_progress",
      assigneeType: "agent",
      assigneeId: "agent-main",
      sessionId: "session-1",
      version: 2,
      createdAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
      updatedAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
    },
  });

  const listedTasks = await service.listTasks({
    includeDone: false,
  });
  assert.deepEqual(listedTasks, {
    status: "ok",
    items: [
      {
        taskId: "task-1",
        title: "Follow up automation failure",
        status: "in_progress",
        assigneeType: "agent",
        assigneeId: "agent-main",
        sessionId: "session-1",
        version: 2,
        createdAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
        updatedAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
      },
    ],
    totalCount: 1,
  });

  const listedEvents = await service.listTaskEvents({});
  assert.deepEqual(listedEvents, {
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
        reason: "Start remediation",
        timestampMs: Date.UTC(2026, 1, 22, 12, 0, 0),
      },
    ],
    totalCount: 2,
  });

  const replayed = await service.replayTaskRunLinks({
    records: [
      {
        replayKey: "automation:auto.daily-summary:run:run-1",
        taskId: "automation:auto.daily-summary:run:run-1",
        title: "Automation run auto.daily-summary",
        assigneeType: "agent_profile",
        assigneeId: "profile.worker",
        toStatus: "done",
        runId: "run-1",
        metadata: {
          source: "automation",
        },
      },
    ],
  });
  assert.deepEqual(replayed, {
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

  assert.deepEqual(service.health(), {
    status: "ok",
    contractCount: 27,
    recordCount: 0,
    sessionCount: 0,
    taskCount: 2,
    taskEventCount: 4,
    taskReplayKeyCount: 1,
    handoffRoutingTelemetryCount: 0,
    usageTelemetryCount: 0,
  });
});

test("control-plane service proxies handoff routing telemetry list operations", async () => {
  const middlewareEvents = [];
  const service = createControlPlaneService({
    middleware: [
      {
        id: "capture-handoff-telemetry",
        before(context) {
          if (context.actionId === "agent.handoff.routing-telemetry.list") {
            middlewareEvents.push(`before:${context.actionId}`);
          }
        },
        after(context) {
          if (context.actionId === "agent.handoff.routing-telemetry.list") {
            middlewareEvents.push(`after:${context.output.status}`);
          }
        },
      },
    ],
  });

  const listed = await service.listHandoffRoutingTelemetry({
    traceId: "trace-handoff-routing-telemetry-1",
    limit: 10,
  });
  assert.deepEqual(listed, {
    status: "ok",
    fromSequence: 1,
    returnedCount: 0,
    totalCount: 0,
    items: [],
  });
  assert.deepEqual(middlewareEvents, [
    "before:agent.handoff.routing-telemetry.list",
    "after:ok",
  ]);
});

test("control-plane service proxies usage telemetry list operations", async () => {
  const middlewareEvents = [];
  const service = createControlPlaneService({
    middleware: [
      {
        id: "capture-usage-telemetry",
        before(context) {
          if (context.actionId === "runtime.usage-telemetry.list") {
            middlewareEvents.push(`before:${context.actionId}`);
          }
        },
        after(context) {
          if (context.actionId === "runtime.usage-telemetry.list") {
            middlewareEvents.push(`after:${context.output.status}`);
          }
        },
      },
    ],
  });

  const listed = await service.listUsageTelemetry({
    traceId: "trace-usage-telemetry-1",
    limit: 10,
  });
  assert.deepEqual(listed, {
    status: "ok",
    fromSequence: 1,
    returnedCount: 0,
    totalCount: 0,
    items: [],
    summary: {
      totalOperations: 0,
      completedCount: 0,
      failedCount: 0,
      fallbackCount: 0,
      totalDurationMs: 0,
      totalEstimatedCostUsd: 0,
      byOperation: [],
      byProvider: [],
      byModelLane: [],
    },
  });
  assert.deepEqual(middlewareEvents, [
    "before:runtime.usage-telemetry.list",
    "after:ok",
  ]);
});

test("control-plane service proxies telemetry alert list operations", async () => {
  const middlewareEvents = [];
  const service = createControlPlaneService({
    middleware: [
      {
        id: "capture-telemetry-alerts",
        before(context) {
          if (context.actionId === "runtime.telemetry.alerts.list") {
            middlewareEvents.push(`before:${context.actionId}`);
          }
        },
        after(context) {
          if (context.actionId === "runtime.telemetry.alerts.list") {
            middlewareEvents.push(`after:${context.output.status}`);
          }
        },
      },
    ],
  });

  const listed = await service.listTelemetryAlerts({
    traceId: "trace-telemetry-alerts-1",
    scope: "all",
    minimumSampleSize: 1,
  });

  assert.deepEqual(listed, {
    status: "ok",
    evaluatedAtMs: listed.evaluatedAtMs,
    scope: "all",
    minimumSampleSize: 1,
    alertCount: 0,
    alerts: [],
    usageWindow: {
      totalOperations: 0,
      failedCount: 0,
      fallbackCount: 0,
      totalDurationMs: 0,
      averageDurationMs: 0,
      sampleSizeSatisfied: false,
    },
    handoffWindow: {
      evaluatedCount: 0,
      failedCount: 0,
      routeAdjustedCount: 0,
      failureRate: 0,
      routeAdjustedRate: 0,
      sampleSizeSatisfied: false,
    },
  });
  assert.deepEqual(middlewareEvents, [
    "before:runtime.telemetry.alerts.list",
    "after:ok",
  ]);
});

test("control-plane service proxies scheduler queue diagnostics operations", async () => {
  const middlewareEvents = [];
  const service = createControlPlaneService({
    schedulerStateStore: {
      async listRetryEvents() {
        return Object.freeze([
          Object.freeze({
            sequence: 2,
            eventId: "event-retry-1",
            source: "automation",
            runId: "run-retry-1",
            attempt: 1,
            maxAttempts: 3,
            retryAtMs: Date.UTC(2026, 1, 23, 12, 5, 0),
            reason: "execution_failed_retry",
          }),
        ]);
      },
    },
    middleware: [
      {
        id: "capture-scheduler-queue",
        before(context) {
          if (context.actionId === "runtime.scheduler.event-queue.list") {
            middlewareEvents.push(`before:${context.actionId}`);
          }
        },
        after(context) {
          if (context.actionId === "runtime.scheduler.event-queue.list") {
            middlewareEvents.push(`after:${context.output.status}`);
          }
        },
      },
    ],
  });

  const listed = await service.listSchedulerEventQueue({
    traceId: "trace-scheduler-queue-1",
    queue: "retry",
    limit: 10,
  });

  assert.deepEqual(listed, {
    status: "ok",
    queue: "retry",
    fromSequence: 0,
    returnedCount: 1,
    totalCount: 1,
    items: [
      {
        sequence: 2,
        eventId: "event-retry-1",
        source: "automation",
        runId: "run-retry-1",
        attempt: 1,
        maxAttempts: 3,
        retryAtMs: Date.UTC(2026, 1, 23, 12, 5, 0),
        reason: "execution_failed_retry",
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
      firstSequence: 2,
      lastSequence: 2,
      nextRetryAtMs: Date.UTC(2026, 1, 23, 12, 5, 0),
      latestRetryAtMs: Date.UTC(2026, 1, 23, 12, 5, 0),
    },
  });
  assert.deepEqual(middlewareEvents, [
    "before:runtime.scheduler.event-queue.list",
    "after:ok",
  ]);
});

test("control-plane service proxies scheduler queue run-action operations", async () => {
  const middlewareEvents = [];
  const retryEvents = [
    Object.freeze({
      sequence: 2,
      eventId: "event-retry-dismiss",
      source: "automation",
      runId: "run-retry-dismiss",
      attempt: 1,
      maxAttempts: 3,
      retryAtMs: Date.UTC(2026, 1, 23, 12, 5, 0),
      reason: "execution_failed_retry",
    }),
  ];
  const service = createControlPlaneService({
    now: () => Date.UTC(2026, 1, 23, 12, 10, 0),
    schedulerStateStore: {
      async listRetryEvents() {
        return Object.freeze([...retryEvents]);
      },
      async removeRetryEvent(request) {
        const index = retryEvents.findIndex(
          (event) => event.eventId === request.eventId,
        );
        if (index < 0) {
          return false;
        }
        retryEvents.splice(index, 1);
        return true;
      },
    },
    middleware: [
      {
        id: "capture-scheduler-queue-action",
        before(context) {
          if (context.actionId === "runtime.scheduler.event-queue.run-action") {
            middlewareEvents.push(`before:${context.actionId}`);
          }
        },
        after(context) {
          if (context.actionId === "runtime.scheduler.event-queue.run-action") {
            middlewareEvents.push(`after:${context.output.status}`);
          }
        },
      },
    ],
  });

  const actionResult = await service.runSchedulerQueueAction({
    traceId: "trace-scheduler-queue-action-1",
    queue: "retry",
    action: "dismiss",
    eventId: "event-retry-dismiss",
  });
  assert.deepEqual(actionResult, {
    status: "applied",
    queue: "retry",
    action: "dismiss",
    eventId: "event-retry-dismiss",
    sequence: 2,
    source: "automation",
    runId: "run-retry-dismiss",
    attempt: 1,
    maxAttempts: 3,
    appliedAtMs: Date.UTC(2026, 1, 23, 12, 10, 0),
  });
  assert.deepEqual(middlewareEvents, [
    "before:runtime.scheduler.event-queue.run-action",
    "after:applied",
  ]);

  const listed = await service.listSchedulerEventQueue({
    queue: "retry",
  });
  assert.equal(listed.totalCount, 0);
});

test("control-plane service proxies scheduler queue retry_now and requeue actions", async () => {
  let nowMs = Date.UTC(2026, 1, 23, 12, 20, 0);
  const retryEvents = [
    Object.freeze({
      sequence: 2,
      eventId: "event-retry-now",
      source: "automation",
      runId: "run-retry-now",
      attempt: 1,
      maxAttempts: 3,
      retryAtMs: Date.UTC(2026, 1, 23, 12, 5, 0),
      reason: "execution_failed_retry",
      requestPayload: {
        automationId: "auto.daily-summary",
        runId: "run-retry-now",
      },
    }),
  ];
  const deadLetterEvents = [
    Object.freeze({
      sequence: 4,
      eventId: "event-dead-letter-requeue",
      source: "automation",
      runId: "run-dead-letter-requeue",
      attempt: 3,
      maxAttempts: 3,
      reason: "max_attempts_exhausted",
      requestPayload: {
        automationId: "auto.daily-summary",
        runId: "run-dead-letter-requeue",
      },
    }),
  ];

  const service = createControlPlaneService({
    now: () => nowMs,
    schedulerStateStore: {
      async listRetryEvents() {
        return Object.freeze([...retryEvents]);
      },
      async listDeadLetterEvents() {
        return Object.freeze([...deadLetterEvents]);
      },
      async removeRetryEvent(request) {
        const index = retryEvents.findIndex(
          (event) => event.eventId === request.eventId,
        );
        if (index < 0) {
          return false;
        }
        retryEvents.splice(index, 1);
        return true;
      },
      async removeDeadLetterEvent(request) {
        const index = deadLetterEvents.findIndex(
          (event) => event.eventId === request.eventId,
        );
        if (index < 0) {
          return false;
        }
        deadLetterEvents.splice(index, 1);
        return true;
      },
      async storeRetryEvent(event) {
        retryEvents.push(Object.freeze({ ...event }));
      },
    },
  });

  const retryNowAtMs = Date.UTC(2026, 1, 23, 12, 25, 0);
  const retryNow = await service.runSchedulerQueueAction({
    queue: "retry",
    action: "retry_now",
    eventId: "event-retry-now",
    retryAtMs: retryNowAtMs,
    reason: "operator_retry_now",
  });
  assert.deepEqual(retryNow, {
    status: "applied",
    queue: "retry",
    action: "retry_now",
    eventId: "event-retry-now",
    sequence: 2,
    targetQueue: "retry",
    targetSequence: 0,
    source: "automation",
    runId: "run-retry-now",
    attempt: 1,
    maxAttempts: 3,
    retryAtMs: retryNowAtMs,
    appliedAtMs: nowMs,
  });

  nowMs = Date.UTC(2026, 1, 23, 12, 26, 0);
  const requeue = await service.runSchedulerQueueAction({
    queue: "dead_letter",
    action: "requeue",
    eventId: "event-dead-letter-requeue",
    reason: "operator_requeue",
  });
  assert.deepEqual(requeue, {
    status: "applied",
    queue: "dead_letter",
    action: "requeue",
    eventId: "event-dead-letter-requeue",
    sequence: 4,
    targetQueue: "retry",
    targetSequence: 1,
    source: "automation",
    runId: "run-dead-letter-requeue",
    attempt: 3,
    maxAttempts: 3,
    retryAtMs: nowMs,
    appliedAtMs: nowMs,
  });

  const retryQueue = await service.listSchedulerEventQueue({
    queue: "retry",
  });
  assert.equal(retryQueue.totalCount, 2);
  const requeuedEntry = retryQueue.items.find(
    (item) => item.eventId === "event-dead-letter-requeue",
  );
  assert.ok(requeuedEntry);
  assert.equal(requeuedEntry.reason, "operator_requeue");

  const deadLetterQueue = await service.listSchedulerEventQueue({
    queue: "dead_letter",
  });
  assert.equal(deadLetterQueue.totalCount, 0);
});

test("control-plane service preserves contract validation errors", async () => {
  const service = createControlPlaneService();

  await assert.rejects(
    async () =>
      service.upsertConfig({
        resourceType: "profile",
        resourceId: "default",
        config: {},
        unexpected: true,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.checkIngressHealth({
        adapter: "sms",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.resolveProfile({
        sessionId: "",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.listHandoffRoutingTelemetry({
        mode: "invalid",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.listUsageTelemetry({
        operation: "invalid",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.listTelemetryAlerts({
        usageFailureRateWarning: 0.7,
        usageFailureRateCritical: 0.5,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.listSchedulerEventQueue({
        queue: "retry",
        status: "failed",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.runSchedulerQueueAction({
        queue: "processed",
        action: "dismiss",
        eventId: "event-invalid",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
