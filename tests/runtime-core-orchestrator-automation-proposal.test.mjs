import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrator } from "../packages/polar-runtime-core/src/orchestrator.mjs";
import { createApprovalStore } from "../packages/polar-runtime-core/src/approval-store.mjs";

async function withUnrefedIntervals(run) {
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = (callback, interval, ...args) => {
    const timer = originalSetInterval(callback, interval, ...args);
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }
    return timer;
  };
  try {
    await run();
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
}

test("orchestrator proposes chat-configured automation and requires explicit consume", async () => {
  await withUnrefedIntervals(async () => {
    const appendedMessages = [];
    let providerGenerateCalls = 0;
    const orchestrator = createOrchestrator({
      profileResolutionGateway: {
        async resolve() {
          return {
            profileConfig: {
              systemPrompt: "You are a test assistant.",
              modelPolicy: { providerId: "test-provider", modelId: "test-model" },
            },
          };
        },
      },
      chatManagementGateway: {
        async appendMessage(message) {
          appendedMessages.push(message);
          return { status: "appended" };
        },
        async getSessionHistory() {
          return { items: [] };
        },
      },
      providerGateway: {
        async generate() {
          providerGenerateCalls += 1;
          return { text: "should not be called for deterministic automation proposal" };
        },
      },
      extensionGateway: {
        getState() {
          return undefined;
        },
        listStates() {
          return [];
        },
        async execute() {
          return { status: "completed", output: "ok" };
        },
      },
      approvalStore: createApprovalStore(),
      gateway: {
        async getConfig() {
          return { status: "not_found" };
        },
      },
      now: Date.now,
    });

    const proposal = await orchestrator.orchestrate({
      sessionId: "session-auto-1",
      userId: "user-auto-1",
      text: "Remind me daily at 6pm to stretch.",
      messageId: "m-auto-1",
    });

    assert.equal(proposal.status, "automation_proposed");
    assert.equal(proposal.proposal.schedule, "daily at 18:00");
    assert.match(proposal.proposal.promptTemplate, /^Reminder:/);
    assert.equal(providerGenerateCalls, 0);

    const consumed = await orchestrator.consumeAutomationProposal(proposal.proposalId);
    assert.equal(consumed.status, "found");
    assert.equal(consumed.proposal.schedule, "daily at 18:00");
    assert.equal(consumed.proposal.sessionId, "session-auto-1");
    assert.equal(consumed.proposal.userId, "user-auto-1");

    const consumedAgain = await orchestrator.consumeAutomationProposal(proposal.proposalId);
    assert.equal(consumedAgain.status, "not_found");

    const assistantMessages = appendedMessages.filter((msg) => msg.role === "assistant");
    assert.equal(assistantMessages.length, 1);
    assert.match(assistantMessages[0].text, /Approve to create the job/);
  });
});

test("orchestrator rejects pending automation proposal by id", async () => {
  await withUnrefedIntervals(async () => {
    const orchestrator = createOrchestrator({
      profileResolutionGateway: {
        async resolve() {
          return {
            profileConfig: {
              systemPrompt: "You are a test assistant.",
              modelPolicy: { providerId: "test-provider", modelId: "test-model" },
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
        async generate() {
          return { text: "noop" };
        },
      },
      extensionGateway: {
        getState() {
          return undefined;
        },
        listStates() {
          return [];
        },
        async execute() {
          return { status: "completed", output: "ok" };
        },
      },
      approvalStore: createApprovalStore(),
      gateway: {
        async getConfig() {
          return { status: "not_found" };
        },
      },
      now: Date.now,
    });

    const proposal = await orchestrator.orchestrate({
      sessionId: "session-auto-2",
      userId: "user-auto-2",
      text: "Notify me every 2 hours to hydrate.",
      messageId: "m-auto-2",
    });

    assert.equal(proposal.status, "automation_proposed");

    const rejected = await orchestrator.rejectAutomationProposal(proposal.proposalId);
    assert.equal(rejected.status, "rejected");

    const consumed = await orchestrator.consumeAutomationProposal(proposal.proposalId);
    assert.equal(consumed.status, "not_found");
  });
});

test("orchestrator proposes inbox-check automation with safe defaults", async () => {
  await withUnrefedIntervals(async () => {
    const orchestrator = createOrchestrator({
      profileResolutionGateway: {
        async resolve() {
          return {
            profileConfig: {
              systemPrompt: "You are a test assistant.",
              modelPolicy: { providerId: "test-provider", modelId: "test-model" },
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
        async generate() {
          return { text: "noop" };
        },
      },
      extensionGateway: {
        getState() {
          return undefined;
        },
        listStates() {
          return [];
        },
        async execute() {
          return { status: "completed", output: "ok" };
        },
      },
      approvalStore: createApprovalStore(),
      gateway: {
        async getConfig() {
          return { status: "not_found" };
        },
      },
      now: Date.now,
    });

    const proposal = await orchestrator.orchestrate({
      sessionId: "session-auto-3",
      userId: "user-auto-3",
      text: "Check my inbox for important emails.",
      messageId: "m-auto-3",
    });

    assert.equal(proposal.status, "automation_proposed");
    assert.equal(proposal.proposal.templateType, "inbox_check");
    assert.equal(proposal.proposal.schedule, "every 1 hours");
    assert.equal(proposal.proposal.limits.maxNotificationsPerDay, 3);
    assert.deepEqual(proposal.proposal.limits.inbox.capabilities, ["mail.search_headers"]);
    assert.equal(proposal.proposal.quietHours.timezone, "UTC");
  });
});
