import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createApprovalStore,
  createContractRegistry,
  createDurableLineageStore,
  createExtensionGateway,
  createMiddlewarePipeline,
  createOrchestrator,
  registerExtensionContracts,
} from "../packages/polar-runtime-core/src/index.mjs";

/**
 * @returns {ReturnType<typeof createDurableLineageStore>}
 */
function createTempLineageStore() {
  const uniquePart = `${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 10)}`;
  const filePath = join(tmpdir(), `polar-lineage-${uniquePart}.ndjson`);
  return createDurableLineageStore({ filePath });
}

/**
 * @param {{
 *   lifecycleState?: "enabled"|"disabled"|"installed"|"blocked"|"removed"|"pending_install",
 *   adapterOutput?: Record<string, unknown>
 * }} [options]
 */
function setupExtensionRuntime(options = {}) {
  const contractRegistry = createContractRegistry();
  registerExtensionContracts(contractRegistry);

  const lineageStore = createTempLineageStore();
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    lineageStore,
  });

  const extensionGateway = createExtensionGateway({
    middlewarePipeline,
    extensionRegistry: {
      get() {
        return {
          async executeCapability() {
            return options.adapterOutput ?? { status: "ok", payload: "done" };
          },
        };
      },
    },
    initialStates: [
      {
        extensionId: "weather",
        extensionType: "mcp",
        trustLevel: "reviewed",
        lifecycleState: options.lifecycleState ?? "enabled",
        permissions: [],
        capabilities: [
          {
            capabilityId: "lookup_weather",
            riskLevel: "read",
            sideEffects: "none",
            dataEgress: "none",
          },
        ],
      },
    ],
    approvalStore: createApprovalStore(),
  });

  return {
    middlewarePipeline,
    extensionGateway,
    lineageStore,
  };
}

test("emits policy decision events with reason codes for extension policy denials", async () => {
  const { extensionGateway, middlewarePipeline, lineageStore } = setupExtensionRuntime();
  try {
    const denied = await extensionGateway.execute({
      extensionId: "weather",
      extensionType: "mcp",
      capabilityId: "lookup_weather",
      sessionId: "session-policy-deny",
      userId: "user-policy-deny",
      capabilityScope: {},
      input: { location: "Swansea" },
      metadata: {
        lineage: {
          workflowId: "wf-policy-deny",
          runId: "run-policy-deny",
          threadId: "thread-policy-deny",
        },
      },
    });

    assert.equal(denied.status, "failed");
    assert.equal(denied.error?.code, "POLAR_EXTENSION_POLICY_DENIED");

    const policyEvents = await middlewarePipeline.queryLineage({
      eventType: "policy.decision",
      workflowId: "wf-policy-deny",
      runId: "run-policy-deny",
      threadId: "thread-policy-deny",
    });
    assert.equal(policyEvents.returnedCount, 1);
    assert.equal(policyEvents.items[0].decision, "deny");
    assert.equal(policyEvents.items[0].reasonCode, "scope_invalid");
    assert.equal(policyEvents.items[0].extensionId, "weather");
    assert.equal(policyEvents.items[0].capabilityId, "lookup_weather");
  } finally {
    await lineageStore.removeFile();
  }
});

test("supports durable lineage query keyed by workflowId/runId/threadId", async () => {
  const { extensionGateway, middlewarePipeline, lineageStore } = setupExtensionRuntime();
  try {
    const completed = await extensionGateway.execute({
      extensionId: "weather",
      extensionType: "mcp",
      capabilityId: "lookup_weather",
      sessionId: "session-lineage",
      userId: "user-lineage",
      capabilityScope: {
        allowed: {
          weather: ["lookup_weather"],
        },
      },
      input: { location: "Cardiff" },
      metadata: {
        lineage: {
          workflowId: "wf-lineage",
          runId: "run-lineage",
          threadId: "thread-lineage",
        },
      },
    });

    assert.equal(completed.status, "completed");

    const queryResult = await middlewarePipeline.queryLineage({
      workflowId: "wf-lineage",
      runId: "run-lineage",
      threadId: "thread-lineage",
    });

    assert.ok(queryResult.returnedCount > 0);
    assert.equal(
      queryResult.items.some((event) => event.checkpoint === "run.completed"),
      true,
    );
    assert.equal(
      queryResult.items.every(
        (event) =>
          event.extensionId === "weather" &&
          event.capabilityId === "lookup_weather",
      ),
      true,
    );
  } finally {
    await lineageStore.removeFile();
  }
});

