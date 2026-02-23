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

  const gateway = createTelemetryAlertGateway({
    middlewarePipeline,
    usageTelemetryCollector,
    handoffTelemetryCollector,
    now,
  });

  return {
    gateway,
    usageTelemetryCollector,
    auditEvents,
  };
}

test("registerTelemetryAlertContract registers telemetry alert contract once", () => {
  const contractRegistry = createContractRegistry();
  registerTelemetryAlertContract(contractRegistry);
  registerTelemetryAlertContract(contractRegistry);

  assert.deepEqual(contractRegistry.list(), ["runtime.telemetry.alerts.list@1"]);
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
