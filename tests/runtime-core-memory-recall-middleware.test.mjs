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

