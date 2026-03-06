import test from "node:test";
import assert from "node:assert/strict";

import { createApprovalStore } from "../packages/polar-runtime-core/src/approval-store.mjs";
import { createOrchestrator } from "../packages/polar-runtime-core/src/orchestrator.mjs";

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

test("thread diagnostics expose pending workflow and session thread snapshots", async () => {
  await withUnrefedIntervals(async () => {
    const appendedMessages = [];
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
      chatManagementGateway: {
        async appendMessage(message) {
          appendedMessages.push(message);
          return { status: "appended" };
        },
        async getSessionHistory({ sessionId, limit = 100 }) {
          const items = appendedMessages
            .filter((message) => message.sessionId === sessionId)
            .map((message) => ({ role: message.role, text: message.text }));
          return { items: items.slice(-limit) };
        },
      },
      providerGateway: {
        async generate() {
          return {
            text: '<polar_action>{"template":"send_email","args":{"to":"dev@polar.local","subject":"hello","body":"world"}}</polar_action>',
          };
        },
      },
      extensionGateway: {
        getState() {
          return {
            extensionId: "email",
            lifecycleState: "enabled",
            capabilities: [{ capabilityId: "send_email", riskLevel: "write", sideEffects: "external" }],
          };
        },
        listStates() {
          return [this.getState("email")];
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

    const proposed = await orchestrator.orchestrate({
      sessionId: "session-thread-diag",
      userId: "user-thread-diag",
      text: "check weather",
      messageId: "m-thread-diag",
    });
    assert.equal(proposed.status, "workflow_proposed");

    const beforeCancel = await orchestrator.getThreadStateDiagnostics();
    assert.equal(beforeCancel.status, "ok");
    assert.equal(beforeCancel.pendingWorkflowCount, 1);
    assert.equal(beforeCancel.sessionCount >= 1, true);

    const sessionSnapshot = beforeCancel.sessions.find(
      (item) => item.sessionId === "session-thread-diag",
    );
    assert.ok(sessionSnapshot);
    assert.equal(sessionSnapshot.threadCount >= 1, true);

    const cancelled = await orchestrator.cancelWorkflow(proposed.workflowId);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.phase, "pending");

    const afterCancel = await orchestrator.getThreadStateDiagnostics({
      sessionId: "session-thread-diag",
    });
    assert.equal(afterCancel.status, "ok");
    assert.equal(afterCancel.pendingWorkflowCount, 0);
    assert.equal(afterCancel.sessionCount, 1);

    const proposedSecond = await orchestrator.orchestrate({
      sessionId: "session-thread-diag",
      userId: "user-thread-diag",
      text: "send status email",
      messageId: "m-thread-diag-2",
    });
    assert.equal(proposedSecond.status, "workflow_proposed");

    const completed = await orchestrator.executeWorkflow(proposedSecond.workflowId);
    assert.equal(completed.status, "completed");

    const afterExecution = await orchestrator.getThreadStateDiagnostics({
      sessionId: "session-thread-diag",
    });
    assert.equal(afterExecution.workflowRunCount >= 1, true);
    const completedRun = afterExecution.workflowRuns.find(
      (run) => run.workflowId === proposedSecond.workflowId,
    );
    assert.ok(completedRun);
    assert.equal(completedRun.status, "completed");
    assert.equal(completedRun.progress, 100);
  });
});
