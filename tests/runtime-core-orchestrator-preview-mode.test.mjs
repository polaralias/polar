import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrator } from "../packages/polar-runtime-core/src/orchestrator.mjs";
import { createApprovalStore } from "../packages/polar-runtime-core/src/approval-store.mjs";

test("orchestrator preview mode does not append chat history messages", async () => {
  const appended = [];
  const chatManagementGateway = {
    async appendMessage(message) {
      appended.push(message);
      return { status: "appended" };
    },
    async getSessionHistory() {
      return { items: [] };
    },
  };
  const orchestrator = createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          profileConfig: {
            systemPrompt: "You are preview assistant.",
            modelPolicy: { providerId: "openai", modelId: "gpt-4.1-mini" },
          },
        };
      },
    },
    chatManagementGateway,
    providerGateway: {
      async generate() {
        return { text: "preview response" };
      },
    },
    extensionGateway: {
      listStates() {
        return [];
      },
      getState() {
        return undefined;
      },
      async execute() {
        return { status: "completed", output: "ok" };
      },
    },
    approvalStore: createApprovalStore(),
    skillRegistry: {
      listAuthorityStates() {
        return [];
      },
    },
    gateway: {
      async getConfig() {
        return { status: "not_found" };
      },
    },
  });

  const result = await orchestrator.orchestrate({
    sessionId: "session-preview-1",
    userId: "user-1",
    text: "preview text",
    metadata: {
      previewMode: true,
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.text, "preview response");
  assert.equal(appended.length, 0);
});
