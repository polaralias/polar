import test from "node:test";
import assert from "node:assert/strict";

import { createApprovalStore, createOrchestrator } from "../packages/polar-runtime-core/src/index.mjs";

function createSharedMemoryGateway() {
  const records = new Map();
  return {
    records,
    async get(request) {
      const row = records.get(request.memoryId);
      if (!row) return { status: "not_found" };
      return { status: "completed", record: row.record, metadata: row.metadata };
    },
    async upsert(request) {
      records.set(request.memoryId, {
        sessionId: request.sessionId,
        userId: request.userId,
        scope: request.scope,
        record: request.record,
        metadata: request.metadata ?? {},
      });
      return { status: "completed", memoryId: request.memoryId };
    },
    async search(request) {
      const query = String(request.query || "").toLowerCase();
      const filtered = [...records.values()].filter((row) => {
        if (row.sessionId !== request.sessionId || row.userId !== request.userId || row.scope !== request.scope) {
          return false;
        }
        if (!query) return true;
        const haystack = JSON.stringify({ record: row.record, metadata: row.metadata }).toLowerCase();
        return haystack.includes(query);
      });
      return {
        status: "completed",
        records: filtered.map((row, index) => ({
          memoryId: `row-${index}`,
          record: row.record,
          metadata: row.metadata,
        })),
      };
    },
  };
}

function createHarness({ memoryGateway, providerGateway, extensionGateway, messages, lineageEvents }) {
  return createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          status: "resolved",
          profileConfig: {
            systemPrompt: "You are a parent profile.",
            modelPolicy: { providerId: "openai", modelId: "gpt-4.1-mini" },
            allowedSkills: ["web", "email"],
          },
        };
      },
    },
    chatManagementGateway: {
      async appendMessage(message) {
        messages.push(message);
        return { status: "appended" };
      },
      async getSessionHistory({ sessionId, limit = 200 }) {
        const items = messages.filter((entry) => entry.sessionId === sessionId);
        return { items: items.slice(-limit) };
      },
    },
    providerGateway,
    extensionGateway,
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
        if (resourceType === "profile" && resourceId === "profile.writer") {
          return {
            resourceType,
            resourceId,
            version: 1,
            config: {
              allowedSkills: ["web"],
              modelPolicy: { providerId: "openai", modelId: "gpt-4.1-mini" },
            },
          };
        }
        return undefined;
      },
    },
    approvalStore: createApprovalStore(),
    memoryGateway,
    lineageStore: {
      async append(event) {
        lineageEvents.push(event);
      },
    },
    now: Date.now,
  });
}

test("durable routing pending state survives orchestrator restart and drives follow-up selection", async () => {
  const memoryGateway = createSharedMemoryGateway();
  const messages = [];
  const lineageEvents = [];
  const providerCalls = [];

  const providerGateway = {
    async generate(input) {
      providerCalls.push(input);
      if (typeof input.system === "string" && input.system.includes("routing model")) {
        return {
          text: JSON.stringify({
            decision: "delegate",
            target: { agentId: "@writer" },
            confidence: 0.42,
            rationale: "ambiguous pronoun",
            references: { refersTo: "focus_anchor", refersToReason: "ambiguous follow-up" },
          }),
        };
      }
      return { text: "ack" };
    },
  };

  const extensionGateway = {
    getState() { return undefined; },
    listStates() { return []; },
    async execute() { return { status: "completed", output: "ok" }; },
  };

  const first = createHarness({ memoryGateway, providerGateway, extensionGateway, messages, lineageEvents });
  const firstTurn = await first.orchestrate({
    sessionId: "session-durable-routing",
    userId: "u1",
    text: "do that via sub-agent",
    messageId: "m1",
    metadata: { threadKey: "root:1" },
  });
  assert.equal(firstTurn.type, "clarification_needed");

  const second = createHarness({ memoryGateway, providerGateway, extensionGateway, messages, lineageEvents });
  const secondTurn = await second.orchestrate({
    sessionId: "session-durable-routing",
    userId: "u1",
    text: "B",
    messageId: "m2",
    metadata: { threadKey: "root:1" },
  });
  assert.equal(secondTurn.status, "workflow_proposed");
  assert.equal(secondTurn.steps[0].capabilityId, "delegate_to_agent");
  assert.equal(secondTurn.steps[0].args.agentId, "@writer");
});

test("durable pending workflow survives orchestrator restart and can execute", async () => {
  const memoryGateway = createSharedMemoryGateway();
  const messages = [];
  const lineageEvents = [];
  const providerGateway = {
    async generate() {
      return {
        text: `<polar_action>{"template":"send_email","args":{"to":"ops@example.com","subject":"Status","body":"Done."}}</polar_action>Will do.`,
      };
    },
  };
  const extensionGateway = {
    getState(extensionId) {
      if (extensionId === "email") {
        return {
          extensionId: "email",
          lifecycleState: "installed",
          capabilities: [
            {
              capabilityId: "send_email",
              riskLevel: "write",
              sideEffects: "external",
              dataEgress: "network",
            },
          ],
        };
      }
      return undefined;
    },
    listStates() {
      return [
        {
          extensionId: "email",
          lifecycleState: "installed",
          capabilities: [{ capabilityId: "send_email", riskLevel: "write", sideEffects: "external", dataEgress: "network" }],
        },
      ];
    },
    async execute() {
      return { status: "completed", output: "sent" };
    },
  };

  const first = createHarness({ memoryGateway, providerGateway, extensionGateway, messages, lineageEvents });
  const proposed = await first.orchestrate({
    sessionId: "session-durable-workflow",
    userId: "u1",
    text: "send the status email",
    messageId: "mw1",
    metadata: { threadKey: "root:9" },
  });
  assert.equal(proposed.status, "workflow_proposed");
  assert.equal(typeof proposed.workflowId, "string");

  const second = createHarness({ memoryGateway, providerGateway, extensionGateway, messages, lineageEvents });
  const executed = await second.executeWorkflow(proposed.workflowId);
  assert.notEqual(executed.text, "Workflow not found");
});

