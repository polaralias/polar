import test from "node:test";
import assert from "node:assert/strict";

import { createApprovalStore, createOrchestrator } from "../packages/polar-runtime-core/src/index.mjs";

test("hybrid router persists clarification state and consumes follow-up selection deterministically", async () => {
  const providerCalls = [];
  const lineageEvents = [];
  let callIndex = 0;

  const orchestrator = createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          status: "resolved",
          profileConfig: {
            systemPrompt: "You are a parent profile.",
            modelPolicy: { providerId: "openai", modelId: "gpt-4.1-mini" },
          },
        };
      },
    },
    chatManagementGateway: {
      async appendMessage() {
        return { status: "appended" };
      },
      async getSessionHistory() {
        return { items: [] };
      },
    },
    providerGateway: {
      async generate(input) {
        providerCalls.push(input);
        callIndex += 1;
        if (callIndex === 1) {
          return {
            text: JSON.stringify({
              decision: "delegate",
              target: { agentId: "@writer" },
              confidence: 0.41,
              rationale: "ambiguous",
              references: { refersTo: "focus_anchor", refersToReason: "ambiguous pronoun" },
            }),
          };
        }
        return { text: "Acknowledged." };
      },
    },
    extensionGateway: {
      getState() { return undefined; },
      listStates() { return []; },
      async execute() { return { status: "completed", output: "ok" }; },
    },
    approvalStore: createApprovalStore(),
    lineageStore: {
      async append(event) {
        lineageEvents.push(event);
      },
    },
    now: Date.now,
  });

  const first = await orchestrator.orchestrate({
    sessionId: "session-hybrid-clarify",
    userId: "user-hybrid-clarify",
    text: "do that via sub-agent",
    messageId: "m-hybrid-1",
    metadata: { threadKey: "root:1" },
  });

  assert.equal(first.type, "clarification_needed");
  assert.match(first.text, /Quick check:/);
  assert.equal(callIndex, 1);

  const second = await orchestrator.orchestrate({
    sessionId: "session-hybrid-clarify",
    userId: "user-hybrid-clarify",
    text: "B",
    messageId: "m-hybrid-2",
    metadata: { threadKey: "root:1" },
  });

  assert.equal(second.status, "completed");
  assert.equal(callIndex, 2);
  const secondSystemPrompt = providerCalls.at(-1)?.system || "";
  assert.match(secondSystemPrompt, /\[ROUTER_DECISION\] Delegate this request/);

  const consumedEvent = lineageEvents.find((event) => event?.eventType === "routing.pending_state.consumed");
  assert.ok(consumedEvent);
  assert.equal(consumedEvent.selectionIntent, "delegate");
});
