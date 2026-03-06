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
  assert.equal(proposed.steps[0].capabilityId, "delegate_to_agent");
  assert.equal(proposed.steps[0].args.agentId, "@writer");
  assert.equal(
    providerCalls.some(
      (call) =>
        typeof call.system === "string" &&
        call.system.includes("You are a routing model. Output strict JSON only."),
    ),
    true,
  );

  const executed = await orchestrator.executeWorkflow(proposed.workflowId);
  assert.equal(executed.status, "completed");
  const diagnostics = await orchestrator.getThreadStateDiagnostics({
    sessionId: "session-agent-1",
  });
  const workflowRun = diagnostics.workflowRuns.find(
    (run) => run.workflowId === proposed.workflowId,
  );
  assert.ok(workflowRun);
  assert.equal(workflowRun.status, "completed");
  assert.equal(workflowRun.progress, 100);

  const delegationEvent = lineageEvents.find(
    (event) => event?.eventType === "delegation.activated",
  );
  assert.ok(delegationEvent);
  assert.equal(delegationEvent.profileId, "profile.writer");
  assert.deepEqual(delegationEvent.allowedSkills, ["web"]);
  assert.equal(delegationEvent.modelId, "claude-sonnet-4-6");
  assert.equal(delegationEvent.providerId, "anthropic");

  // Successful single-step delegation now completes with deterministic summary text
  // and does not require a second "Analyze these execution results" provider roundtrip.
  const summaryCall = providerCalls.find(
    (call) =>
      typeof call.prompt === "string" &&
      call.prompt.includes("Analyze these execution results"),
  );
  assert.equal(summaryCall, undefined);
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

test("orchestrator falls back to default generic sub-agent when router suggests unknown agent", async () => {
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
        return {
          text: JSON.stringify({
            decision: "delegate",
            target: { agentId: "@unknown_agent" },
            confidence: 0.9,
            rationale: "delegate",
            references: { refersTo: "latest", refersToReason: "complex task" },
          }),
        };
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

  const proposed = await orchestrator.orchestrate({
    sessionId: "session-default-generic",
    userId: "user-default-generic",
    text: "write 10 versions of this email",
    messageId: "m-default-generic",
  });
  assert.equal(proposed.status, "workflow_proposed");
  assert.equal(proposed.steps[0].capabilityId, "delegate_to_agent");
  assert.equal(proposed.steps[0].args.agentId, "@generic_sub_agent");
  // Focus resolver and router can each invoke provider once before deterministic clamp.
  assert.equal(providerCalls.length >= 1, true);
});
