import test from "node:test";
import assert from "node:assert/strict";

import { createApprovalStore, createOrchestrator } from "../packages/polar-runtime-core/src/index.mjs";

test("orchestrator includes registered agents in context and clamps delegated model/skills by delegated profile", async () => {
  const appendedMessages = [];
  const lineageEvents = [];
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
    lineageStore: {
      async append(event) {
        lineageEvents.push(event);
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

  const mainCall = providerCalls.find((call) => typeof call.system === "string" && call.system.includes("Available pre-configured sub-agents"));
  assert.ok(mainCall);
  assert.match(mainCall.system, /@writer/);
  assert.match(mainCall.system, /Writes docs/);

  const executed = await orchestrator.executeWorkflow(proposed.workflowId);
  assert.equal(executed.status, "completed");

  const delegationEvent = lineageEvents.find(
    (event) => event?.eventType === "delegation.activated",
  );
  assert.ok(delegationEvent);
  assert.equal(delegationEvent.profileId, "profile.writer");
  assert.deepEqual(delegationEvent.allowedSkills, ["web"]);
  assert.equal(delegationEvent.modelId, "claude-sonnet-4-6");
  assert.equal(delegationEvent.providerId, "anthropic");

  const summaryCall = providerCalls.find(
    (call) =>
      typeof call.prompt === "string" &&
      call.prompt.includes("Analyze these execution results"),
  );
  assert.ok(summaryCall);
  assert.equal(summaryCall.providerId, "anthropic");
  assert.equal(summaryCall.model, "claude-sonnet-4-6");
});


test("orchestrator asks a short clarification question when router confidence is below threshold", async () => {
  const appendedMessages = [];
  let callIndex = 0;

  const orchestrator = createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          status: "resolved",
          profileConfig: {
            systemPrompt: "You are the parent profile.",
            modelPolicy: { providerId: "openai", modelId: "gpt-4.1-mini" },
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
        callIndex += 1;
        if (callIndex === 1) {
          return {
            text: JSON.stringify({
              decision: "delegate",
              target: { agentId: "@writer" },
              confidence: 0.42,
              rationale: "ambiguous",
              references: { refersTo: "focus_anchor", refersToReason: "ambiguous" },
            }),
          };
        }
        return { text: "This should not be called for low confidence routing." };
      },
    },
    extensionGateway: {
      getState() { return undefined; },
      listStates() { return []; },
      async execute() { return { status: "completed", output: "ok" }; },
    },
    approvalStore: createApprovalStore(),
    now: Date.now,
  });

  const result = await orchestrator.orchestrate({
    sessionId: "session-router-low-confidence",
    userId: "user-router-low-confidence",
    text: "do that via sub-agent",
    messageId: "m-router-low-confidence",
  });

  assert.equal(result.type, "clarification_needed");
  assert.match(result.text, /Quick check:/);
  assert.equal(callIndex, 1);
  const assistantMessage = appendedMessages.find((message) => message.role === "assistant");
  assert.ok(assistantMessage);
});

test("orchestrator includes default generic fallback sub-agent in model context", async () => {
  const providerCalls = [];

  const orchestrator = createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          status: "resolved",
          profileConfig: {
            systemPrompt: "You are the parent profile.",
            modelPolicy: { providerId: "openai", modelId: "gpt-4.1-mini" },
          },
        };
      },
    },
    chatManagementGateway: {
      async appendMessage() { return { status: "appended" }; },
      async getSessionHistory() { return { items: [] }; },
    },
    providerGateway: {
      async generate(input) {
        providerCalls.push(input);
        if (providerCalls.length === 1) {
          return {
            text: JSON.stringify({
              decision: "respond",
              confidence: 0.9,
              rationale: "simple",
              references: { refersTo: "latest", refersToReason: "simple" },
            }),
          };
        }
        return { text: "Got it." };
      },
    },
    extensionGateway: {
      getState() { return undefined; },
      listStates() { return []; },
      async execute() { return { status: "completed", output: "ok" }; },
    },
    approvalStore: createApprovalStore(),
    gateway: {
      readConfigRecord() {
        return undefined;
      },
    },
    now: Date.now,
  });

  await orchestrator.orchestrate({
    sessionId: "session-default-generic",
    userId: "user-default-generic",
    text: "write 10 versions of this email",
    messageId: "m-default-generic",
  });

  const mainCall = providerCalls[1];
  assert.ok(mainCall);
  assert.match(mainCall.system, /@generic_sub_agent/);
});
