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
                  description: "Writer agent",
                },
              ],
            },
          };
        }
        return undefined;
      },
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

  assert.equal(second.status, "workflow_proposed");
  assert.equal(callIndex, 1);
  assert.equal(second.steps[0].capabilityId, "delegate_to_agent");
  assert.equal(second.steps[0].args.agentId, "@writer");

  const consumedEvent = lineageEvents.find((event) => event?.eventType === "routing.pending_state.consumed");
  assert.ok(consumedEvent);
  assert.equal(consumedEvent.selectionIntent, "delegate");
});

test("hybrid router executes authoritative tool action without second model planning call", async () => {
  const providerCalls = [];
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
              decision: "tool",
              target: {
                extensionId: "weather",
                capabilityId: "lookup_weather",
              },
              confidence: 0.92,
              rationale: "weather request",
              references: { refersTo: "latest", refersToReason: "explicit weather intent" },
            }),
          };
        }
        return { text: "summary" };
      },
    },
    extensionGateway: {
      getState(extensionId) {
        if (extensionId === "system") {
          return {
            extensionId: "system",
            lifecycleState: "installed",
            capabilities: [
              { capabilityId: "lookup_weather", riskLevel: "read", sideEffects: "none" },
            ],
          };
        }
        return undefined;
      },
      listStates() {
        return [
          {
            extensionId: "weather",
            lifecycleState: "installed",
            capabilities: [{ capabilityId: "lookup_weather" }],
          },
        ];
      },
      async execute() {
        return { status: "completed", output: "Sunny 18C" };
      },
    },
    approvalStore: createApprovalStore(),
    now: Date.now,
  });

  const result = await orchestrator.orchestrate({
    sessionId: "session-hybrid-tool",
    userId: "user-hybrid-tool",
    text: "weather in Swansea",
    messageId: "m-hybrid-tool-1",
    metadata: { threadKey: "root:2" },
  });

  assert.equal(result.status, "completed");
  assert.equal(
    providerCalls.some((call) => typeof call.system === "string" && call.system.includes("MULTI-AGENT ORCHESTRATION ENGINE")),
    false,
  );
});

test("hybrid router asks deterministic clarification when workflow decision lacks executable template details", async () => {
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
      async generate() {
        callIndex += 1;
        return {
          text: JSON.stringify({
            decision: "workflow",
            confidence: 0.95,
            rationale: "needs workflow",
            references: { refersTo: "latest", refersToReason: "explicit workflow ask" },
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
    now: Date.now,
  });

  const result = await orchestrator.orchestrate({
    sessionId: "session-hybrid-workflow-clarify",
    userId: "user-hybrid-workflow-clarify",
    text: "run a workflow",
    messageId: "m-hybrid-workflow-1",
    metadata: { threadKey: "root:3" },
  });

  assert.equal(result.type, "clarification_needed");
  assert.match(result.text, /which workflow should I run/i);
  assert.equal(callIndex, 1);
});

test("hybrid router falls back safely on malformed router output and records fallback telemetry", async () => {
  const lineageEvents = [];

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
      async generate() {
        return { text: "this is not json" };
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

  const result = await orchestrator.orchestrate({
    sessionId: "session-hybrid-malformed-router",
    userId: "user-hybrid-malformed-router",
    text: "do that again",
    messageId: "m-hybrid-malformed-router-1",
    metadata: { threadKey: "root:4" },
  });

  assert.equal(result.type, "clarification_needed");

  const routingEvent = lineageEvents.find((event) => event?.eventType === "routing.arbitration");
  assert.ok(routingEvent);
  assert.equal(routingEvent.router_invoked, true);
  assert.equal(routingEvent.proposal_valid, false);
  assert.equal(routingEvent.fallback_reason, "schema_invalid");
});

test("hybrid router clamps unknown targets with deterministic policy veto telemetry", async () => {
  const lineageEvents = [];

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
        if (typeof input?.system === "string" && input.system.includes("routing model")) {
          return {
            text: JSON.stringify({
              decision: "tool",
              target: { extensionId: "unknown", capabilityId: "not_installed" },
              confidence: 0.97,
              rationale: "tool request",
              references: { refersTo: "latest", refersToReason: "explicit ask" },
            }),
          };
        }
        return { text: "ok" };
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

  const result = await orchestrator.orchestrate({
    sessionId: "session-hybrid-veto",
    userId: "user-hybrid-veto",
    text: "do that again with the special tool",
    messageId: "m-hybrid-veto-1",
    metadata: { threadKey: "root:5" },
  });

  assert.equal(result.type, "clarification_needed");
  const routingEvent = lineageEvents.find((event) => event?.eventType === "routing.arbitration");
  assert.ok(routingEvent);
  assert.equal(routingEvent.router_invoked, true);
  assert.ok(Array.isArray(routingEvent.policy_vetoes));
  assert.equal(routingEvent.policy_vetoes.includes("unknown_tool_target"), true);
  assert.equal(routingEvent.fallback_reason, "unknown_target");
});
