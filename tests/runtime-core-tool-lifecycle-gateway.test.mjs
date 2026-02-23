import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createMiddlewarePipeline,
  createToolLifecycleGateway,
  registerToolLifecycleContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupToolLifecycleGateway(middleware = []) {
  const registry = createContractRegistry();
  registerToolLifecycleContract(registry);

  const auditEvents = [];
  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const gateway = createToolLifecycleGateway({
    middlewarePipeline: pipeline,
  });

  return {
    gateway,
    auditEvents,
  };
}

test("registerToolLifecycleContract registers tool lifecycle action once", () => {
  const registry = createContractRegistry();
  registerToolLifecycleContract(registry);
  registerToolLifecycleContract(registry);

  assert.deepEqual(registry.list(), ["tool.lifecycle@1"]);
});

test("tool lifecycle gateway runs middleware and returns typed accepted output", async () => {
  const middlewareEvents = [];
  const { gateway, auditEvents } = setupToolLifecycleGateway([
    {
      id: "capture",
      before(context) {
        middlewareEvents.push(`before:${context.input.phase}`);
      },
      after(context) {
        middlewareEvents.push(`after:${context.input.phase}`);
      },
    },
  ]);

  const beforeResult = await gateway.handleEvent({
    executionType: "tool",
    traceId: "trace-tool-1",
    phase: "before",
    toolCallId: "call-1",
    toolName: "search",
    args: { q: "polar" },
  });

  const afterResult = await gateway.handleEvent({
    executionType: "tool",
    traceId: "trace-tool-1",
    phase: "after",
    toolCallId: "call-1",
    toolName: "search",
    result: { items: [1, 2, 3] },
    isError: false,
  });

  assert.deepEqual(beforeResult, {
    status: "accepted",
    phase: "before",
    toolCallId: "call-1",
    toolName: "search",
    source: "pi-agent-loop",
  });
  assert.deepEqual(afterResult, {
    status: "accepted",
    phase: "after",
    toolCallId: "call-1",
    toolName: "search",
    source: "pi-agent-loop",
  });

  assert.deepEqual(middlewareEvents, [
    "before:before",
    "after:before",
    "before:after",
    "after:after",
  ]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "tool.lifecycle" &&
        event.executionType === "tool" &&
        event.traceId === "trace-tool-1",
    ),
  );
});

test("tool lifecycle gateway supports handler factory for adapter callbacks", async () => {
  const { gateway } = setupToolLifecycleGateway([]);
  const callback = gateway.createLifecycleHandler({
    executionType: "tool",
    traceId: "trace-x",
  });

  const output = await callback({
    phase: "before",
    toolCallId: "call-1",
    toolName: "shell",
    args: { command: "pwd" },
  });

  assert.deepEqual(output, {
    status: "accepted",
    phase: "before",
    toolCallId: "call-1",
    toolName: "shell",
    source: "pi-agent-loop",
  });
});

test("tool lifecycle gateway rejects invalid request shape deterministically", async () => {
  const { gateway } = setupToolLifecycleGateway([]);

  await assert.rejects(
    async () =>
      gateway.handleEvent({
        phase: "before",
        toolCallId: "",
        toolName: "search",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("tool lifecycle gateway fails deterministically on unserializable payloads", async () => {
  const { gateway } = setupToolLifecycleGateway([]);
  const circular = {};
  circular.self = circular;

  await assert.rejects(
    async () =>
      gateway.handleEvent({
        phase: "before",
        toolCallId: "call-2",
        toolName: "write",
        args: circular,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
