import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrator } from "../packages/polar-runtime-core/src/orchestrator.mjs";
import { createApprovalStore } from "../packages/polar-runtime-core/src/approval-store.mjs";

function createHarness({ initialMessages = [], memorySearchRecords = [] } = {}) {
  const messages = [...initialMessages];
  const providerCalls = [];
  const memoryUpserts = [];

  const orchestrator = createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          profileConfig: {
            systemPrompt: "You are a test assistant.",
            contextWindow: 12,
            modelPolicy: { providerId: "provider-x", modelId: "model-y" },
            allowedSkills: [],
          },
        };
      },
    },
    chatManagementGateway: {
      async appendMessage(message) {
        messages.push(message);
        return { status: "appended" };
      },
      async getSessionHistory({ sessionId, limit = 100 }) {
        const items = messages.filter((entry) => entry.sessionId === sessionId);
        return { items: items.slice(-limit) };
      },
    },
    providerGateway: {
      async generate(request) {
        providerCalls.push(request);
        return { text: "ack" };
      },
    },
    extensionGateway: {
      getState() { return undefined; },
      listStates() { return []; },
      async execute() { return { status: "completed", output: "Done." }; },
    },
    approvalStore: createApprovalStore(),
    gateway: {
      async getConfig() { return { status: "not_found" }; },
    },
    memoryGateway: {
      async search() {
        return { status: "completed", records: memorySearchRecords };
      },
      async upsert(request) {
        memoryUpserts.push(request);
        return { status: "completed", memoryId: request.memoryId ?? "mem-1" };
      },
    },
  });

  return { orchestrator, providerCalls, memoryUpserts };
}

test("lane scoping excludes other threadKeys from context window", async () => {
  const { orchestrator, providerCalls } = createHarness({
    initialMessages: [
      { sessionId: "telegram:chat:42", userId: "u", messageId: "a", role: "user", text: "alpha lane", timestampMs: 1, metadata: { threadKey: "root:42" } },
      { sessionId: "telegram:chat:42", userId: "u", messageId: "b", role: "assistant", text: "alpha reply", timestampMs: 2, metadata: { threadKey: "root:42" } },
      { sessionId: "telegram:chat:42", userId: "u", messageId: "c", role: "user", text: "topic lane should be excluded", timestampMs: 3, metadata: { threadKey: "topic:42:9" } },
    ],
  });

  await orchestrator.orchestrate({
    sessionId: "telegram:chat:42",
    userId: "u",
    text: "new alpha request",
    messageId: "m-1",
    metadata: { threadKey: "root:42" },
  });

  const providerCall = providerCalls.at(-1);
  const contextText = providerCall.messages.map((entry) => entry.content).join("\n");
  assert.match(contextText, /alpha lane/);
  assert.doesNotMatch(contextText, /topic lane should be excluded/);
});

test("summary compaction writes thread_summary for oversized lane history", async () => {
  const initialMessages = Array.from({ length: 32 }).map((_, index) => ({
    sessionId: "telegram:chat:42",
    userId: index % 2 === 0 ? "u" : "assistant",
    messageId: `m-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    text: `lane message ${index}`,
    timestampMs: index,
    metadata: { threadKey: "root:42" },
  }));
  const { orchestrator, providerCalls, memoryUpserts } = createHarness({ initialMessages });

  await orchestrator.orchestrate({
    sessionId: "telegram:chat:42",
    userId: "u",
    text: "continue",
    messageId: "m-new",
    metadata: { threadKey: "root:42" },
  });

  assert.equal(memoryUpserts.length > 0, true);
  assert.equal(memoryUpserts[0].record.type, "thread_summary");
  assert.equal(memoryUpserts[0].metadata.threadKey, "root:42");
  assert.equal(memoryUpserts[0].record.unsummarizedTailCount, 10);
  assert.match(providerCalls.at(-1).system, /\[THREAD_SUMMARY threadKey=root:42\]/);
});

test("retrieval prefers lane-relevant memories", async () => {
  const { orchestrator, providerCalls } = createHarness({
    memorySearchRecords: [
      { memoryId: "x", record: { type: "extracted_fact", fact: "wrong lane" }, metadata: { threadKey: "topic:42:9" } },
      { memoryId: "y", record: { type: "extracted_fact", fact: "lane relevant fact" }, metadata: { threadKey: "root:42" } },
    ],
  });

  await orchestrator.orchestrate({
    sessionId: "telegram:chat:42",
    userId: "u",
    text: "what did we decide",
    messageId: "m-2",
    metadata: { threadKey: "root:42" },
  });

  const systemPrompt = providerCalls.at(-1).system;
  assert.match(systemPrompt, /lane relevant fact/);
  assert.doesNotMatch(systemPrompt, /wrong lane/);
});
