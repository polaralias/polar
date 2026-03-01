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

test("orchestrator sanitizes undefined metadata fields before appendMessage", async () => {
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
            modelPolicy: { providerId: "openai", modelId: "gpt-4.1-mini" },
          },
        };
      },
    },
    chatManagementGateway,
    providerGateway: {
      async generate() {
        return { text: "normal response" };
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

  await orchestrator.orchestrate({
    sessionId: "session-sanitize-1",
    userId: "user-1",
    text: "normal turn",
    metadata: {
      threadId: undefined,
      source: "telegram",
      nested: {
        keep: true,
        drop: undefined,
      },
      undefinedTopLevel: undefined,
    },
  });

  assert.ok(appended.length >= 1);
  const firstMetadata = appended[0].metadata;
  assert.equal(Object.prototype.hasOwnProperty.call(firstMetadata, "threadId"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(firstMetadata, "undefinedTopLevel"),
    false,
  );
  assert.equal(firstMetadata.nested.keep, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(firstMetadata.nested, "drop"),
    false,
  );
});

test("orchestrator suppresses persistence when side-effect-free flags are enabled", async () => {
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
            systemPrompt: "You are command confirmation assistant.",
            modelPolicy: { providerId: "openai", modelId: "gpt-4.1-mini" },
          },
        };
      },
    },
    chatManagementGateway,
    providerGateway: {
      async generate() {
        return { text: "Command completed successfully." };
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
    sessionId: "session-command-1",
    userId: "user-1",
    text: "Confirm deterministic command outcome.",
    metadata: {
      executionType: "command",
      suppressUserMessagePersist: true,
      suppressMemoryWrite: true,
      suppressTaskWrites: true,
      suppressAutomationWrites: true,
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.text, "Command completed successfully.");
  assert.equal(appended.length, 0);
});
