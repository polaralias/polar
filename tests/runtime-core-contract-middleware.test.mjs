import test from "node:test";
import assert from "node:assert/strict";

import {
  ContractValidationError,
  EXECUTION_TYPES,
  createStrictObjectSchema,
  enumField,
  stringField,
} from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createMiddlewarePipeline,
} from "../packages/polar-runtime-core/src/index.mjs";

/**
 * @param {string} actionId
 */
function createEchoContract(actionId = "tool.echo") {
  return Object.freeze({
    actionId,
    version: 1,
    riskClass: "low",
    trustClass: "native",
    timeoutMs: 30_000,
    retryPolicy: { maxAttempts: 1 },
    inputSchema: createStrictObjectSchema({
      schemaId: `${actionId}.input`,
      fields: {
        sessionId: stringField({ minLength: 1 }),
        prompt: stringField({ minLength: 1 }),
        lane: enumField(["local", "worker", "brain"]),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: `${actionId}.output`,
      fields: {
        message: stringField({ minLength: 1 }),
        lane: enumField(["local", "worker", "brain"]),
      },
    }),
  });
}

test("blocks execution when contract is not registered", async () => {
  const registry = createContractRegistry();
  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware: [],
  });

  await assert.rejects(
    async () =>
      pipeline.run(
        {
          executionType: "tool",
          actionId: "tool.missing",
          version: 1,
          input: {
            sessionId: "s1",
            prompt: "hello",
            lane: "worker",
          },
        },
        async () => ({ message: "ok", lane: "worker" }),
      ),
    (error) => error.code === "POLAR_CONTRACT_REGISTRY_ERROR",
  );
});

test("runs before middleware in declared order and after middleware in reverse order", async () => {
  const registry = createContractRegistry();
  registry.register(createEchoContract());

  const events = [];
  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware: [
      {
        id: "first",
        before(context) {
          events.push("before:first");
          return {
            input: {
              ...context.input,
              prompt: `${context.input.prompt}!`,
            },
          };
        },
        after() {
          events.push("after:first");
        },
      },
      {
        id: "second",
        before() {
          events.push("before:second");
        },
        after() {
          events.push("after:second");
        },
      },
    ],
  });

  const output = await pipeline.run(
    {
      executionType: "tool",
      actionId: "tool.echo",
      version: 1,
      input: {
        sessionId: "s-1",
        prompt: "hello",
        lane: "worker",
      },
    },
    async (input) => {
      events.push("execute");
      return {
        message: input.prompt,
        lane: input.lane,
      };
    },
  );

  assert.deepEqual(events, [
    "before:first",
    "before:second",
    "execute",
    "after:second",
    "after:first",
  ]);
  assert.deepEqual(output, {
    message: "hello!",
    lane: "worker",
  });
});

test("rejects unknown input fields and still runs after middleware", async () => {
  const registry = createContractRegistry();
  registry.register(createEchoContract());

  let afterExecuted = false;
  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware: [
      {
        id: "audit",
        after() {
          afterExecuted = true;
        },
      },
    ],
  });

  await assert.rejects(
    async () =>
      pipeline.run(
        {
          executionType: "tool",
          actionId: "tool.echo",
          version: 1,
          input: {
            sessionId: "s-1",
            prompt: "hello",
            lane: "worker",
            unknownField: "not-allowed",
          },
        },
        async () => {
          assert.fail("executor must not run on invalid input");
        },
      ),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  assert.equal(afterExecuted, true);
});

test("fails closed when after middleware attempts to clear an existing error", async () => {
  const registry = createContractRegistry();
  registry.register(createEchoContract());

  let afterExecuted = false;
  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware: [
      {
        id: "malicious-recovery",
        after() {
          afterExecuted = true;
          return {
            error: undefined,
            output: {
              message: "recovered",
              lane: "worker",
            },
          };
        },
      },
    ],
  });

  await assert.rejects(
    async () =>
      pipeline.run(
        {
          executionType: "tool",
          actionId: "tool.echo",
          version: 1,
          input: {
            sessionId: "s-1",
            prompt: "hello",
            lane: "worker",
            unknownField: "not-allowed",
          },
        },
        async () => ({
          message: "executor",
          lane: "worker",
        }),
      ),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  assert.equal(afterExecuted, true);
});

test("rejects output mutations that bypass contract schema", async () => {
  const registry = createContractRegistry();
  registry.register(createEchoContract());

  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware: [
      {
        id: "redaction",
        after(context) {
          return {
            output: {
              ...context.output,
              extra: "bypass",
            },
          };
        },
      },
    ],
  });

  await assert.rejects(
    async () =>
      pipeline.run(
        {
          executionType: "tool",
          actionId: "tool.echo",
          version: 1,
          input: {
            sessionId: "s-1",
            prompt: "hello",
            lane: "worker",
          },
        },
        async () => ({
          message: "hello",
          lane: "worker",
        }),
      ),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("maps unknown execution failures to deterministic typed errors", async () => {
  const registry = createContractRegistry();
  registry.register(createEchoContract());

  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware: [],
  });

  await assert.rejects(
    async () =>
      pipeline.run(
        {
          executionType: "tool",
          actionId: "tool.echo",
          version: 1,
          input: {
            sessionId: "s-1",
            prompt: "hello",
            lane: "worker",
          },
        },
        async () => {
          throw new Error("provider failure");
        },
      ),
    (error) =>
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR" &&
      error.details.cause === "provider failure",
  );
});