test("emits repair trigger, selection, and outcome lineage events", async () => {
  const lineageStore = createTempLineageStore();
  const messages = [];

  const orchestrator = createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          profileConfig: {
            systemPrompt: "You are a test assistant.",
            modelPolicy: { providerId: "provider-x", modelId: "model-y" },
            allowedSkills: [],
          },
        };
      },
    },
    chatManagementGateway: {
      async appendMessage(message) {
        messages.push(message);
        return { status: "appended" };
      },
      async getSessionHistory({ sessionId, limit = 100 }) {
        const items = messages
          .filter((entry) => entry.sessionId === sessionId)
          .map((entry) => ({ role: entry.role, text: entry.text }));
        return { items: items.slice(-limit) };
      },
    },
    providerGateway: {
      async generate(request) {
        if (
          typeof request.prompt === "string" &&
          request.prompt.includes("Respond with ONLY this JSON shape")
        ) {
          return {
            text: JSON.stringify({
              question: "Which path should I continue?",
              labelA: "Alpha path",
              labelB: "Beta path",
            }),
          };
        }

        if (request.prompt === "topic one") {
          return { text: "I can help. Want me to troubleshoot the weather lookup?" };
        }
        if (request.prompt === "topic two") {
          return { text: "I can help. Shall I explain more about the routing design?" };
        }
        return { text: "ok" };
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
        return { status: "completed", output: "Done." };
      },
    },
    approvalStore: createApprovalStore(),
    gateway: {
      async getConfig() {
        return { status: "not_found" };
      },
    },
    lineageStore,
  });

  try {
    await orchestrator.orchestrate({
      sessionId: "session-repair-telemetry",
      userId: "user-repair-telemetry",
      text: "topic one",
      messageId: "m-1",
    });
    await orchestrator.orchestrate({
      sessionId: "session-repair-telemetry",
      userId: "user-repair-telemetry",
      text: "topic two",
      messageId: "m-2",
    });

    const repair = await orchestrator.orchestrate({
      sessionId: "session-repair-telemetry",
      userId: "user-repair-telemetry",
      text: "explain more",
      messageId: "m-3",
    });
    assert.equal(repair.status, "repair_question");

    const selectionResult = await orchestrator.handleRepairSelectionEvent({
      sessionId: "session-repair-telemetry",
      selection: "A",
      correlationId: repair.correlationId,
    });
    assert.equal(selectionResult.status, "completed");

    const triggeredEvents = await lineageStore.query({
      eventType: "repair.triggered",
      limit: 50,
    });
    const triggered = triggeredEvents.items.find(
      (event) => event.correlationId === repair.correlationId,
    );
    assert.ok(triggered);
    assert.equal(triggered.reasonCode, "ambiguous_low_information");

    const selectionEvents = await lineageStore.query({
      eventType: "repair.selection",
      limit: 50,
    });
    const selection = selectionEvents.items.find(
      (event) => event.correlationId === repair.correlationId,
    );
    assert.ok(selection);
    assert.equal(selection.status, "received");
    assert.equal(selection.selection, "A");

    const outcomeEvents = await lineageStore.query({
      eventType: "repair.outcome",
      limit: 50,
    });
    const outcome = outcomeEvents.items.find(
      (event) => event.correlationId === repair.correlationId,
    );
    assert.ok(outcome);
    assert.equal(outcome.status, "completed");
    assert.equal(outcome.reasonCode, "selection_applied");
  } finally {
    await lineageStore.removeFile();
  }
});
