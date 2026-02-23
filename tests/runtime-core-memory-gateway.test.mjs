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

function createMemoryProvider(overrides = {}) {
  return {
    async search() {
      return { records: [] };
    },
    async get() {
      return { found: false };
    },
    async upsert(request) {
      return {
        memoryId:
          typeof request.memoryId === "string" && request.memoryId.length > 0
            ? request.memoryId
            : "mem-default",
        created: true,
      };
    },
    async compact() {
      return {
        examinedCount: 0,
        compactedCount: 0,
        archivedCount: 0,
      };
    },
    ...overrides,
  };
}

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

  assert.deepEqual(contractRegistry.list(), [
    "memory.compact@1",
    "memory.get@1",
    "memory.search@1",
    "memory.upsert@1",
  ]);
});

test("memory search runs through middleware and returns typed completed output", async () => {
  const middlewareEvents = [];
  const { gateway, auditEvents } = setupMemoryGateway({
    memoryProvider: createMemoryProvider({
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
    }),
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
    memoryProvider: createMemoryProvider({
      async get() {
        return {
          found: false,
        };
      },
    }),
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
    memoryProvider: createMemoryProvider({
      async search() {
        throw new Error("memory provider unavailable");
      },
    }),
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
    memoryProvider: createMemoryProvider({
      async get() {
        throw new Error("connection timeout");
      },
    }),
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
    memoryProvider: createMemoryProvider(),
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
    memoryProvider: createMemoryProvider({
      async search() {
        throw new Error("invalid provider payload");
      },
    }),
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

test("memory upsert runs through middleware and returns typed completed output", async () => {
  const middlewareEvents = [];
  const { gateway, auditEvents } = setupMemoryGateway({
    memoryProvider: createMemoryProvider({
      async upsert() {
        return {
          memoryId: "mem-upsert-1",
          created: true,
        };
      },
    }),
    middleware: [
      {
        id: "capture-upsert",
        before(context) {
          if (context.actionId === "memory.upsert") {
            middlewareEvents.push("before");
          }
        },
        after(context) {
          if (context.actionId === "memory.upsert") {
            middlewareEvents.push("after");
          }
        },
      },
    ],
  });

  const result = await gateway.upsert({
    traceId: "trace-memory-upsert-1",
    sessionId: "session-1",
    userId: "user-1",
    scope: "workspace",
    record: {
      summary: "Prefers concise project updates",
    },
    metadata: {
      source: "manual",
    },
  });

  assert.deepEqual(result, {
    status: "completed",
    sessionId: "session-1",
    userId: "user-1",
    scope: "workspace",
    memoryId: "mem-upsert-1",
    providerStatus: "available",
    created: true,
  });
  assert.deepEqual(middlewareEvents, ["before", "after"]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "memory.upsert" &&
        event.traceId === "trace-memory-upsert-1",
    ),
  );
});

test("memory compact returns typed completed output", async () => {
  const { gateway } = setupMemoryGateway({
    memoryProvider: createMemoryProvider({
      async compact() {
        return {
          examinedCount: 12,
          compactedCount: 4,
          archivedCount: 2,
        };
      },
    }),
  });

  const result = await gateway.compact({
    sessionId: "session-5",
    userId: "user-5",
    scope: "session",
    strategy: "deduplicate",
    maxRecords: 200,
    dryRun: false,
  });

  assert.deepEqual(result, {
    status: "completed",
    sessionId: "session-5",
    userId: "user-5",
    scope: "session",
    strategy: "deduplicate",
    examinedCount: 12,
    compactedCount: 4,
    archivedCount: 2,
    providerStatus: "available",
  });
});

test("memory upsert and compact return degraded outputs when provider is unavailable", async () => {
  const { gateway } = setupMemoryGateway({
    memoryProvider: createMemoryProvider({
      async upsert() {
        throw new Error("memory provider unavailable");
      },
      async compact() {
        throw new Error("connection timed out");
      },
    }),
  });

  const upsertResult = await gateway.upsert({
    sessionId: "session-7",
    userId: "user-7",
    scope: "global",
    memoryId: "mem-existing",
    record: {
      summary: "Persist existing memory id when degraded",
    },
  });
  assert.deepEqual(upsertResult, {
    status: "degraded",
    sessionId: "session-7",
    userId: "user-7",
    scope: "global",
    memoryId: "mem-existing",
    providerStatus: "unavailable",
    degradedReason: "memory provider unavailable",
  });

  const compactResult = await gateway.compact({
    sessionId: "session-7",
    userId: "user-7",
    scope: "global",
  });
  assert.deepEqual(compactResult, {
    status: "degraded",
    sessionId: "session-7",
    userId: "user-7",
    scope: "global",
    strategy: "summarize",
    examinedCount: 0,
    compactedCount: 0,
    archivedCount: 0,
    providerStatus: "unavailable",
    degradedReason: "connection timed out",
  });
});

test("memory upsert and compact reject invalid provider payloads", async () => {
  const { gateway } = setupMemoryGateway({
    memoryProvider: createMemoryProvider({
      async upsert() {
        return {
          created: true,
        };
      },
      async compact() {
        return {
          examinedCount: 3,
          compactedCount: -1,
          archivedCount: 0,
        };
      },
    }),
  });

  await assert.rejects(
    async () =>
      gateway.upsert({
        sessionId: "session-8",
        userId: "user-8",
        scope: "session",
        record: {
          summary: "invalid payload",
        },
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR" &&
      error.message === "Memory provider upsert result must include memoryId",
  );

  await assert.rejects(
    async () =>
      gateway.compact({
        sessionId: "session-8",
        userId: "user-8",
        scope: "session",
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR" &&
      error.message ===
        "Memory provider compact result compactedCount must be a non-negative integer",
  );
});
