import test from "node:test";
import assert from "node:assert/strict";

import { createApprovalStore, createOrchestrator } from "../packages/polar-runtime-core/src/index.mjs";

test("orchestrator includes registered agents in context and clamps delegated model/skills by delegated profile", async () => {
  const appendedMessages = [];
  const providerCalls = [];

  const orchestrator = createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          status: "resolved",
          profileConfig: {
            systemPrompt: "You are the parent profile.",
            modelPolicy: { providerId: "openai", modelId: "gpt-4.1-mini" },
            allowedSkills: ["web", "email"],
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
      async generate(input) {
        providerCalls.push(input);
        if (
          typeof input.prompt === "string" &&
          input.prompt.includes("Analyze these execution results")
        ) {
          return { text: "delegation summary" };
        }
        return {
          text: `<polar_action>{"template":"delegate_to_agent","args":{"agentId":"@writer","task_instructions":"Write docs","forward_skills":["web","email"],"model_override":"gpt-4.1-mini"}}</polar_action>`,
        };
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
      readConfigRecord(resourceType, resourceId) {
        if (resourceType === "policy" && resourceId === "agent-registry:default") {
          return {
            resourceType,
            resourceId,
            version: 1,
            config: {
              version: 1,
              agents: [
                {
                  agentId: "@writer",
                  profileId: "profile.writer",
                  description: "Writes docs",
                  allowedForwardSkills: ["web"],
                },
              ],
            },
          };
        }
        if (resourceType === "profile" && resourceId === "profile.writer") {
          return {
            resourceType,
            resourceId,
            version: 1,
            config: {
              systemPrompt: "You are writer sub-agent.",
              modelPolicy: { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
              allowedSkills: ["web"],
            },
          };
        }
        return undefined;
      },
    },
    now: Date.now,
  });

  const proposed = await orchestrator.orchestrate({
    sessionId: "session-agent-1",
    userId: "user-agent-1",
    text: "Please delegate to writer",
    messageId: "m-agent-1",
  });
  assert.equal(proposed.status, "workflow_proposed");

  const firstCall = providerCalls[0];
  assert.match(firstCall.system, /Available pre-configured sub-agents/);
  assert.match(firstCall.system, /@writer/);
  assert.match(firstCall.system, /Writes docs/);

  const executed = await orchestrator.executeWorkflow(proposed.workflowId);
  assert.equal(executed.status, "completed");

  const delegationMessage = appendedMessages.find(
    (message) =>
      message.role === "system" &&
      typeof message.text === "string" &&
      message.text.startsWith("[DELEGATION ACTIVE]"),
  );
  assert.ok(delegationMessage);
  const payload = JSON.parse(
    delegationMessage.text.replace("[DELEGATION ACTIVE]", "").trim(),
  );
  assert.equal(payload.profileId, "profile.writer");
  assert.deepEqual(payload.forward_skills, ["web"]);
  assert.equal(payload.model_override, "claude-sonnet-4-6");
  assert.equal(payload.pinnedProvider, "anthropic");

  const summaryCall = providerCalls.find(
    (call) =>
      typeof call.prompt === "string" &&
      call.prompt.includes("Analyze these execution results"),
  );
  assert.ok(summaryCall);
  assert.equal(summaryCall.providerId, "anthropic");
  assert.equal(summaryCall.model, "claude-sonnet-4-6");
});
