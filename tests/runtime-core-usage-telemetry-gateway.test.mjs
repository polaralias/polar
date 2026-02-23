import test from "node:test";
import assert from "node:assert/strict";

import {
  ContractValidationError,
  RuntimeExecutionError,
} from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createMiddlewarePipeline,
  createProviderGateway,
  createUsageTelemetryCollector,
  createUsageTelemetryGateway,
  registerProviderOperationContracts,
  registerUsageTelemetryContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function createProvider(id, overrides = {}) {
  return Object.freeze({
    async generate(input) {
      return {
        providerId: input.providerId,
        model: input.model,
        text: `${id}:${input.prompt}`,
      };
    },
    async stream(input) {
      return {
        providerId: input.providerId,
        model: input.model,
        chunks: Object.freeze([`${id}:chunk:${input.prompt}`]),
      };
    },
    async embed(input) {
      return {
        providerId: input.providerId,
        model: input.model,
        vector: Object.freeze([input.text.length, 1]),
      };
    },
    ...overrides,
  });
}

function setupUsageTelemetryRuntime({
  middleware = [],
  providers,
  now = () => Date.UTC(2026, 1, 23, 15, 0, 0),
  telemetrySink,
} = {}) {
  const contractRegistry = createContractRegistry();
  registerProviderOperationContracts(contractRegistry);
  registerUsageTelemetryContract(contractRegistry);

  const usageTelemetryCollector = createUsageTelemetryCollector({
    now,
    telemetrySink,
  });

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const providerGateway = createProviderGateway({
    middlewarePipeline,
    providers,
    usageTelemetryCollector,
    now,
  });
  const usageTelemetryGateway = createUsageTelemetryGateway({
    middlewarePipeline,
    telemetryCollector: usageTelemetryCollector,
  });

  return {
    providerGateway,
    usageTelemetryGateway,
    usageTelemetryCollector,
    auditEvents,
  };
}

test("registerUsageTelemetryContract registers telemetry contract once", () => {
  const contractRegistry = createContractRegistry();
  registerUsageTelemetryContract(contractRegistry);
  registerUsageTelemetryContract(contractRegistry);

  assert.deepEqual(contractRegistry.list(), ["runtime.usage-telemetry.list@1"]);
});

