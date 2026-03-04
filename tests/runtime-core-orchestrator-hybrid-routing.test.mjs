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
  assert.equal(callIndex >= 1, true);

  const second = await orchestrator.orchestrate({
    sessionId: "session-hybrid-clarify",
    userId: "user-hybrid-clarify",
    text: "B",
    messageId: "m-hybrid-2",
    metadata: { threadKey: "root:1" },
  });

  assert.equal(second.status, "workflow_proposed");
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


test("hybrid router integrates focus resolver ranking into routing telemetry", async () => {
  const lineageEvents = [];
  let focusCandidates = [];

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
        if (typeof input?.system === "string" && input.system.includes("focus/thread resolver")) {
          const payload = JSON.parse(input.prompt.slice(input.prompt.indexOf("{") ));
          focusCandidates = payload.candidates;
          return {
            text: JSON.stringify({
              confidence: 0.91,
              refersTo: "temporal_attention",
              candidates: [
                {
                  anchorId: payload.candidates[1].anchorId,
                  threadKey: payload.candidates[1].threadKey,
                  score: 0.89,
                  reason: "most recent relevant task",
                },
                {
                  anchorId: payload.candidates[0].anchorId,
                  threadKey: payload.candidates[0].threadKey,
                  score: 0.35,
                  reason: "older thread",
                },
              ],
              needsClarification: false,
            }),
          };
        }
        if (typeof input?.system === "string" && input.system.includes("routing model")) {
          return {
            text: JSON.stringify({
              decision: "delegate",
              target: { agentId: "@writer" },
              confidence: 0.86,
              rationale: "delegate requested",
              references: { refersTo: "focus_anchor", refersToReason: "ambiguous follow-up" },
              scores: { respond: 0.1, delegate: 0.86, tool: 0.05, workflow: 0.08, clarify: 0.1 },
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
    gateway: {
      readConfigRecord(resourceType, resourceId) {
        if (resourceType === "policy" && resourceId === "agent-registry:default") {
          return {
            resourceType,
            resourceId,
            version: 1,
            config: {
              version: 1,
              agents: [{ agentId: "@writer", profileId: "profile.writer", description: "Writer" }],
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

  await orchestrator.orchestrate({
    sessionId: "session-focus-telemetry",
    userId: "user-focus-telemetry",
    text: "draft project update",
    messageId: "m-focus-1",
    metadata: { threadKey: "root:focus" },
  });

  await orchestrator.orchestrate({
    sessionId: "session-focus-telemetry",
    userId: "user-focus-telemetry",
    text: "collect notes",
    messageId: "m-focus-2",
    metadata: { threadKey: "root:focus" },
  });

  const result = await orchestrator.orchestrate({
    sessionId: "session-focus-telemetry",
    userId: "user-focus-telemetry",
    text: "do that again",
    messageId: "m-focus-3",
    metadata: { threadKey: "root:focus" },
  });

  assert.equal(result.status, "workflow_proposed");
  assert.ok(focusCandidates.length >= 2);

  const routingEvent = lineageEvents.filter((event) => event?.eventType === "routing.arbitration").at(-1);
  assert.ok(routingEvent);
  assert.equal(routingEvent.focus_resolver_invoked, true);
  assert.equal(routingEvent.focus_resolver_proposal_valid, true);
  assert.ok(Array.isArray(routingEvent.focus_resolver_candidate_ranking));
  assert.equal(routingEvent.focus_resolver_candidate_ranking.length >= 1, true);
});

test("hybrid router clarifies when focus candidates are too close under low confidence", async () => {
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
        if (typeof input?.system === "string" && input.system.includes("focus/thread resolver")) {
          const payload = JSON.parse(input.prompt.slice(input.prompt.indexOf("{")));
          return {
            text: JSON.stringify({
              confidence: 0.58,
              refersTo: "temporal_attention",
              candidates: [
                {
                  anchorId: payload.candidates[0].anchorId,
                  threadKey: payload.candidates[0].threadKey,
                  score: 0.62,
                  reason: "close candidate A",
                },
                {
                  anchorId: payload.candidates[1].anchorId,
                  threadKey: payload.candidates[1].threadKey,
                  score: 0.58,
                  reason: "close candidate B",
                },
              ],
              needsClarification: false,
            }),
          };
        }
        if (typeof input?.system === "string" && input.system.includes("routing model")) {
          return {
            text: JSON.stringify({
              decision: "delegate",
              target: { agentId: "@writer" },
              confidence: 0.88,
              rationale: "delegate requested",
              references: { refersTo: "focus_anchor", refersToReason: "ambiguous follow-up" },
              scores: { respond: 0.1, delegate: 0.88, tool: 0.05, workflow: 0.08, clarify: 0.1 },
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
    gateway: {
      readConfigRecord(resourceType, resourceId) {
        if (resourceType === "policy" && resourceId === "agent-registry:default") {
          return {
            resourceType,
            resourceId,
            version: 1,
            config: {
              version: 1,
              agents: [{ agentId: "@writer", profileId: "profile.writer", description: "Writer" }],
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

  await orchestrator.orchestrate({
    sessionId: "session-focus-ambiguity",
    userId: "user-focus-ambiguity",
    text: "draft project update",
    messageId: "m-focus-amb-1",
    metadata: { threadKey: "root:focus-ambiguity" },
  });

  await orchestrator.orchestrate({
    sessionId: "session-focus-ambiguity",
    userId: "user-focus-ambiguity",
    text: "collect notes",
    messageId: "m-focus-amb-2",
    metadata: { threadKey: "root:focus-ambiguity" },
  });

  const result = await orchestrator.orchestrate({
    sessionId: "session-focus-ambiguity",
    userId: "user-focus-ambiguity",
    text: "do that again",
    messageId: "m-focus-amb-3",
    metadata: { threadKey: "root:focus-ambiguity" },
  });

  assert.equal(result.type, "clarification_needed");
  const routingEvent = lineageEvents.filter((entry) => entry?.eventType === "routing.arbitration").at(-1);
  assert.ok(routingEvent);
  assert.equal(routingEvent.focus_resolver_ambiguous, true);
  assert.equal(routingEvent.fallback_reason, "focus_ambiguity");
  assert.equal(typeof routingEvent.focus_resolver_score_gap, "number");
  assert.equal(routingEvent.focus_resolver_score_gap < 0.2, true);
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
