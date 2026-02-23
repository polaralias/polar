import test from "node:test";
import assert from "node:assert/strict";

import { RuntimeExecutionError } from "../packages/polar-domain/src/index.mjs";
import {
  createPiAgentTurnAdapter,
  createPiProviderAdapter,
} from "../packages/polar-adapter-pi/src/index.mjs";
import {
  createContractRegistry,
  createMiddlewarePipeline,
  createToolLifecycleGateway,
  registerToolLifecycleContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function createAsyncStream(events, resultValue) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    async result() {
      return resultValue;
    },
  };
}

test("createPiProviderAdapter.generate returns typed text output", async () => {
  const adapter = createPiProviderAdapter({
    providerId: "pi",
    modelRegistry: {
      "gpt-test": { id: "gpt-test" },
    },
    llmClient: {
      async completeSimple() {
        return {
          content: [
            { type: "text", text: "hello" },
            { type: "text", text: " world" },
          ],
        };
      },
      async streamSimple() {
        throw new Error("not used");
      },
    },
  });

  const result = await adapter.generate({
    providerId: "pi",
    model: "gpt-test",
    prompt: "say hi",
  });

  assert.deepEqual(result, {
    providerId: "pi",
    model: "gpt-test",
    text: "hello world",
  });
});

test("createPiProviderAdapter.stream collects text_delta chunks", async () => {
  const adapter = createPiProviderAdapter({
    providerId: "pi",
    modelRegistry: {
      "gpt-test": { id: "gpt-test" },
    },
    llmClient: {
      async completeSimple() {
        throw new Error("not used");
      },
      async streamSimple() {
        return createAsyncStream(
          [
            { type: "start" },
            { type: "text_delta", delta: "he" },
            { type: "text_delta", delta: "llo" },
            { type: "done" },
          ],
          {
            content: [{ type: "text", text: "hello" }],
          },
        );
      },
    },
  });

  const result = await adapter.stream({
    providerId: "pi",
    model: "gpt-test",
    prompt: "say hi",
  });

  assert.deepEqual(result, {
    providerId: "pi",
    model: "gpt-test",
    chunks: ["he", "llo"],
  });
});

test("createPiProviderAdapter.embed returns vector from configured embedder", async () => {
  const adapter = createPiProviderAdapter({
    providerId: "pi",
    modelRegistry: {
      "embed-test": { id: "embed-test" },
    },
    llmClient: {
      async completeSimple() {
        throw new Error("not used");
      },
      async streamSimple() {
        throw new Error("not used");
      },
    },
    async embedder(input) {
      return [input.text.length, 2, 3];
    },
  });

  const result = await adapter.embed({
    providerId: "pi",
    model: "embed-test",
    text: "abcd",
  });

  assert.deepEqual(result, {
    providerId: "pi",
    model: "embed-test",
    vector: [4, 2, 3],
  });
});

test("createPiProviderAdapter.embed fails deterministically when embedder is not configured", async () => {
  const adapter = createPiProviderAdapter({
    providerId: "pi",
    modelRegistry: {
      "embed-test": { id: "embed-test" },
    },
    llmClient: {
      async completeSimple() {
        throw new Error("not used");
      },
      async streamSimple() {
        throw new Error("not used");
      },
    },
  });

  await assert.rejects(
    async () =>
      adapter.embed({
        providerId: "pi",
        model: "embed-test",
        text: "abcd",
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR",
  );
});

test("createPiAgentTurnAdapter maps tool lifecycle events to before/after callbacks", async () => {
  const lifecycleEvents = [];

  const adapter = createPiAgentTurnAdapter({
    agentRuntime: {
      agentLoop() {
        return createAsyncStream(
          [
            {
              type: "tool_execution_start",
              toolCallId: "c1",
              toolName: "search",
              args: { q: "x" },
            },
            {
              type: "tool_execution_end",
              toolCallId: "c1",
              toolName: "search",
              result: { ok: true },
              isError: false,
            },
          ],
          [{ role: "assistant", content: [] }],
        );
      },
      agentLoopContinue() {
        return createAsyncStream([], []);
      },
    },
  });

  const result = await adapter.runTurn({
    prompts: [],
    context: {},
    loopConfig: {},
    async onToolLifecycleEvent(event) {
      lifecycleEvents.push(`${event.phase}:${event.toolName}`);
    },
  });

  assert.deepEqual(lifecycleEvents, ["before:search", "after:search"]);
  assert.equal(Array.isArray(result.events), true);
  assert.equal(Array.isArray(result.messages), true);
  assert.equal(result.messages.length, 1);
});

test("createPiAgentTurnAdapter can enforce runtime-core middleware through configured lifecycle handler", async () => {
  const registry = createContractRegistry();
  registerToolLifecycleContract(registry);

  const middlewareEvents = [];
  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware: [
      {
        id: "tool-policy",
        before(context) {
          middlewareEvents.push(`before:${context.input.phase}`);
        },
        after(context) {
          middlewareEvents.push(`after:${context.input.phase}`);
        },
      },
    ],
  });
  const lifecycleGateway = createToolLifecycleGateway({
    middlewarePipeline: pipeline,
  });

  const adapter = createPiAgentTurnAdapter({
    toolLifecycleHandler: lifecycleGateway.createLifecycleHandler({
      executionType: "tool",
      traceId: "trace-agent-1",
    }),
    agentRuntime: {
      agentLoop() {
        return createAsyncStream(
          [
            {
              type: "tool_execution_start",
              toolCallId: "call-1",
              toolName: "search",
              args: { q: "x" },
            },
            {
              type: "tool_execution_end",
              toolCallId: "call-1",
              toolName: "search",
              result: { ok: true },
              isError: false,
            },
          ],
          [{ role: "assistant", content: [] }],
        );
      },
      agentLoopContinue() {
        return createAsyncStream([], []);
      },
    },
  });

  await adapter.runTurn({
    prompts: [],
    context: {},
    loopConfig: {},
  });

  assert.deepEqual(middlewareEvents, [
    "before:before",
    "after:before",
    "before:after",
    "after:after",
  ]);
});
