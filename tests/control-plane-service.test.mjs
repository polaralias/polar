import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import { createControlPlaneService } from "../packages/polar-control-plane/src/index.mjs";

test("control-plane service health reports contract and record counts", async () => {
  const service = createControlPlaneService();

  const initialHealth = service.health();
  assert.deepEqual(initialHealth, {
    status: "ok",
    contractCount: 19,
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
    contractCount: 19,
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
    contractCount: 19,
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
});
