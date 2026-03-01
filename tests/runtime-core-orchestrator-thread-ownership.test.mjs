import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

import { createOrchestrator } from "../packages/polar-runtime-core/src/orchestrator.mjs";
import { createApprovalStore } from "../packages/polar-runtime-core/src/approval-store.mjs";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("orchestrator keeps workflow ownership on proposal thread across active-thread drift", async () => {
  const originalRandomUuid = crypto.randomUUID;
  const originalSetInterval = globalThis.setInterval;
  let uuidCounter = 0;
  crypto.randomUUID = () => `id-${++uuidCounter}`;
  globalThis.setInterval = (callback, interval, ...args) => {
    const timer = originalSetInterval(callback, interval, ...args);
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }
    return timer;
  };

  const appendedMessages = [];
  const extensionExecutions = [];
  const providerCalls = [];

  const chatManagementGateway = {
    async appendMessage(message) {
      appendedMessages.push(message);
      return { status: "appended" };
    },
    async getSessionHistory({ sessionId, limit = 100 }) {
      const items = appendedMessages
        .filter((message) => message.sessionId === sessionId)
        .map((message) => ({
          role: message.role,
          text: message.text,
        }));
      return { items: items.slice(-limit) };
    },
  };

  const providerGateway = {
    async generate(request) {
      providerCalls.push(request);
      if (typeof request.prompt === "string" && request.prompt.includes("Analyze these execution results")) {
        return { text: "Execution summary." };
      }
      if (request.prompt === "Send an email to Bob") {
        return {
          text: [
            "I can do that.",
            "<polar_action>",
            JSON.stringify({
              template: "send_email",
              args: {
                to: "bob@example.com",
                subject: "Hi",
                body: "Hello",
              },
            }),
            "</polar_action>",
          ].join("\n"),
        };
      }
      if (request.prompt === "Start a different task") {
        return { text: "Sure, starting something else." };
      }
      if (request.prompt === "what failed?") {
        return { text: "The send failed at the email step." };
      }
      return { text: "ok" };
    },
  };

  const extensionGateway = {
    getState(extensionId) {
      if (extensionId !== "email") {
        return undefined;
      }
      return {
        extensionId: "email",
        lifecycleState: "enabled",
        capabilities: [
          {
            capabilityId: "send_email",
            riskLevel: "write",
            sideEffects: "external",
          },
        ],
      };
    },
    listStates() {
      return [
        {
          extensionId: "email",
          lifecycleState: "enabled",
          capabilities: [
            {
              capabilityId: "send_email",
              riskLevel: "write",
              sideEffects: "external",
            },
          ],
        },
      ];
    },
    async execute(request) {
      extensionExecutions.push(request);
      return { status: "failed", error: "SMTP unavailable" };
    },
  };

  const orchestrator = createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          profileConfig: {
            systemPrompt: "You are a test assistant.",
            modelPolicy: { providerId: "test-provider", modelId: "test-model" },
            allowedSkills: ["email"],
          },
        };
      },
    },
    chatManagementGateway,
    providerGateway,
    extensionGateway,
    approvalStore: createApprovalStore(),
    gateway: {
      async getConfig() {
        return { status: "not_found" };
      },
    },
    now: Date.now,
  });

  try {
    const proposed = await orchestrator.orchestrate({
      sessionId: "session-1",
      userId: "user-1",
      text: "Send an email to Bob",
      messageId: "m-1",
    });

    assert.equal(proposed.status, "workflow_proposed");
    assert.equal(proposed.workflowId, "id-3");
    assert.match(proposed.assistantMessageId, /^msg_a_/);

    const driftTurn = await orchestrator.orchestrate({
      sessionId: "session-1",
      userId: "user-1",
      text: "Start a different task",
      messageId: "m-2",
    });
    assert.equal(driftTurn.status, "completed");

    const executed = await orchestrator.executeWorkflow(proposed.workflowId);
    assert.equal(executed.status, "completed");
    assert.equal(extensionExecutions.length, 1);
    assert.match(executed.text, /^### 🛠️ Execution Results\n/);
    assert.match(executed.text, /❌ \*\*send_email\*\*: SMTP unavailable/);
    assert.match(executed.text, /Execution summary\./);

    const toolResultsLog = appendedMessages
      .filter((message) => message.role === "system" && typeof message.text === "string" && message.text.startsWith("[TOOL RESULTS]"))
      .at(-1);

    assert.ok(toolResultsLog);
    assert.match(toolResultsLog.text, /threadId=id-1/);
    assert.doesNotMatch(toolResultsLog.text, /threadId=id-4/);
    const runIdMatch = toolResultsLog.text.match(/runId=(run_[^\s]+)/);
    assert.ok(runIdMatch);
    const runId = runIdMatch[1];

    const followUp = await orchestrator.orchestrate({
      sessionId: "session-1",
      userId: "user-1",
      text: "what failed?",
      messageId: "m-3",
    });

    assert.equal(followUp.status, "completed");
    assert.equal(followUp.useInlineReply, true);
    assert.match(followUp.anchorMessageId, /^msg_err_/);

    const followUpProviderCall = providerCalls.find((call) => call.prompt === "what failed?");
    assert.ok(followUpProviderCall);
    assert.match(followUpProviderCall.system, new RegExp(`\"runId\":\\s*\"${escapeRegExp(runId)}\"`));
    assert.match(followUpProviderCall.system, new RegExp(`\"workflowId\":\\s*\"${escapeRegExp(proposed.workflowId)}\"`));
    assert.match(followUpProviderCall.system, /"threadId":\s*"id-1"/);
  } finally {
    crypto.randomUUID = originalRandomUuid;
    globalThis.setInterval = originalSetInterval;
  }
});
