import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrator } from "../packages/polar-runtime-core/src/orchestrator.mjs";
import { createApprovalStore } from "../packages/polar-runtime-core/src/approval-store.mjs";

function createHarness({ throwOnRepairPhrasing = false } = {}) {
  const providerCalls = [];
  const messages = [];

  const chatManagementGateway = {
    async appendMessage(message) {
      messages.push(message);
      return { status: "appended" };
    },
    async getSessionHistory({ sessionId, limit = 100 }) {
      const items = messages
        .filter((entry) => entry.sessionId === sessionId)
        .map((entry) => ({ role: entry.role, text: entry.text }));
      return { items: items.slice(-limit) };
    },
  };

  const providerGateway = {
    async generate(request) {
      providerCalls.push(request);

      if (
        typeof request.prompt === "string" &&
        request.prompt.includes("Respond with ONLY this JSON shape")
      ) {
        if (throwOnRepairPhrasing) {
          throw new Error("repair phrasing provider unavailable");
        }
        return {
          text: JSON.stringify({
            question: "Which path should I continue?",
            labelA: "Alpha path",
            labelB: "Beta path",
            correlationId: "attacker-correlation",
            options: [{ id: "X", threadId: "attacker-thread" }],
          }),
        };
      }

      if (request.prompt === "topic one") {
        return { text: "I can help. Want me to troubleshoot the weather lookup?" };
      }
      if (request.prompt === "topic two") {
        return { text: "I can help. Shall I explain more about the routing design?" };
      }

      return { text: "ok" };
    },
  };

  const orchestrator = createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          profileConfig: {
            systemPrompt: "You are a test assistant.",
            modelPolicy: { providerId: "provider-x", modelId: "model-y" },
            allowedSkills: [],
          },
        };
      },
    },
    chatManagementGateway,
    providerGateway,
    extensionGateway: {
      getState() {
        return undefined;
      },
      listStates() {
        return [];
      },
      async execute() {
        return { status: "completed", output: "Done." };
      },
    },
    approvalStore: createApprovalStore(),
    gateway: {
      async getConfig() {
        return { status: "not_found" };
      },
    },
  });

  return {
    orchestrator,
    providerCalls,
  };
}

test("repair phrasing path uses resolved provider/model and cannot change routing authority", async () => {
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = (callback, interval, ...args) => {
    const timer = originalSetInterval(callback, interval, ...args);
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }
    return timer;
  };

  try {
    const { orchestrator, providerCalls } = createHarness();

    const first = await orchestrator.orchestrate({
      sessionId: "session-repair-1",
      userId: "user-1",
      text: "topic one",
      messageId: "m-1",
    });
    assert.equal(first.status, "completed");

    const second = await orchestrator.orchestrate({
      sessionId: "session-repair-1",
      userId: "user-1",
      text: "topic two",
      messageId: "m-2",
    });
    assert.equal(second.status, "completed");

    const repair = await orchestrator.orchestrate({
      sessionId: "session-repair-1",
      userId: "user-1",
      text: "explain more",
      messageId: "m-3",
    });

    assert.equal(repair.status, "repair_question");
    assert.match(repair.assistantMessageId, /^msg_a_/);
    assert.deepEqual(repair.options.map((option) => option.id), ["A", "B"]);
    assert.equal(repair.question, "Which path should I continue?");
    assert.notEqual(repair.correlationId, "attacker-correlation");
    assert.equal(repair.options.some((option) => option.threadId === "attacker-thread"), false);

    const phrasingCall = providerCalls.find(
      (call) =>
        typeof call.prompt === "string" &&
        call.prompt.includes("Respond with ONLY this JSON shape"),
    );
    assert.ok(phrasingCall);
    assert.equal(phrasingCall.providerId, "provider-x");
    assert.equal(phrasingCall.model, "model-y");
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
});

test("repair phrasing fallback is deterministic when provider phrasing fails", async () => {
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = (callback, interval, ...args) => {
    const timer = originalSetInterval(callback, interval, ...args);
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }
    return timer;
  };

  try {
    const { orchestrator } = createHarness({ throwOnRepairPhrasing: true });

    await orchestrator.orchestrate({
      sessionId: "session-repair-2",
      userId: "user-1",
      text: "topic one",
      messageId: "m-1",
    });
    await orchestrator.orchestrate({
      sessionId: "session-repair-2",
      userId: "user-1",
      text: "topic two",
      messageId: "m-2",
    });

    const repair = await orchestrator.orchestrate({
      sessionId: "session-repair-2",
      userId: "user-1",
      text: "explain more",
      messageId: "m-3",
    });

    assert.equal(repair.status, "repair_question");
    assert.match(repair.assistantMessageId, /^msg_a_/);
    assert.equal(repair.question, "I'm not sure which topic you mean. Could you pick one?");
    assert.deepEqual(repair.options.map((option) => option.id), ["A", "B"]);

    const selection = await orchestrator.handleRepairSelectionEvent({
      sessionId: "session-repair-2",
      selection: "A",
      correlationId: repair.correlationId,
    });

    assert.equal(selection.status, "completed");
    assert.ok(repair.options.some((option) => option.threadId === selection.selectedThreadId));
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
});
