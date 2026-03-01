import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import { createControlPlaneService } from "../packages/polar-control-plane/src/index.mjs";
import {
  createSqliteAutomationJobStore,
  createSqliteFeedbackEventStore,
  createSqlitePersonalityStore,
  createSqliteRunEventLinker,
} from "../packages/polar-runtime-core/src/index.mjs";

test("control-plane service health reports contract and record counts", async () => {
  const service = createControlPlaneService();

  assert.deepEqual(await service.health(), {
    status: "ok",
    contractCount: 45,
    recordCount: 0,
    sessionCount: 0,
    taskCount: 0,
    taskEventCount: 0,
    taskReplayKeyCount: 0,
    handoffRoutingTelemetryCount: 0,
    usageTelemetryCount: 0,
    extensionCount: 0,
    vaultStatus: { isEphemeral: true, algorithm: "aes-256-gcm" },
  });

  await service.upsertConfig({
    resourceType: "profile",
    resourceId: "default",
    config: {
      modelLane: "worker",
    },
  });

  assert.deepEqual(await service.health(), {
    status: "ok",
    contractCount: 45,
    recordCount: 1,
    sessionCount: 0,
    taskCount: 0,
    taskEventCount: 0,
    taskReplayKeyCount: 0,
    handoffRoutingTelemetryCount: 0,
    usageTelemetryCount: 0,
    extensionCount: 0,
    vaultStatus: { isEphemeral: true, algorithm: "aes-256-gcm" },
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

test("control-plane keeps Telegram reply turns in one session and preserves threadId metadata", async () => {
  const service = createControlPlaneService();
  const baseTs = Date.UTC(2026, 1, 22, 12, 30, 0);

  const firstEnvelope = await service.normalizeIngress({
    adapter: "telegram",
    payload: {
      chatId: "chat-42",
      fromId: "user-7",
      messageId: "m-1",
      text: "first turn",
      timestampMs: baseTs,
    },
  });
  assert.equal(firstEnvelope.sessionId, "telegram:chat:chat-42");
  assert.equal(firstEnvelope.threadId, undefined);

  const firstAppend = await service.appendMessage({
    sessionId: firstEnvelope.sessionId,
    userId: firstEnvelope.userId,
    messageId: firstEnvelope.messageId,
    role: "user",
    text: firstEnvelope.messageText,
    timestampMs: firstEnvelope.timestampMs,
    metadata: firstEnvelope.metadata,
  });
  assert.deepEqual(firstAppend, {
    status: "appended",
    sessionId: "telegram:chat:chat-42",
    messageId: "telegram:chat-42:m-1",
    messageCount: 1,
  });

  const replyEnvelope = await service.normalizeIngress({
    adapter: "telegram",
    payload: {
      chatId: "chat-42",
      fromId: "user-7",
      messageId: "m-2",
      replyToMessageId: "m-1",
      text: "follow up",
      timestampMs: baseTs + 1_000,
    },
  });
  assert.equal(replyEnvelope.sessionId, "telegram:chat:chat-42");
  assert.equal(replyEnvelope.threadId, "telegram:reply:chat-42:m-1");
  assert.equal(replyEnvelope.metadata.replyToMessageId, "m-1");

  const replyAppend = await service.appendMessage({
    sessionId: replyEnvelope.sessionId,
    userId: replyEnvelope.userId,
    messageId: replyEnvelope.messageId,
    role: "user",
    text: replyEnvelope.messageText,
    timestampMs: replyEnvelope.timestampMs,
    threadId: replyEnvelope.threadId,
    metadata: replyEnvelope.metadata,
  });
  assert.deepEqual(replyAppend, {
    status: "appended",
    sessionId: "telegram:chat:chat-42",
    messageId: "telegram:chat-42:m-2",
    messageCount: 2,
  });

  const sessions = await service.listSessions({
    channel: "telegram",
  });
  assert.deepEqual(sessions, {
    status: "ok",
    items: [
      {
        sessionId: "telegram:chat:chat-42",
        userId: "telegram:user:user-7",
        channel: "telegram",
        tags: [],
        archived: false,
        messageCount: 2,
        lastMessageAtMs: baseTs + 1_000,
        updatedAtMs: baseTs + 1_000,
      },
    ],
    totalCount: 1,
  });

  const history = await service.getSessionHistory({
    sessionId: "telegram:chat:chat-42",
  });
  assert.deepEqual(history, {
    status: "ok",
    sessionId: "telegram:chat:chat-42",
    items: [
      {
        messageId: "telegram:chat-42:m-1",
        userId: "telegram:user:user-7",
        role: "user",
        text: "first turn",
        timestampMs: baseTs,
        metadata: {
          source: "telegram",
          chatId: "chat-42",
          fromId: "user-7",
        },
      },
      {
        messageId: "telegram:chat-42:m-2",
        userId: "telegram:user:user-7",
        role: "user",
        text: "follow up",
        timestampMs: baseTs + 1_000,
        threadId: "telegram:reply:chat-42:m-1",
        metadata: {
          source: "telegram",
          chatId: "chat-42",
          fromId: "user-7",
          replyToMessageId: "m-1",
        },
      },
    ],
    totalCount: 2,
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

  assert.deepEqual(await service.health(), {
    status: "ok",
    contractCount: 45,
    recordCount: 0,
    sessionCount: 0,
    taskCount: 2,
    taskEventCount: 4,
    taskReplayKeyCount: 1,
    handoffRoutingTelemetryCount: 0,
    usageTelemetryCount: 0,
    extensionCount: 0,
    vaultStatus: { isEphemeral: true, algorithm: "aes-256-gcm" },
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

test("control-plane service records and lists feedback events", async () => {
  const db = new Database(":memory:");
  try {
    let nowMs = Date.UTC(2026, 1, 24, 12, 0, 0);
    const feedbackEventStore = createSqliteFeedbackEventStore({
      db,
      now: () => nowMs,
    });
    const service = createControlPlaneService({
      feedbackEventStore,
    });

    const recorded = await service.recordFeedbackEvent({
      type: "reaction_added",
      sessionId: "telegram:chat:200",
      messageId: "msg_a_200",
      emoji: "🔥",
      polarity: "positive",
      payload: {
        telegramMessageId: 200,
        targetMessageText: "Nice plan",
        timestampMs: nowMs,
      },
    });
    assert.equal(recorded.status, "recorded");
    assert.equal(recorded.type, "reaction_added");
    assert.equal(recorded.sessionId, "telegram:chat:200");

    nowMs += 1_000;
    await service.recordFeedbackEvent({
      type: "reaction_added",
      sessionId: "telegram:chat:200",
      messageId: "msg_a_201",
      emoji: "👎",
      polarity: "negative",
      payload: {
        telegramMessageId: 201,
        targetMessageText: "Wrong direction",
        timestampMs: nowMs,
      },
    });

    const listed = await service.listFeedbackEvents({
      sessionId: "telegram:chat:200",
      limit: 10,
    });
    assert.deepEqual(listed, {
      status: "ok",
      items: [
        {
          id: listed.items[0].id,
          type: "reaction_added",
          sessionId: "telegram:chat:200",
          messageId: "msg_a_201",
          emoji: "👎",
          polarity: "negative",
          payload: {
            telegramMessageId: 201,
            targetMessageText: "Wrong direction",
            timestampMs: nowMs,
          },
          createdAtMs: nowMs,
        },
        {
          id: listed.items[1].id,
          type: "reaction_added",
          sessionId: "telegram:chat:200",
          messageId: "msg_a_200",
          emoji: "🔥",
          polarity: "positive",
          payload: {
            telegramMessageId: 200,
            targetMessageText: "Nice plan",
            timestampMs: Date.UTC(2026, 1, 24, 12, 0, 0),
          },
          createdAtMs: Date.UTC(2026, 1, 24, 12, 0, 0),
        },
      ],
      totalCount: 2,
    });
    assert.equal(typeof listed.items[0].id, "string");
    assert.equal(typeof listed.items[1].id, "string");
  } finally {
    db.close();
  }
});

test("control-plane service lists automation and heartbeat run ledger entries", async () => {
  const db = new Database(":memory:");
  try {
    const runEventLinker = createSqliteRunEventLinker({
      db,
      now: () => Date.UTC(2026, 1, 25, 11, 0, 0),
    });
    await runEventLinker.recordAutomationRun({
      automationId: "auto.daily",
      runId: "run-a-1",
      profileId: "profile-default",
      trigger: "schedule",
      output: {
        status: "executed",
      },
    });
    await runEventLinker.recordHeartbeatRun({
      policyId: "policy.daily",
      runId: "run-h-1",
      profileId: "profile-default",
      trigger: "schedule",
      output: {
        status: "executed",
      },
    });

    const service = createControlPlaneService({
      runEventLinker,
    });
    const automationLedger = service.listAutomationRunLedger({
      fromSequence: 0,
      limit: 10,
    });
    assert.equal(automationLedger.status, "ok");
    assert.equal(automationLedger.totalCount, 1);
    assert.equal(automationLedger.items[0].automationId, "auto.daily");
    assert.equal(automationLedger.items[0].runId, "run-a-1");

    const heartbeatLedger = service.listHeartbeatRunLedger({
      fromSequence: 0,
      limit: 10,
    });
    assert.equal(heartbeatLedger.status, "ok");
    assert.equal(heartbeatLedger.totalCount, 1);
    assert.equal(heartbeatLedger.items[0].policyId, "policy.daily");
    assert.equal(heartbeatLedger.items[0].runId, "run-h-1");
  } finally {
    db.close();
  }
});

test("control-plane service manages automation jobs via sqlite store", async () => {
  const db = new Database(":memory:");
  try {
    let nowMs = Date.UTC(2026, 1, 25, 12, 0, 0);
    const automationJobStore = createSqliteAutomationJobStore({
      db,
      now: () => nowMs,
    });
    const service = createControlPlaneService({
      automationJobStore,
    });

    const created = await service.createAutomationJob({
      id: "job-1",
      ownerUserId: "user-1",
      sessionId: "telegram:chat:1",
      schedule: "every 1 hours",
      promptTemplate: "Reminder: hydrate",
    });
    assert.equal(created.status, "created");
    assert.equal(created.job.enabled, true);

    const listed = await service.listAutomationJobs({
      ownerUserId: "user-1",
      enabled: true,
    });
    assert.equal(listed.status, "ok");
    assert.equal(listed.totalCount, 1);
    assert.equal(listed.items[0].id, "job-1");

    nowMs += 1_000;
    const updated = await service.updateAutomationJob({
      id: "job-1",
      promptTemplate: "Reminder: stretch",
      limits: {
        maxNotificationsPerDay: 1,
      },
    });
    assert.equal(updated.status, "updated");
    assert.equal(updated.job.promptTemplate, "Reminder: stretch");
    assert.equal(updated.job.limits.maxNotificationsPerDay, 1);

    nowMs += 1_000;
    const disabled = await service.disableAutomationJob({
      id: "job-1",
    });
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.job.enabled, false);

    const enabled = await service.enableAutomationJob({
      id: "job-1",
    });
    assert.equal(enabled.status, "updated");
    assert.equal(enabled.job.enabled, true);

    const fetched = await service.getAutomationJob({
      id: "job-1",
    });
    assert.equal(fetched.status, "found");
    assert.equal(fetched.job.id, "job-1");

    const preview = await service.previewAutomationJob({
      schedule: "daily 09:15",
      promptTemplate: "Reminder: hydrate",
    });
    assert.equal(preview.status, "ok");
    assert.equal(preview.preview.schedule, "daily at 09:15");

    const deleted = await service.deleteAutomationJob({
      id: "job-1",
    });
    assert.equal(deleted.status, "deleted");
  } finally {
    db.close();
  }
});

test("control-plane service exports and shows artifacts through runtime-core exporter", async () => {
  const db = new Database(":memory:");
  try {
    const service = createControlPlaneService({
      runEventDb: db,
    });
    const exported = await service.exportArtifacts({});
    assert.equal(exported.status, "exported");
    assert.equal(exported.files.length, 4);

    const shown = await service.showArtifacts({});
    assert.equal(shown.status, "ok");
    assert.equal(shown.totalCount, 4);
  } finally {
    db.close();
  }
});

test("control-plane service can run an automation job manually through orchestrate and ledger", async () => {
  const db = new Database(":memory:");
  try {
    const automationJobStore = createSqliteAutomationJobStore({
      db,
      now: () => Date.UTC(2026, 2, 1, 10, 0, 0),
    });
    await automationJobStore.createJob({
      id: "job-manual-1",
      ownerUserId: "user-1",
      sessionId: "telegram:chat:1",
      schedule: "every 1 hours",
      promptTemplate: "Manual reminder",
    });

    const service = createControlPlaneService({
      automationJobStore,
      runEventDb: db,
      personalityStore: createSqlitePersonalityStore({ db }),
      resolveProvider: async () => ({
        async generate() {
          return {
            providerId: "openai",
            model: "gpt-4.1-mini",
            text: "manual run completed",
          };
        },
        async stream() {
          return { chunks: [] };
        },
        async embed() {
          return { vector: [0.1, 0.2] };
        },
        async listModels() {
          return { providerId: "openai", models: ["gpt-4.1-mini"] };
        },
      }),
    });

    const result = await service.runAutomationJob({
      id: "job-manual-1",
      userId: "user-1",
      sessionId: "telegram:chat:1",
    });
    assert.equal(result.status, "completed");
    assert.equal(typeof result.runId, "string");

    const ledger = service.listAutomationRunLedger({});
    assert.equal(ledger.status, "ok");
    assert.equal(ledger.totalCount, 1);
    assert.equal(ledger.items[0].automationId, "job-manual-1");
    assert.equal(ledger.items[0].trigger, "manual");
  } finally {
    db.close();
  }
});

test("control-plane service exposes proactive inbox dry run and body-read gating", async () => {
  const service = createControlPlaneService({
    inboxConnector: {
      async searchHeaders() {
        return [
          {
            messageId: "mail-1",
            subject: "Build failure",
            from: "alerts@example.com",
            senderDomain: "example.com",
          },
          {
            messageId: "mail-2",
            subject: "Daily digest",
            from: "news@example.org",
            senderDomain: "example.org",
          },
        ];
      },
    },
  });

  const dryRun = await service.proactiveInboxDryRun({
    sessionId: "telegram:chat:1",
    userId: "user-1",
    maxNotificationsPerDay: 1,
    capabilities: ["mail.search_headers"],
  });
  assert.equal(dryRun.status, "completed");
  assert.equal(dryRun.mode, "headers_only");
  assert.equal(dryRun.scannedHeaderCount, 2);
  assert.equal(dryRun.wouldTriggerCount, 1);
  assert.equal(dryRun.wouldTrigger.length, 1);
  assert.equal(dryRun.wouldTrigger[0].messageId, "mail-1");

  const blockedBodyRead = await service.proactiveInboxReadBody({
    sessionId: "telegram:chat:1",
    userId: "user-1",
    messageId: "mail-1",
    capabilities: ["mail.search_headers"],
  });
  assert.equal(blockedBodyRead.status, "blocked");
  assert.equal(
    blockedBodyRead.blockedReason,
    "capability_mail.read_body_requires_explicit_permission",
  );
});

test("control-plane service manages personality profiles with strict scope validation", async () => {
  const db = new Database(":memory:");
  try {
    const personalityStore = createSqlitePersonalityStore({ db });
    const service = createControlPlaneService({ personalityStore });

    const global = await service.upsertPersonalityProfile({
      scope: "global",
      prompt: "Global style",
    });
    assert.equal(global.status, "upserted");
    assert.equal(global.profile.scope, "global");

    const user = await service.upsertPersonalityProfile({
      scope: "user",
      userId: "user-1",
      prompt: "User style",
    });
    assert.equal(user.profile.scope, "user");

    const session = await service.upsertPersonalityProfile({
      scope: "session",
      userId: "user-1",
      sessionId: "session-1",
      prompt: "Session style",
    });
    assert.equal(session.profile.scope, "session");

    const effective = await service.getEffectivePersonality({
      userId: "user-1",
      sessionId: "session-1",
    });
    assert.equal(effective.status, "found");
    assert.equal(effective.profile.scope, "session");

    const listed = await service.listPersonalityProfiles({
      scope: "user",
      userId: "user-1",
    });
    assert.equal(listed.status, "ok");
    assert.equal(listed.totalCount, 1);
    assert.equal(listed.items[0].scope, "user");

    const reset = await service.resetPersonalityProfile({
      scope: "session",
      userId: "user-1",
      sessionId: "session-1",
    });
    assert.equal(reset.status, "reset");
    assert.equal(reset.deleted, true);
  } finally {
    db.close();
  }
});

test("control-plane service stores model registry and applies default model policy to global routing profile", async () => {
  const service = createControlPlaneService();

  const upserted = await service.upsertModelRegistry({
    registry: {
      version: 1,
      entries: [{ provider: "openai", modelId: "gpt-5-mini", alias: "fast" }],
      defaults: null,
    },
  });
  assert.equal(upserted.status, "applied");
  assert.equal(upserted.registry.entries.length, 1);

  const listed = await service.getModelRegistry({});
  assert.equal(listed.status, "ok");
  assert.equal(listed.registry.entries[0].provider, "openai");
  assert.equal(listed.registry.entries[0].alias, "fast");

  const appliedDefault = await service.setModelRegistryDefault({
    providerId: "openai",
    modelId: "gpt-5-mini",
  });
  assert.equal(appliedDefault.status, "applied");

  const pinned = await service.getConfig({
    resourceType: "policy",
    resourceId: "profile-pin:global",
  });
  assert.equal(pinned.status, "found");
  assert.equal(pinned.config.profileId, "profile.global");

  const profile = await service.getConfig({
    resourceType: "profile",
    resourceId: "profile.global",
  });
  assert.equal(profile.status, "found");
  assert.deepEqual(profile.config.modelPolicy, {
    providerId: "openai",
    modelId: "gpt-5-mini",
  });
});

test("control-plane service manages agent registry and profile pin helpers", async () => {
  const service = createControlPlaneService();

  await service.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.writer",
    config: {
      systemPrompt: "writer profile",
      modelPolicy: { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
      allowedSkills: ["web"],
    },
  });

  const registered = await service.registerAgentProfile({
    agentId: "@writer",
    profileId: "profile.writer",
    description: "Writes polished docs",
    allowedForwardSkills: ["web"],
    tags: ["writing"],
  });
  assert.equal(registered.status, "applied");
  assert.equal(registered.agent.agentId, "@writer");

  const listed = await service.listAgentProfiles();
  assert.equal(listed.status, "ok");
  assert.equal(listed.totalCount, 1);
  assert.equal(listed.items[0].profileId, "profile.writer");

  const got = await service.getAgentProfile({ agentId: "@writer" });
  assert.equal(got.status, "found");
  assert.equal(got.agent.description, "Writes polished docs");

  const pinned = await service.pinProfileForScope({
    scope: "session",
    sessionId: "session-99",
    profileId: "profile.writer",
  });
  assert.equal(pinned.status, "applied");
  assert.equal(pinned.pinResourceId, "profile-pin:session:session-99");

  const effective = await service.getEffectivePinnedProfile({
    sessionId: "session-99",
    userId: "user-99",
  });
  assert.equal(effective.status, "found");
  assert.equal(effective.profileId, "profile.writer");
  assert.equal(effective.scope, "session");

  const unpinned = await service.unpinProfileForScope({
    scope: "session",
    sessionId: "session-99",
  });
  assert.equal(unpinned.status, "applied");

  const afterUnpin = await service.getEffectivePinnedProfile({
    sessionId: "session-99",
    userId: "user-99",
  });
  assert.equal(afterUnpin.status, "not_found");
});

test("control-plane agent registry validation rejects invalid records", async () => {
  const service = createControlPlaneService();

  await assert.rejects(
    async () =>
      service.registerAgentProfile({
        agentId: "writer",
        profileId: "profile.writer",
        description: "bad id",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await service.upsertConfig({
    resourceType: "policy",
    resourceId: "agent-registry:default",
    config: {
      agents: [],
    },
  });
  await assert.rejects(
    async () => service.getAgentRegistry({}),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await service.upsertConfig({
    resourceType: "policy",
    resourceId: "agent-registry:default",
    config: {
      version: 1,
      agents: [{ agentId: "@writer", description: "missing profile" }],
    },
  });
  await assert.rejects(
    async () => service.getAgentRegistry({}),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await service.upsertConfig({
    resourceType: "policy",
    resourceId: "agent-registry:default",
    config: {
      version: 1,
      agents: [{ agentId: "@writer", profileId: "", description: "missing profile" }],
    },
  });
  await assert.rejects(
    async () => service.getAgentRegistry({}),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
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

  await assert.rejects(
    async () =>
      service.recordFeedbackEvent({
        type: "reaction_added",
        sessionId: "telegram:chat:1",
        unexpected: true,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.listFeedbackEvents({
        limit: 0,
      }),
    (error) =>
        error instanceof ContractValidationError &&
        error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.createAutomationJob({
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
      service.updateAutomationJob({
        id: "job-1",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.proactiveInboxCheckHeaders({
        sessionId: "telegram:chat:1",
        userId: "user-1",
        lookbackHours: 0,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.upsertPersonalityProfile({
        scope: "user",
        prompt: "missing user id",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      service.getEffectivePersonality({
        userId: "user-1",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  assert.throws(
    () =>
      service.listAutomationRunLedger({
        limit: 0,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  assert.throws(
    () =>
      service.listHeartbeatRunLedger({
        unexpected: true,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
