import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryRecallMiddleware } from "../packages/polar-runtime-core/src/memory-recall-middleware.mjs";

test("memory recall middleware filters out cross-lane records when threadKey is present", async () => {
  const middleware = createMemoryRecallMiddleware({
    memoryGateway: {
      async search() {
        return {
          status: "completed",
          records: [
            { record: { fact: "same lane fact" }, metadata: { threadKey: "root:42" } },
            { record: { fact: "other lane fact" }, metadata: { threadKey: "topic:42:9" } },
          ],
        };
      },
    },
  });

  const context = {
    actionId: "provider.generate",
    traceId: "trace-memory-recall",
    input: {
      sessionId: "s1",
      userId: "u1",
      threadKey: "root:42",
      messages: [{ role: "user", content: "what did we decide?" }],
    },
  };

  await middleware.before(context);
  const systemMessage = context.input.messages.find((entry) => entry.role === "system");
  assert.ok(systemMessage);
  assert.match(systemMessage.content, /same lane fact/);
  assert.doesNotMatch(systemMessage.content, /other lane fact/);
});

test("memory recall middleware excludes unscoped records except session summary in lane mode", async () => {
  const middleware = createMemoryRecallMiddleware({
    memoryGateway: {
      async search() {
        return {
          status: "completed",
          records: [
            { record: { type: "extracted_fact", fact: "untagged fact should be blocked" }, metadata: {} },
            { record: { type: "session_summary", summary: "session summary allowed" }, metadata: {} },
            { record: { type: "extracted_fact", fact: "same lane fact" }, metadata: { threadKey: "root:42" } },
          ],
        };
      },
    },
  });

  const context = {
    actionId: "provider.generate",
    traceId: "trace-memory-recall-2",
    input: {
      sessionId: "s1",
      userId: "u1",
      threadKey: "root:42",
      messages: [{ role: "user", content: "what did we decide?" }],
    },
  };

  await middleware.before(context);
  const systemMessage = context.input.messages.find((entry) => entry.role === "system");
  assert.ok(systemMessage);
  assert.match(systemMessage.content, /same lane fact/);
  assert.match(systemMessage.content, /session summary allowed/);
  assert.doesNotMatch(systemMessage.content, /untagged fact should be blocked/);
});

test("memory recall middleware skips injection when recall context already exists", async () => {
  const middleware = createMemoryRecallMiddleware({
    memoryGateway: {
      async search() {
        return {
          status: "completed",
          records: [{ record: { fact: "should not appear" }, metadata: { threadKey: "root:42" } }],
        };
      },
    },
  });

  const context = {
    actionId: "provider.generate",
    traceId: "trace-memory-recall-3",
    input: {
      sessionId: "s1",
      userId: "u1",
      threadKey: "root:42",
      system: "[THREAD_SUMMARY threadKey=root:42]\nexisting\n[/THREAD_SUMMARY]",
      messages: [{ role: "user", content: "what did we decide?" }],
    },
  };

  await middleware.before(context);
  const serialized = JSON.stringify(context.input);
  assert.doesNotMatch(serialized, /should not appear/);
});
