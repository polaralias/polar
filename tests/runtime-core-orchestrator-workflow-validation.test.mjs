import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrator } from "../packages/polar-runtime-core/src/orchestrator.mjs";
import { createApprovalStore } from "../packages/polar-runtime-core/src/approval-store.mjs";
import { createExtensionGateway } from "../packages/polar-runtime-core/src/extension-gateway.mjs";
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

function createOrchestratorHarness({ providerText }) {
  const appendedMessages = [];
  const extensionExecutions = [];

  const orchestrator = createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          profileConfig: {
            systemPrompt: "You are a test assistant.",
            modelPolicy: { providerId: "test-provider", modelId: "test-model" },
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
          .map((message) => ({
            role: message.role,
            text: message.text,
          }));
        return { items: items.slice(-limit) };
      },
    },
    providerGateway: {
      async generate({ prompt }) {
        if (typeof prompt === "string" && prompt.includes("Analyze these execution results")) {
          return { text: "summary" };
        }
        return { text: providerText };
      },
    },
    extensionGateway: {
      getState() {
        return {
          extensionId: "web",
          lifecycleState: "enabled",
          capabilities: [{ capabilityId: "search_web", riskLevel: "read", sideEffects: "none" }],
        };
      },
      listStates() {
        return [];
      },
      async execute(request) {
        extensionExecutions.push(request);
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

  return { orchestrator, extensionExecutions, appendedMessages };
}

test("orchestrator accepts <polar_action> only: unknown template is rejected without tool execution", async () => {
  await withUnrefedIntervals(async () => {
    const { orchestrator, extensionExecutions } = createOrchestratorHarness({
      providerText: `<polar_action>{"template":"hack_mainframe","args":{}}</polar_action>`,
    });

    const result = await orchestrator.orchestrate({
      sessionId: "session-1",
      userId: "user-1",
      text: "do something",
      messageId: "m-1",
    });

    assert.equal(result.status, "error");
    assert.match(result.text, /Failed to parse action proposal/);
    assert.equal(extensionExecutions.length, 0);
  });
});

test("orchestrator does not execute tools when template args are invalid", async () => {
  await withUnrefedIntervals(async () => {
    const { orchestrator, extensionExecutions } = createOrchestratorHarness({
      providerText: `<polar_action>{"template":"lookup_weather","args":{}}</polar_action>`,
    });

    await assert.rejects(
      async () =>
        orchestrator.orchestrate({
          sessionId: "session-2",
          userId: "user-2",
          text: "weather please",
          messageId: "m-2",
        }),
      /missing required arguments/,
    );

    assert.equal(extensionExecutions.length, 0);
  });
});

test("orchestrator clamps forwarded skills before activating delegation", async () => {
  await withUnrefedIntervals(async () => {
    const appendedMessages = [];
    const orchestrator = createOrchestrator({
      profileResolutionGateway: {
        async resolve() {
          return {
            profileConfig: {
              systemPrompt: "You are a test assistant.",
              modelPolicy: { providerId: "test-provider", modelId: "test-model" },
              allowedSkills: ["email_mcp"],
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
            .map((message) => ({
              role: message.role,
              text: message.text,
            }));
          return { items: items.slice(-limit) };
        },
      },
      providerGateway: {
        async generate({ prompt }) {
          if (typeof prompt === "string" && prompt.includes("Analyze these execution results")) {
            return { text: "delegation summary" };
          }
          return {
            text: `<polar_action>{\"template\":\"delegate_to_agent\",\"args\":{\"agentId\":\"@writer\",\"task_instructions\":\"Write\",\"forward_skills\":[\"email_mcp\",\"exfiltrate_keys\"]}}</polar_action>`,
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
        async getConfig() {
          return { status: "not_found" };
        },
      },
      now: Date.now,
    });

    const proposed = await orchestrator.orchestrate({
      sessionId: "session-3",
      userId: "user-3",
      text: "delegate this",
      messageId: "m-3",
    });
    assert.equal(proposed.status, "workflow_proposed");

    const executed = await orchestrator.executeWorkflow(proposed.workflowId);
    assert.equal(executed.status, "completed");

    const delegationMessage = appendedMessages.find(
      (message) => message.role === "system" && typeof message.text === "string" && message.text.startsWith("[DELEGATION ACTIVE]"),
    );
    assert.ok(delegationMessage);

    const payload = JSON.parse(delegationMessage.text.replace("[DELEGATION ACTIVE]", "").trim());
    assert.deepEqual(payload.forward_skills, ["email_mcp"]);
    assert.equal(payload.forward_skills.includes("exfiltrate_keys"), false);
  });
});

test("delegation strips unauthorized forward_skills and blocks delegated access to non-forwarded tools", async () => {
  await withUnrefedIntervals(async () => {
    const templateId = "delegate_then_send_for_scope_test";
    const previousTemplate = WORKFLOW_TEMPLATES[templateId];
    WORKFLOW_TEMPLATES[templateId] = {
      id: templateId,
      description: "Delegate then attempt a tool outside delegated scope",
      schema: {
        required: ["agentId", "task_instructions", "forward_skills", "to", "subject", "body"],
        optional: [],
      },
      steps: (args) => [
        {
          extensionId: "system",
          extensionType: "core",
          capabilityId: "delegate_to_agent",
          args: {
            agentId: args.agentId,
            task_instructions: args.task_instructions,
            forward_skills: args.forward_skills,
          },
        },
        {
          extensionId: "email",
          extensionType: "mcp",
          capabilityId: "send_email",
          args: {
            to: args.to,
            subject: args.subject,
            body: args.body,
          },
        },
      ],
    };

    const appendedMessages = [];
    let emailAdapterCalls = 0;

    const extensionGateway = createExtensionGateway({
      middlewarePipeline: {
        async run(context, next) {
          return next(context.input);
        },
      },
      extensionRegistry: {
        get(extensionId) {
          if (extensionId === "web") {
            return {
              async executeCapability() {
                return { status: "completed", output: "web ok" };
              },
            };
          }
          if (extensionId === "email") {
            return {
              async executeCapability() {
                emailAdapterCalls += 1;
                return { status: "completed", output: "email sent" };
              },
            };
          }
          return undefined;
        },
      },
      initialStates: [
        {
          extensionId: "web",
          extensionType: "mcp",
          trustLevel: "trusted",
          lifecycleState: "enabled",
          permissions: [],
          capabilities: [
            { capabilityId: "search_web", riskLevel: "read", sideEffects: "none", dataEgress: "none" },
          ],
        },
        {
          extensionId: "email",
          extensionType: "mcp",
          trustLevel: "trusted",
          lifecycleState: "enabled",
          permissions: [],
          capabilities: [
            { capabilityId: "send_email", riskLevel: "write", sideEffects: "external", dataEgress: "network" },
          ],
        },
      ],
    });

    const orchestrator = createOrchestrator({
      profileResolutionGateway: {
        async resolve() {
          return {
            profileConfig: {
              systemPrompt: "You are a test assistant.",
              modelPolicy: { providerId: "test-provider", modelId: "test-model" },
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
            .map((message) => ({
              role: message.role,
              text: message.text,
            }));
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
              args: {
                agentId: "@writer",
                task_instructions: "Send an email as delegate",
                forward_skills: ["web", "exfiltrate_keys"],
                to: "alice@example.com",
                subject: "Hi",
                body: "Hello",
              },
            })}</polar_action>`,
          };
        },
      },
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
        sessionId: "session-4",
        userId: "user-4",
        text: "delegate and send",
        messageId: "m-4",
      });
      assert.equal(proposed.status, "workflow_proposed");

      const executed = await orchestrator.executeWorkflow(proposed.workflowId);
      assert.equal(executed.status, "completed");
      assert.equal(emailAdapterCalls, 0);

      const delegationMessage = appendedMessages.find(
        (message) =>
          message.role === "system" &&
          typeof message.text === "string" &&
          message.text.startsWith("[DELEGATION ACTIVE]"),
      );
      assert.ok(delegationMessage);
      const delegationPayload = JSON.parse(
        delegationMessage.text.replace("[DELEGATION ACTIVE]", "").trim(),
      );
      assert.deepEqual(delegationPayload.forward_skills, ["web"]);
      assert.equal(delegationPayload.forward_skills.includes("exfiltrate_keys"), false);

      const toolResultsMessage = appendedMessages.find(
        (message) =>
          message.role === "system" &&
          typeof message.text === "string" &&
          message.text.startsWith("[TOOL RESULTS]"),
      );
      assert.ok(toolResultsMessage);
      const toolResults = JSON.parse(toolResultsMessage.text.split("\n").slice(1).join("\n"));
      const sendStep = toolResults.find((entry) => entry.tool === "send_email");
      assert.equal(sendStep.status, "failed");
      assert.equal(sendStep.output.code, "POLAR_EXTENSION_POLICY_DENIED");
    } finally {
      if (previousTemplate) {
        WORKFLOW_TEMPLATES[templateId] = previousTemplate;
      } else {
        delete WORKFLOW_TEMPLATES[templateId];
      }
    }
  });
});

test("orchestrator computes capability scope from skill-registry authority states", async () => {
  await withUnrefedIntervals(async () => {
    const appendedMessages = [];
    const extensionExecutions = [];
    let providerText = `<polar_action>{"template":"search_web","args":{"query":"policy updates"}}</polar_action>`;

    const extensionGateway = createExtensionGateway({
      middlewarePipeline: {
        async run(context, next) {
          return next(context.input);
        },
      },
      extensionRegistry: {
        get() {
          return {
            async executeCapability(request) {
              extensionExecutions.push(request);
              return { status: "completed", output: "ok" };
            },
          };
        },
      },
      initialStates: [
        {
          extensionId: "web",
          extensionType: "mcp",
          trustLevel: "trusted",
          lifecycleState: "enabled",
          permissions: [],
          capabilities: [
            { capabilityId: "search_web", riskLevel: "read", sideEffects: "none", dataEgress: "none" },
          ],
        },
        {
          extensionId: "email",
          extensionType: "mcp",
          trustLevel: "trusted",
          lifecycleState: "enabled",
          permissions: [],
          capabilities: [
            { capabilityId: "draft_email", riskLevel: "write", sideEffects: "external", dataEgress: "network" },
          ],
        },
      ],
    });

    const orchestrator = createOrchestrator({
      profileResolutionGateway: {
        async resolve() {
          return {
            profileConfig: {
              systemPrompt: "You are a test assistant.",
              modelPolicy: { providerId: "test-provider", modelId: "test-model" },
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
            .map((message) => ({
              role: message.role,
              text: message.text,
            }));
          return { items: items.slice(-limit) };
        },
      },
      providerGateway: {
        async generate({ prompt }) {
          if (typeof prompt === "string" && prompt.includes("Analyze these execution results")) {
            return { text: "summary" };
          }
          return { text: providerText };
        },
      },
      extensionGateway,
      approvalStore: createApprovalStore(),
      skillRegistry: {
        listAuthorityStates() {
          return [
            {
              extensionId: "web",
              lifecycleState: "enabled",
              capabilities: [{ capabilityId: "search_web" }],
            },
            {
              extensionId: "email",
              lifecycleState: "blocked",
              capabilities: [{ capabilityId: "draft_email" }],
            },
          ];
        },
      },
      gateway: {
        async getConfig() {
          return { status: "not_found" };
        },
      },
      now: Date.now,
    });

    const allowedResult = await orchestrator.orchestrate({
      sessionId: "session-authority",
      userId: "user-authority",
      text: "search policy updates",
      messageId: "m-1",
    });
    assert.equal(allowedResult.status, "completed");
    assert.equal(extensionExecutions.length, 1);
    assert.deepEqual(extensionExecutions[0].capabilityScope.allowed.web, ["search_web"]);
    assert.equal(extensionExecutions[0].capabilityScope.allowed.email, undefined);

    providerText = `<polar_action>{"template":"draft_email","args":{"to":"a@example.com","subject":"hello","body":"world"}}</polar_action>`;
    const blockedProposal = await orchestrator.orchestrate({
      sessionId: "session-authority",
      userId: "user-authority",
      text: "draft an email",
      messageId: "m-2",
    });
    assert.equal(blockedProposal.status, "workflow_proposed");

    const blockedExecution = await orchestrator.executeWorkflow(blockedProposal.workflowId);
    assert.equal(blockedExecution.status, "error");
    assert.match(blockedExecution.text, /Workflow blocked/);
    assert.equal(extensionExecutions.length, 1);
  });
});
