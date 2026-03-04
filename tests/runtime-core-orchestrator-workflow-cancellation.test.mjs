import test from "node:test";
import assert from "node:assert/strict";

import { createApprovalStore } from "../packages/polar-runtime-core/src/approval-store.mjs";
import { createOrchestrator } from "../packages/polar-runtime-core/src/orchestrator.mjs";
import { WORKFLOW_TEMPLATES } from "../packages/polar-runtime-core/src/workflow-templates.mjs";

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

test("in-flight cancellation stops subsequent workflow steps and emits cancellation lineage", async () => {
  await withUnrefedIntervals(async () => {
    const templateId = "cancel_after_first_step_test";
    const previousTemplate = WORKFLOW_TEMPLATES[templateId];
    WORKFLOW_TEMPLATES[templateId] = {
      id: templateId,
      description: "Two-step workflow used to validate in-flight cancellation behavior",
      schema: {
        required: ["query"],
        optional: [],
      },
      steps: (args) => [
        {
          extensionId: "web",
          extensionType: "mcp",
          capabilityId: "search_web",
          args: { query: args.query },
        },
        {
          extensionId: "web",
          extensionType: "mcp",
          capabilityId: "summarize_page",
          args: { url: "https://example.com" },
        },
      ],
    };

    const appendedMessages = [];
    const lineageEvents = [];
    const executedCapabilities = [];
    let orchestrator;
    let activeWorkflowId = null;
    let cancelResponse = null;

    orchestrator = createOrchestrator({
      profileResolutionGateway: {
        async resolve() {
          return {
            profileConfig: {
              systemPrompt: "You are a test assistant.",
              modelPolicy: { providerId: "test-provider", modelId: "test-model" },
              allowedSkills: ["web"],
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
        async generate({ prompt }) {
          if (typeof prompt === "string" && prompt.includes("Analyze these execution results")) {
            return { text: "summary" };
          }
          return {
            text: `<polar_action>${JSON.stringify({
              template: templateId,
              args: { query: "polar cancellation" },
            })}</polar_action>`,
          };
        },
      },
      extensionGateway: {
        getState(extensionId) {
          if (extensionId !== "web") {
            return undefined;
          }
          return {
            extensionId: "web",
            lifecycleState: "enabled",
            capabilities: [
              { capabilityId: "search_web", riskLevel: "destructive", sideEffects: "none" },
              { capabilityId: "summarize_page", riskLevel: "destructive", sideEffects: "none" },
            ],
          };
        },
        listStates() {
          return [this.getState("web")];
        },
        async execute(request) {
          executedCapabilities.push(request.capabilityId);
          if (request.capabilityId === "search_web" && activeWorkflowId) {
            cancelResponse = await orchestrator.cancelWorkflow(activeWorkflowId);
          }
          return { status: "completed", output: `ok:${request.capabilityId}` };
        },
      },
      approvalStore: createApprovalStore(),
      gateway: {
        async getConfig() {
          return { status: "not_found" };
        },
      },
      lineageStore: {
        async append(event) {
          lineageEvents.push(event);
        },
      },
      now: Date.now,
    });

    try {
      const proposed = await orchestrator.orchestrate({
        sessionId: "session-cancel-in-flight",
        userId: "user-cancel-in-flight",
        text: "run cancellation integration workflow",
        messageId: "m-cancel-1",
      });
      assert.equal(proposed.status, "workflow_proposed");

      activeWorkflowId = proposed.workflowId;
      const executed = await orchestrator.executeWorkflow(proposed.workflowId);

      assert.equal(cancelResponse?.status, "cancellation_requested");
      assert.equal(cancelResponse?.phase, "in_flight");
      assert.equal(executed.status, "cancelled");
      assert.deepEqual(executedCapabilities, ["search_web"]);

      const cancelledEvent = lineageEvents.find(
        (event) => event?.eventType === "workflow.execution.cancelled",
      );
      assert.ok(cancelledEvent);
      assert.equal(cancelledEvent.sessionId, "session-cancel-in-flight");
      assert.equal(cancelledEvent.workflowId, proposed.workflowId);
      assert.equal(typeof cancelledEvent.threadId, "string");
      assert.equal(typeof cancelledEvent.runId, "string");
      assert.equal(cancelledEvent.runId.length > 0, true);
    } finally {
      if (previousTemplate) {
        WORKFLOW_TEMPLATES[templateId] = previousTemplate;
      } else {
        delete WORKFLOW_TEMPLATES[templateId];
      }
    }
  });
});
