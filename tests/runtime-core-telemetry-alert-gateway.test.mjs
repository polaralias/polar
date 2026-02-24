import test from "node:test";
import assert from "node:assert/strict";

import {
  ContractValidationError,
  RuntimeExecutionError,
} from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createMiddlewarePipeline,
  createTelemetryAlertGateway,
  createUsageTelemetryCollector,
  registerTelemetryAlertContract,
  registerTelemetryAlertRouteContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function createUsageEvent(overrides = {}) {
  return {
    traceId: "trace-usage-1",
    actionId: "provider.generate",
    operation: "generate",
    executionType: "tool",
    requestedProviderId: "provider-primary",
    providerId: "provider-primary",
    attemptedProviderIds: ["provider-primary"],
    fallbackUsed: false,
    status: "completed",
    durationMs: 100,
    model: "model-a",
    modelLane: "worker",
    estimatedCostUsd: 0.1,
    ...overrides,
  };
}

function setupTelemetryAlertGateway({
  handoffListResult,
  now = () => Date.UTC(2026, 1, 23, 18, 0, 0),
  middleware = [],
} = {}) {
  const contractRegistry = createContractRegistry();
  registerTelemetryAlertContract(contractRegistry);
  registerTelemetryAlertRouteContract(contractRegistry);

  const usageTelemetryCollector = createUsageTelemetryCollector({
    now,
  });
  const handoffTelemetryCollector = {
    listEvents() {
      return (
        handoffListResult ?? {
          status: "ok",
          fromSequence: 1,
          returnedCount: 0,
          totalCount: 0,
          items: [],
        }
      );
    },
  };

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const upsertedTasks = [];
  const taskBoardGateway = {
    async upsertTask(request) {
      upsertedTasks.push(request);
      return { status: "created", taskId: request.taskId };
    }
  };

  const gateway = createTelemetryAlertGateway({
    middlewarePipeline,
    usageTelemetryCollector,
    handoffTelemetryCollector,
    taskBoardGateway,
    now,
  });

  return {
    gateway,
    usageTelemetryCollector,
    auditEvents,
    upsertedTasks,
  };
}

test("registerTelemetryAlertContract registers telemetry alert contract once", () => {
  const contractRegistry = createContractRegistry();
  registerTelemetryAlertContract(contractRegistry);
  registerTelemetryAlertContract(contractRegistry);

  assert.deepEqual(contractRegistry.list(), ["runtime.telemetry.alerts.list@1"]);
});

test("registerTelemetryAlertRouteContract registers route contract once", () => {
  const contractRegistry = createContractRegistry();
  registerTelemetryAlertRouteContract(contractRegistry);
  registerTelemetryAlertRouteContract(contractRegistry);

  assert.deepEqual(contractRegistry.list(), ["runtime.telemetry.alerts.route@1"]);
});

