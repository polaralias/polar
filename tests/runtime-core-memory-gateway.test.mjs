import test from "node:test";
import assert from "node:assert/strict";

import {
  ContractValidationError,
  RuntimeExecutionError,
} from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createMemoryGateway,
  createMiddlewarePipeline,
  registerMemoryContracts,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupMemoryGateway({
  memoryProvider,
  middleware = [],
} = {}) {
  const contractRegistry = createContractRegistry();
  registerMemoryContracts(contractRegistry);

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const gateway = createMemoryGateway({
    middlewarePipeline,
    memoryProvider,
  });

  return {
    gateway,
    auditEvents,
  };
}

test("registerMemoryContracts registers memory contracts once", () => {
  const contractRegistry = createContractRegistry();
  registerMemoryContracts(contractRegistry);
  registerMemoryContracts(contractRegistry);

  assert.deepEqual(contractRegistry.list(), ["memory.get@1", "memory.search@1"]);
});

test("memory search runs through middleware and returns typed completed output", async () => {
  const middlewareEvents = [];
  const { gateway, auditEvents } = setupMemoryGateway({
    memoryProvider: {
      async search() {
        return {
          records: [
            {
              memoryId: "mem-1",
              summary: "Telegram preference",
            },
          ],
          nextCursor: "cursor-2",
        };
      },
      async get() {
        return { found: false };
      },
    },
    middleware: [
      {
        id: "capture",
        before() {
          middlewareEvents.push("before");
        },
        after() {
          middlewareEvents.push("after");
        },
      },
    ],
  });

  const result = await gateway.search({
    traceId: "trace-memory-search-1",
    sessionId: "session-1",
    userId: "user-1",
    scope: "session",
    query: "telegram",
    limit: 5,
  });

  assert.deepEqual(result, {
    status: "completed",
    sessionId: "session-1",
    userId: "user-1",
    scope: "session",
    query: "telegram",
    resultCount: 1,
    records: [
      {
        memoryId: "mem-1",
        summary: "Telegram preference",
      },
    ],
    nextCursor: "cursor-2",
    providerStatus: "available",
  });
  assert.deepEqual(middlewareEvents, ["before", "after"]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "memory.search" &&
        event.traceId === "trace-memory-search-1",
    ),
  );
});

test("memory get returns typed not_found output when record does not exist", async () => {
  const { gateway } = setupMemoryGateway({
    memoryProvider: {
      async search() {
        return { records: [] };
      },
      async get() {
        return {
          found: false,
        };
      },
    },
  });

  const result = await gateway.get({
    sessionId: "session-1",
    userId: "user-1",
    scope: "workspace",
    memoryId: "mem-missing",
  });

  assert.deepEqual(result, {
    status: "not_found",
    sessionId: "session-1",
    userId: "user-1",
    scope: "workspace",
    memoryId: "mem-missing",
    providerStatus: "available",
  });
});

test("memory search returns degraded typed output when provider is unavailable", async () => {
  const { gateway } = setupMemoryGateway({
    memoryProvider: {
      async search() {
        throw new Error("memory provider unavailable");
      },
      async get() {
        return { found: false };
      },
    },
  });

  const result = await gateway.search({
    sessionId: "session-2",
    userId: "user-2",
    scope: "global",
    query: "project summary",
  });

  assert.deepEqual(result, {
    status: "degraded",
    sessionId: "session-2",
    userId: "user-2",
    scope: "global",
    query: "project summary",
    resultCount: 0,
    records: [],
    providerStatus: "unavailable",
    degradedReason: "memory provider unavailable",
  });
});

test("memory get returns degraded typed output when provider times out", async () => {
  const { gateway } = setupMemoryGateway({
    memoryProvider: {
      async search() {
        return { records: [] };
      },
      async get() {
        throw new Error("connection timeout");
      },
    },
  });

  const result = await gateway.get({
    sessionId: "session-2",
    userId: "user-2",
    scope: "session",
    memoryId: "mem-1",
  });

  assert.deepEqual(result, {
    status: "degraded",
    sessionId: "session-2",
    userId: "user-2",
    scope: "session",
    memoryId: "mem-1",
    providerStatus: "unavailable",
    degradedReason: "connection timeout",
  });
});

test("memory gateway rejects invalid request shapes deterministically", async () => {
  const { gateway } = setupMemoryGateway({
    memoryProvider: {
      async search() {
        return { records: [] };
      },
      async get() {
        return { found: false };
      },
    },
  });

  await assert.rejects(
    async () =>
      gateway.search({
        sessionId: "",
        userId: "user-1",
        scope: "session",
        query: "q",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      gateway.get({
        sessionId: "session-1",
        userId: "user-1",
        scope: "session",
        memoryId: "mem-1",
        unexpected: "x",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("memory gateway rethrows unexpected provider failures as runtime errors", async () => {
  const { gateway } = setupMemoryGateway({
    memoryProvider: {
      async search() {
        throw new Error("invalid provider payload");
      },
      async get() {
        return { found: false };
      },
    },
  });

  await assert.rejects(
    async () =>
      gateway.search({
        sessionId: "session-3",
        userId: "user-3",
        scope: "session",
        query: "q",
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR" &&
      error.message === "Memory search failed",
  );
});