test("enforces execution-type middleware and trace-correlated audit envelopes for tool/handoff/automation/heartbeat", async () => {
  const registry = createContractRegistry();
  for (const executionType of EXECUTION_TYPES) {
    registry.register(createEchoContract(`${executionType}.echo`));
  }

  const middlewareEvents = [];
  const auditEvents = [];

  const middlewareByExecutionType = EXECUTION_TYPES.reduce((result, executionType) => {
    result[executionType] = [
      {
        id: `${executionType}.middleware`,
        before() {
          middlewareEvents.push(`before:${executionType}`);
        },
        after() {
          middlewareEvents.push(`after:${executionType}`);
        },
      },
    ];
    return result;
  }, {});

  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middlewareByExecutionType,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  for (const executionType of EXECUTION_TYPES) {
    const output = await pipeline.run(
      {
        executionType,
        actionId: `${executionType}.echo`,
        version: 1,
        input: {
          sessionId: "s-1",
          prompt: `hello:${executionType}`,
          lane: "worker",
        },
      },
      async (input) => ({
        message: input.prompt,
        lane: input.lane,
      }),
    );

    assert.deepEqual(output, {
      message: `hello:${executionType}`,
      lane: "worker",
    });
  }

  assert.deepEqual(middlewareEvents, [
    "before:tool",
    "after:tool",
    "before:handoff",
    "after:handoff",
    "before:automation",
    "after:automation",
    "before:heartbeat",
    "after:heartbeat",
  ]);

  for (const executionType of EXECUTION_TYPES) {
    const actionId = `${executionType}.echo`;
    const eventsForType = auditEvents.filter(
      (entry) => entry.executionType === executionType && entry.actionId === actionId,
    );

    assert.ok(eventsForType.length > 0);

    const traceIds = new Set(eventsForType.map((entry) => entry.traceId));
    assert.equal(traceIds.size, 1);

    assert.ok(
      eventsForType.some((entry) => entry.checkpoint === "middleware.before"),
    );
    assert.ok(
      eventsForType.some((entry) => entry.checkpoint === "middleware.after"),
    );
    assert.ok(
      eventsForType.some((entry) => entry.checkpoint === "run.completed"),
    );
    const resolvedEvents = eventsForType.filter(
      (entry) => entry.checkpoint !== "run.received",
    );
    assert.ok(
      resolvedEvents.every(
        (entry) => entry.riskClass === "low" && entry.trustClass === "native",
      ),
    );
  }
});

test("rejects unknown execution types", async () => {
  const registry = createContractRegistry();
  registry.register(createEchoContract());

  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
  });

  await assert.rejects(
    async () =>
      pipeline.run(
        {
          executionType: "unknown",
          actionId: "tool.echo",
          version: 1,
          input: {
            sessionId: "s-1",
            prompt: "hello",
            lane: "worker",
          },
        },
        async () => ({
          message: "ok",
          lane: "worker",
        }),
      ),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("keeps provided trace id across every emitted audit event", async () => {
  const registry = createContractRegistry();
  registry.register(createEchoContract());

  const auditEvents = [];
  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware: [
      {
        id: "noop",
        before() {},
        after() {},
      },
    ],
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  await pipeline.run(
    {
      executionType: "tool",
      actionId: "tool.echo",
      version: 1,
      traceId: "trace-fixed-001",
      input: {
        sessionId: "s-1",
        prompt: "hello",
        lane: "worker",
      },
    },
    async () => ({
      message: "hello",
      lane: "worker",
    }),
  );

  assert.ok(auditEvents.length > 0);
  assert.equal(
    auditEvents.every((event) => event.traceId === "trace-fixed-001"),
    true,
  );
});

test("fails closed when audit sink fails to prevent audit bypass", async () => {
  const registry = createContractRegistry();
  registry.register(createEchoContract());

  let failedOnce = false;
  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware: [
      {
        id: "noop",
        before() {},
        after() {},
      },
    ],
    auditSink(event) {
      if (!failedOnce && event.checkpoint === "execution.completed") {
        failedOnce = true;
        throw new Error("audit storage offline");
      }
    },
  });

  await assert.rejects(
    async () =>
      pipeline.run(
        {
          executionType: "tool",
          actionId: "tool.echo",
          version: 1,
          input: {
            sessionId: "s-1",
            prompt: "hello",
            lane: "worker",
          },
        },
        async () => ({
          message: "hello",
          lane: "worker",
        }),
      ),
    (error) =>
      error.code === "POLAR_MIDDLEWARE_EXECUTION_ERROR" &&
      error.details.checkpoint === "execution.completed",
  );
});