test("telemetry alert gateway synthesizes usage and handoff alerts through middleware", async () => {
  const middlewareEvents = [];
  const { gateway, usageTelemetryCollector, auditEvents } = setupTelemetryAlertGateway({
    handoffListResult: {
      status: "ok",
      fromSequence: 1,
      returnedCount: 6,
      totalCount: 6,
      items: [
        { status: "completed", routeAdjusted: true },
        { status: "failed", routeAdjusted: true },
        { status: "failed", routeAdjusted: true },
        { status: "completed", routeAdjusted: true },
        { status: "completed", routeAdjusted: true },
        { status: "completed", routeAdjusted: false },
      ],
    },
    middleware: [
      {
        id: "capture-alert-list",
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

  await usageTelemetryCollector.recordOperation(
    createUsageEvent({
      status: "failed",
      fallbackUsed: true,
      durationMs: 4_000,
      traceId: "trace-usage-a",
      errorCode: "POLAR_RUNTIME_EXECUTION_ERROR",
    }),
  );
  await usageTelemetryCollector.recordOperation(
    createUsageEvent({
      status: "failed",
      fallbackUsed: true,
      durationMs: 4_200,
      traceId: "trace-usage-b",
      errorCode: "POLAR_RUNTIME_EXECUTION_ERROR",
    }),
  );
  await usageTelemetryCollector.recordOperation(
    createUsageEvent({
      status: "failed",
      fallbackUsed: true,
      durationMs: 3_900,
      traceId: "trace-usage-c",
      errorCode: "POLAR_RUNTIME_EXECUTION_ERROR",
    }),
  );
  await usageTelemetryCollector.recordOperation(
    createUsageEvent({
      status: "completed",
      fallbackUsed: true,
      durationMs: 3_800,
      traceId: "trace-usage-d",
    }),
  );
  await usageTelemetryCollector.recordOperation(
    createUsageEvent({
      status: "completed",
      fallbackUsed: false,
      durationMs: 3_600,
      traceId: "trace-usage-e",
    }),
  );
  await usageTelemetryCollector.recordOperation(
    createUsageEvent({
      status: "completed",
      fallbackUsed: false,
      durationMs: 3_500,
      traceId: "trace-usage-f",
    }),
  );

  const listed = await gateway.listAlerts({
    traceId: "trace-telemetry-alerts-1",
    minimumSampleSize: 5,
    usageFailureRateWarning: 0.2,
    usageFailureRateCritical: 0.4,
    usageFallbackRateWarning: 0.3,
    usageFallbackRateCritical: 0.5,
    usageAverageDurationMsWarning: 3_000,
    usageAverageDurationMsCritical: 5_000,
    handoffFailureRateWarning: 0.2,
    handoffFailureRateCritical: 0.3,
    handoffRouteAdjustedRateWarning: 0.5,
    handoffRouteAdjustedRateCritical: 0.8,
  });

  assert.equal(listed.status, "ok");
  assert.equal(listed.scope, "all");
  assert.equal(listed.alertCount, 5);
  assert.deepEqual(
    listed.alerts.map((item) => item.code).sort(),
    [
      "HANDOFF_FAILURE_RATE_HIGH",
      "HANDOFF_ROUTE_ADJUSTED_RATE_HIGH",
      "USAGE_AVERAGE_DURATION_HIGH",
      "USAGE_FAILURE_RATE_HIGH",
      "USAGE_FALLBACK_RATE_HIGH",
    ],
  );
  assert.equal(listed.usageWindow.totalOperations, 6);
  assert.equal(listed.handoffWindow.evaluatedCount, 6);
  assert.deepEqual(middlewareEvents, [
    "before:runtime.telemetry.alerts.list",
    "after:ok",
  ]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "runtime.telemetry.alerts.list" &&
        event.traceId === "trace-telemetry-alerts-1",
    ),
  );
});

test("telemetry alert gateway honors scope and minimum sample gating", async () => {
  const { gateway, usageTelemetryCollector } = setupTelemetryAlertGateway({
    handoffListResult: {
      status: "ok",
      fromSequence: 1,
      returnedCount: 10,
      totalCount: 10,
      items: [
        { status: "failed", routeAdjusted: true },
        { status: "completed", routeAdjusted: true },
      ],
    },
  });

  await usageTelemetryCollector.recordOperation(
    createUsageEvent({
      status: "failed",
      fallbackUsed: true,
      durationMs: 10_000,
    }),
  );

  const usageOnly = await gateway.listAlerts({
    scope: "usage",
    minimumSampleSize: 2,
  });
  assert.deepEqual(usageOnly, {
    status: "ok",
    evaluatedAtMs: Date.UTC(2026, 1, 23, 18, 0, 0),
    scope: "usage",
    minimumSampleSize: 2,
    alertCount: 0,
    alerts: [],
    usageWindow: {
      totalOperations: 1,
      failedCount: 1,
      fallbackCount: 1,
      totalDurationMs: 10_000,
      averageDurationMs: 10_000,
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
});

test("telemetry alert gateway rejects invalid request shapes and threshold pairs", async () => {
  const { gateway } = setupTelemetryAlertGateway();

  await assert.rejects(
    async () =>
      gateway.listAlerts({
        scope: "invalid",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      gateway.listAlerts({
        usageFailureRateWarning: 0.6,
        usageFailureRateCritical: 0.4,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("telemetry alert gateway constructor validates collector shape", () => {
  const contractRegistry = createContractRegistry();
  registerTelemetryAlertContract(contractRegistry);
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
  });

  assert.throws(
    () =>
      createTelemetryAlertGateway({
        middlewarePipeline,
        usageTelemetryCollector: /** @type {unknown} */ ({ listEvents: 1 }),
        handoffTelemetryCollector: {
          listEvents() {
            return {
              status: "ok",
              fromSequence: 1,
              returnedCount: 0,
              totalCount: 0,
              items: [],
            };
          },
        },
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR",
  );
});

test("telemetry alert gateway routes synthesized alerts into tasks", async () => {
  const { gateway, usageTelemetryCollector, upsertedTasks } = setupTelemetryAlertGateway({
    handoffListResult: {
      status: "ok",
      fromSequence: 1,
      returnedCount: 5,
      totalCount: 5,
      items: [
        { status: "failed", routeAdjusted: true },
        { status: "failed", routeAdjusted: true },
        { status: "completed", routeAdjusted: true },
        { status: "completed", routeAdjusted: true },
        { status: "completed", routeAdjusted: true },
      ],
    },
  });

  await usageTelemetryCollector.recordOperation(createUsageEvent({ status: "failed", durationMs: 10_000, traceId: "x-1" }));
  await usageTelemetryCollector.recordOperation(createUsageEvent({ status: "failed", durationMs: 10_000, traceId: "x-2" }));
  await usageTelemetryCollector.recordOperation(createUsageEvent({ status: "completed", durationMs: 10_000, traceId: "x-3" }));
  await usageTelemetryCollector.recordOperation(createUsageEvent({ status: "completed", durationMs: 10_000, traceId: "x-4" }));
  await usageTelemetryCollector.recordOperation(createUsageEvent({ status: "completed", durationMs: 10_000, traceId: "x-5" }));

  // 1 usage rate error (0.4), 1 usage duration error (10s), 1 handoff error (0.4), 1 handoff adjustment error (1.0). Total 4 alerts.

  const routed = await gateway.routeAlerts({
    assigneeType: "user",
    assigneeId: "operator-1",
    minimumSeverity: "warning",
    dryRun: false,
    taskIdPrefix: "triage",
    usageFailureRateWarning: 0.2,
    usageAverageDurationMsWarning: 3_000,
  });

  assert.equal(routed.status, "ok");
  assert.equal(routed.routedCount, 4);
  assert.equal(upsertedTasks.length, 4);
  assert.match(upsertedTasks[0].taskId, /^triage-/);
  assert.equal(upsertedTasks[0].assigneeId, "operator-1");
  assert.match(upsertedTasks[0].description, /Automatically routed telemetry alert/);
});

test("telemetry alert gateway honors minimum severity when routing", async () => {
  const { gateway, usageTelemetryCollector, upsertedTasks } = setupTelemetryAlertGateway({
    handoffListResult: {
      status: "ok",
      fromSequence: 1,
      returnedCount: 5,
      totalCount: 5,
      items: [
        { status: "completed", routeAdjusted: false },
        { status: "completed", routeAdjusted: false },
        { status: "completed", routeAdjusted: false },
        { status: "completed", routeAdjusted: false },
        { status: "completed", routeAdjusted: false },
      ],
    },
  });

  await usageTelemetryCollector.recordOperation(createUsageEvent({ status: "failed", durationMs: 500 }));
  await usageTelemetryCollector.recordOperation(createUsageEvent({ status: "completed", durationMs: 500 }));
  await usageTelemetryCollector.recordOperation(createUsageEvent({ status: "completed", durationMs: 500 }));
  await usageTelemetryCollector.recordOperation(createUsageEvent({ status: "completed", durationMs: 500 }));
  await usageTelemetryCollector.recordOperation(createUsageEvent({ status: "completed", durationMs: 500 }));

  // usage failure is 0.2 (1/5).
  // critical threshold 0.35, warning threshold 0.15. So it's "warning" severity.

  const warningRoute = await gateway.routeAlerts({
    assigneeType: "user",
    assigneeId: "operator-1",
    minimumSeverity: "warning",
    dryRun: true,
  });
  assert.equal(warningRoute.previewCount, 1);
  assert.equal(upsertedTasks.length, 0);

  const criticalRoute = await gateway.routeAlerts({
    assigneeType: "user",
    assigneeId: "operator-1",
    minimumSeverity: "critical",
    dryRun: false,
  });
  assert.equal(criticalRoute.routedCount, 0);
  assert.equal(criticalRoute.skippedCount, 1);
  assert.equal(upsertedTasks.length, 0);
});