test("usage telemetry gateway lists provider usage with fallback and summary metrics", async () => {
  const nowMs = Date.UTC(2026, 1, 23, 15, 0, 0);
  const middlewareEvents = [];
  const { providerGateway, usageTelemetryGateway, auditEvents } =
    setupUsageTelemetryRuntime({
      now: () => nowMs,
      providers: {
        primary: createProvider("primary", {
          async generate() {
            throw new Error("primary generate down");
          },
          async stream() {
            throw new Error("primary stream down");
          },
        }),
        secondary: createProvider("secondary"),
      },
      middleware: [
        {
          id: "capture-usage-telemetry-list",
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

  await providerGateway.generate({
    executionType: "tool",
    traceId: "trace-usage-1",
    providerId: "primary",
    fallbackProviderIds: ["secondary"],
    model: "model-generate",
    modelLane: "worker",
    estimatedCostUsd: 1,
    prompt: "hello",
  });

  await providerGateway.embed({
    executionType: "tool",
    traceId: "trace-usage-2",
    providerId: "secondary",
    model: "model-embed",
    modelLane: "local",
    estimatedCostUsd: 2,
    text: "abc",
  });

  await assert.rejects(
    async () =>
      providerGateway.stream({
        executionType: "tool",
        traceId: "trace-usage-3",
        providerId: "primary",
        model: "model-stream",
        modelLane: "brain",
        estimatedCostUsd: 3,
        prompt: "fail",
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR",
  );

  const listed = await usageTelemetryGateway.listUsageTelemetry({
    traceId: "trace-usage-list-1",
    limit: 10,
  });

  assert.deepEqual(listed, {
    status: "ok",
    fromSequence: 1,
    returnedCount: 3,
    totalCount: 3,
    items: [
      {
        sequence: 1,
        timestamp: new Date(nowMs).toISOString(),
        timestampMs: nowMs,
        traceId: "trace-usage-1",
        actionId: "provider.generate",
        operation: "generate",
        executionType: "tool",
        requestedProviderId: "primary",
        providerId: "secondary",
        attemptedProviderIds: ["primary", "secondary"],
        fallbackProviderIds: ["secondary"],
        fallbackUsed: true,
        status: "completed",
        durationMs: 0,
        model: "model-generate",
        modelLane: "worker",
        estimatedCostUsd: 1,
      },
      {
        sequence: 2,
        timestamp: new Date(nowMs).toISOString(),
        timestampMs: nowMs,
        traceId: "trace-usage-2",
        actionId: "provider.embed",
        operation: "embed",
        executionType: "tool",
        requestedProviderId: "secondary",
        providerId: "secondary",
        attemptedProviderIds: ["secondary"],
        fallbackUsed: false,
        status: "completed",
        durationMs: 0,
        model: "model-embed",
        modelLane: "local",
        estimatedCostUsd: 2,
      },
      {
        sequence: 3,
        timestamp: new Date(nowMs).toISOString(),
        timestampMs: nowMs,
        traceId: "trace-usage-3",
        actionId: "provider.stream",
        operation: "stream",
        executionType: "tool",
        requestedProviderId: "primary",
        providerId: "primary",
        attemptedProviderIds: ["primary"],
        fallbackUsed: false,
        status: "failed",
        durationMs: 0,
        model: "model-stream",
        modelLane: "brain",
        estimatedCostUsd: 3,
        errorCode: "POLAR_RUNTIME_EXECUTION_ERROR",
      },
    ],
    summary: {
      totalOperations: 3,
      completedCount: 2,
      failedCount: 1,
      fallbackCount: 1,
      totalDurationMs: 0,
      totalEstimatedCostUsd: 6,
      byOperation: [
        {
          operation: "generate",
          totalCount: 1,
          failedCount: 0,
          fallbackCount: 1,
          totalEstimatedCostUsd: 1,
        },
        {
          operation: "stream",
          totalCount: 1,
          failedCount: 1,
          fallbackCount: 0,
          totalEstimatedCostUsd: 3,
        },
        {
          operation: "embed",
          totalCount: 1,
          failedCount: 0,
          fallbackCount: 0,
          totalEstimatedCostUsd: 2,
        },
      ],
      byProvider: [
        {
          providerId: "primary",
          totalCount: 1,
          failedCount: 1,
          fallbackCount: 0,
          totalEstimatedCostUsd: 3,
        },
        {
          providerId: "secondary",
          totalCount: 2,
          failedCount: 0,
          fallbackCount: 1,
          totalEstimatedCostUsd: 3,
        },
      ],
      byModelLane: [
        {
          modelLane: "local",
          totalCount: 1,
          totalEstimatedCostUsd: 2,
        },
        {
          modelLane: "worker",
          totalCount: 1,
          totalEstimatedCostUsd: 1,
        },
        {
          modelLane: "brain",
          totalCount: 1,
          totalEstimatedCostUsd: 3,
        },
      ],
    },
  });

  assert.deepEqual(middlewareEvents, [
    "before:runtime.usage-telemetry.list",
    "after:ok",
  ]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "runtime.usage-telemetry.list" &&
        event.traceId === "trace-usage-list-1",
    ),
  );
});

test("usage telemetry gateway supports filtering and preserves request validation", async () => {
  const { providerGateway, usageTelemetryGateway } = setupUsageTelemetryRuntime({
    providers: {
      primary: createProvider("primary", {
        async generate() {
          throw new Error("primary unavailable");
        },
      }),
      secondary: createProvider("secondary"),
    },
  });

  await providerGateway.generate({
    providerId: "secondary",
    model: "model-a",
    prompt: "hello",
    modelLane: "worker",
    estimatedCostUsd: 1,
  });
  await providerGateway.generate({
    providerId: "primary",
    fallbackProviderIds: ["secondary"],
    model: "model-b",
    prompt: "hello",
    modelLane: "worker",
    estimatedCostUsd: 2,
  });

  const filtered = await usageTelemetryGateway.listUsageTelemetry({
    fallbackUsed: true,
    modelLane: "worker",
  });
  assert.deepEqual(filtered, {
    status: "ok",
    fromSequence: 1,
    returnedCount: 1,
    totalCount: 1,
    items: [
      {
        sequence: 2,
        timestamp: filtered.items[0].timestamp,
        timestampMs: filtered.items[0].timestampMs,
        traceId: filtered.items[0].traceId,
        actionId: "provider.generate",
        operation: "generate",
        executionType: "tool",
        requestedProviderId: "primary",
        providerId: "secondary",
        attemptedProviderIds: ["primary", "secondary"],
        fallbackProviderIds: ["secondary"],
        fallbackUsed: true,
        status: "completed",
        durationMs: filtered.items[0].durationMs,
        model: "model-b",
        modelLane: "worker",
        estimatedCostUsd: 2,
      },
    ],
    summary: {
      totalOperations: 1,
      completedCount: 1,
      failedCount: 0,
      fallbackCount: 1,
      totalDurationMs: filtered.summary.totalDurationMs,
      totalEstimatedCostUsd: 2,
      byOperation: [
        {
          operation: "generate",
          totalCount: 1,
          failedCount: 0,
          fallbackCount: 1,
          totalEstimatedCostUsd: 2,
        },
      ],
      byProvider: [
        {
          providerId: "secondary",
          totalCount: 1,
          failedCount: 0,
          fallbackCount: 1,
          totalEstimatedCostUsd: 2,
        },
      ],
      byModelLane: [
        {
          modelLane: "worker",
          totalCount: 1,
          totalEstimatedCostUsd: 2,
        },
      ],
    },
  });

  await assert.rejects(
    async () =>
      usageTelemetryGateway.listUsageTelemetry({
        operation: "invalid",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("usage telemetry collector sink failures fail closed through provider gateway", async () => {
  const { providerGateway } = setupUsageTelemetryRuntime({
    providers: {
      primary: createProvider("primary"),
    },
    telemetrySink() {
      throw new Error("usage sink offline");
    },
  });

  await assert.rejects(
    async () =>
      providerGateway.generate({
        providerId: "primary",
        model: "model-a",
        prompt: "hello",
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR" &&
      error.message.includes("Usage telemetry sink rejected event"),
  );
});

test("usage telemetry gateway constructor validates telemetry collector shape", () => {
  const contractRegistry = createContractRegistry();
  registerUsageTelemetryContract(contractRegistry);

  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
  });

  assert.throws(
    () =>
      createUsageTelemetryGateway({
        middlewarePipeline,
        telemetryCollector: /** @type {unknown} */ ({ listEvents: 1 }),
      }),
    (error) =>
      error instanceof Error &&
      error.message.includes("telemetryCollector must expose listEvents"),
  );
});
