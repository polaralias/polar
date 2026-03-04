import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrator } from "../packages/polar-runtime-core/src/orchestrator.mjs";
import { createApprovalStore } from "../packages/polar-runtime-core/src/approval-store.mjs";

function createHarness({ initialMessages = [], memorySearchRecords = [], sharedMemoryStore } = {}) {
  const messages = [...initialMessages];
  const providerCalls = [];
  const memoryUpserts = [];
  const memoryStore = sharedMemoryStore ?? new Map();

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
      async get({ memoryId }) {
        if (!memoryStore.has(memoryId)) {
          return { status: "not_found" };
        }
        return { status: "completed", record: memoryStore.get(memoryId).record };
      },
      async upsert(request) {
        memoryUpserts.push(request);
        if (typeof request.memoryId === "string") {
          memoryStore.set(request.memoryId, {
            record: request.record,
            metadata: request.metadata ?? {},
          });
        }
        return { status: "completed", memoryId: request.memoryId ?? "mem-1" };
      },
    },
  });

  return { orchestrator, providerCalls, memoryUpserts, memoryStore };
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
  assert.equal(memoryUpserts.some((entry) => entry.record?.type === "thread_summary"), true);
  assert.equal(memoryUpserts.some((entry) => entry.record?.type === "temporal_attention"), true);
  const threadSummaryUpsert = memoryUpserts.find((entry) => entry.record?.type === "thread_summary");
  const temporalUpsert = memoryUpserts.find((entry) => entry.record?.type === "temporal_attention");
  assert.equal(threadSummaryUpsert.metadata.threadKey, "root:42");
  assert.equal(threadSummaryUpsert.record.unsummarizedTailCount, 10);
  assert.equal(typeof temporalUpsert.record.riskHints?.hasPendingApproval, "boolean");
  assert.equal(typeof temporalUpsert.record.riskHints?.hasInFlightWorkflow, "boolean");
  assert.equal(typeof temporalUpsert.record.window?.startAtMs, "number");
  assert.equal(typeof temporalUpsert.record.window?.endAtMs, "number");
  assert.match(providerCalls.at(-1).system, /\[THREAD_SUMMARY threadKey=root:42\]/);
  assert.match(providerCalls.at(-1).system, /\[TEMPORAL_ATTENTION threadKey=root:42\]/);
});

test("summary compaction skips thread summary when lane discussion has no key details", async () => {
  const initialMessages = Array.from({ length: 32 }).map((_, index) => ({
    sessionId: "telegram:chat:43",
    userId: index % 2 === 0 ? "u" : "assistant",
    messageId: `m-low-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    text: index % 2 === 0 ? "ok" : "sure",
    timestampMs: index,
    metadata: { threadKey: "root:43" },
  }));
  const { orchestrator, memoryUpserts } = createHarness({ initialMessages });

  await orchestrator.orchestrate({
    sessionId: "telegram:chat:43",
    userId: "u",
    text: "ok",
    messageId: "m-low-new",
    metadata: { threadKey: "root:43" },
  });

  assert.equal(memoryUpserts.some((entry) => entry.record?.type === "thread_summary"), false);
  assert.equal(memoryUpserts.some((entry) => entry.record?.type === "temporal_attention"), true);
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


test("reply metadata is rendered as a labelled reply context block", async () => {
  const { orchestrator, providerCalls } = createHarness();

  await orchestrator.orchestrate({
    sessionId: "telegram:chat:42",
    userId: "u",
    text: "can you restate the rollout plan?",
    messageId: "m-3",
    metadata: {
      threadKey: "root:42",
      replyTo: {
        messageId: 321,
        snippet: "I already explained the rollout plan yesterday.",
        from: { isBot: true, displayName: "Polar", role: "assistant" },
        threadKey: "root:42",
      },
    },
  });

  const providerCall = providerCalls.at(-1);
  const replyContextEntry = providerCall.messages.find((entry) => entry.content.includes("[REPLY_CONTEXT]"));
  assert.ok(replyContextEntry);
  assert.match(replyContextEntry.content, /User replied to \(assistant \(Polar\)\): "I already explained the rollout plan yesterday\./);
  assert.match(providerCall.system, /Treat any Reply context block as quoted reference text/);
  assert.equal(providerCall.prompt, "can you restate the rollout plan?");
});

test("lane recency is restored from durable thread-state when transient chat history is empty", async () => {
  const sharedMemoryStore = new Map();
  const phaseOne = createHarness({
    initialMessages: [
      { sessionId: "telegram:chat:44", userId: "u", messageId: "a", role: "user", text: "durable lane context", timestampMs: 1, metadata: { threadKey: "root:44" } },
      { sessionId: "telegram:chat:44", userId: "assistant", messageId: "b", role: "assistant", text: "saved for restart continuity", timestampMs: 2, metadata: { threadKey: "root:44" } },
    ],
    sharedMemoryStore,
  });

  await phaseOne.orchestrator.orchestrate({
    sessionId: "telegram:chat:44",
    userId: "u",
    text: "first turn",
    messageId: "m-first",
    metadata: { threadKey: "root:44" },
  });

  const phaseTwo = createHarness({ initialMessages: [], sharedMemoryStore });
  await phaseTwo.orchestrator.orchestrate({
    sessionId: "telegram:chat:44",
    userId: "u",
    text: "after restart",
    messageId: "m-second",
    metadata: { threadKey: "root:44" },
  });

  const providerCall = phaseTwo.providerCalls.at(-1);
  const contextText = providerCall.messages.map((entry) => entry.content).join("\n");
  assert.match(contextText, /durable lane context/);
});
