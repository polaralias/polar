import test from "node:test";
import assert from "node:assert/strict";

import {
  createTelegramCommandRouter,
  parseSchedulePromptPair,
  parseSlashCommand,
} from "../packages/polar-bot-runner/src/commands.mjs";

function createCtx(text, userId = 7) {
  const replies = [];
  return {
    ctx: {
      chat: { id: 42 },
      from: { id: userId, username: "tester" },
      message: { text, message_id: 100, chat: { id: 42 } },
      async reply(message) {
        replies.push(message);
      },
    },
    replies,
  };
}

function createRouterHarness(overrides = {}) {
  const calls = {
    orchestrate: 0,
    appendMessage: 0,
    setDefaultModel: 0,
    feedbackPayloads: [],
    reactions: [],
  };
  let modelRegistry = {
    version: 1,
    entries: [],
    defaults: null,
  };

  const commandAccessConfig =
    overrides.commandAccessConfig ??
    {
      operatorUserIds: ["7"],
      adminUserIds: [],
      allowBangCommands: false,
    };

  const controlPlane = {
    async getConfig(request) {
      if (
        request?.resourceType === "policy" &&
        request?.resourceId === "telegram_command_access"
      ) {
        return { status: "found", config: commandAccessConfig };
      }
      if (
        request?.resourceType === "policy" &&
        request?.resourceId === "telegram_chat_flags:42"
      ) {
        return { status: "not_found" };
      }
      return { status: "not_found" };
    },
    async upsertConfig() {
      return { status: "applied" };
    },
    async orchestrate() {
      calls.orchestrate += 1;
      return { status: "completed", text: "Preview in new style." };
    },
    async appendMessage() {
      calls.appendMessage += 1;
      return { status: "appended" };
    },
    async setModelRegistryDefault() {
      calls.setDefaultModel += 1;
      return { status: "applied", profileId: "profile.global" };
    },
    async getModelRegistry() {
      return { status: "ok", registry: modelRegistry };
    },
    async upsertModelRegistry(request) {
      modelRegistry = request.registry;
      return { status: "applied", registry: modelRegistry };
    },
    async listModels() {
      return { providerId: "openai", models: ["gpt-5-mini"] };
    },
    async recordFeedbackEvent(request) {
      calls.feedbackPayloads.push(request.payload);
      return { status: "recorded" };
    },
    async health() {
      return { status: "ok" };
    },
    async getSessionHistory() {
      return { status: "ok", items: [], totalCount: 0 };
    },
    async listAutomationJobs() {
      return { status: "ok", items: [], totalCount: 0 };
    },
    async getEffectivePersonality() {
      return { status: "not_found" };
    },
    async upsertPersonalityProfile(request) {
      return { status: "upserted", profile: { scope: request.scope } };
    },
    async resetPersonalityProfile() {
      return { status: "reset", deleted: true };
    },
    async previewAutomationJob(request) {
      return {
        status: "ok",
        preview: {
          schedule: request.schedule,
          promptTemplate: request.promptTemplate,
        },
      };
    },
    async createAutomationJob(request) {
      return {
        status: "created",
        job: { id: "job-1", schedule: request.schedule, promptTemplate: request.promptTemplate },
      };
    },
    async getAutomationJob() {
      return {
        status: "found",
        job: {
          id: "job-1",
          ownerUserId: "7",
          sessionId: "telegram:chat:42",
          schedule: "daily at 10:00",
          promptTemplate: "hydrate",
          enabled: true,
        },
      };
    },
    async enableAutomationJob() {
      return { status: "updated" };
    },
    async disableAutomationJob() {
      return { status: "disabled" };
    },
    async deleteAutomationJob() {
      return { status: "deleted" };
    },
    async runAutomationJob() {
      return { status: "completed", runId: "run-1", output: { text: "done" } };
    },
    async exportArtifacts() {
      return { status: "exported", files: [{ filename: "MEMORY.md" }] };
    },
    async showArtifacts() {
      return {
        status: "ok",
        items: [{ filename: "PERSONALITY.md", updatedAtMs: Date.UTC(2026, 2, 1, 10, 0, 0) }],
      };
    },
    ...overrides,
  };

  const router = createTelegramCommandRouter({
    controlPlane,
    dbPath: "C:/repo/polar-system.db",
    resolveSessionContext: async () => ({ sessionId: "telegram:chat:42" }),
    deriveThreadKey: () => "root:42",
    async setReactionState(_ctx, _chatId, _messageId, state) {
      calls.reactions.push(state);
    },
    async replyWithOptions(ctx, text) {
      await ctx.reply(text);
    },
  });

  return { router, calls };
}

test("parseSlashCommand supports slash and optional bang prefixes", () => {
  assert.equal(parseSlashCommand("hello"), null);
  assert.deepEqual(parseSlashCommand("/help"), { command: "help", argsRaw: "", prefix: "/" });
  assert.equal(parseSlashCommand("!help"), null);
  assert.deepEqual(parseSlashCommand("!help topic", { allowBangPrefix: true }), {
    command: "help",
    argsRaw: "topic",
    prefix: "!",
  });
});

test("command router intercepts slash commands and does not call appendMessage/orchestrate for help", async () => {
  const { router, calls } = createRouterHarness();
  const { ctx, replies } = createCtx("/help");

  const result = await router.handle(ctx);
  assert.equal(result.handled, true);
  assert.equal(calls.orchestrate, 0);
  assert.equal(calls.appendMessage, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /\/help/);
  assert.deepEqual(calls.reactions, ["received", "done"]);
});

test("personality preview explicitly orchestrates", async () => {
  const { router, calls } = createRouterHarness();
  const { ctx } = createCtx("/personality preview");
  await router.handle(ctx);
  assert.equal(calls.orchestrate, 1);
});

test("automations create parser accepts delimiter format and rejects invalid shape", async () => {
  const parsed = parseSchedulePromptPair("daily 09:00 | Remind me to stretch");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.schedule, "daily 09:00");
  assert.equal(parsed.promptTemplate, "Remind me to stretch");

  const invalid = parseSchedulePromptPair("daily 09:00 Remind me");
  assert.equal(invalid.ok, false);

  const { router } = createRouterHarness({
    async previewAutomationJob() {
      throw new Error("Invalid automation schedule");
    },
  });
  const { ctx, replies } = createCtx("/automations create bad | prompt");
  await router.handle(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Invalid automation schedule/);
  assert.match(replies[0], /Usage:/);
});

test("operator gating denies /models for non-operator users and audits denied outcome", async () => {
  const { router, calls } = createRouterHarness({
    commandAccessConfig: {
      operatorUserIds: [],
      adminUserIds: [],
      allowBangCommands: false,
    },
  });
  const { ctx, replies } = createCtx("/models list", 99);
  await router.handle(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Access denied/);
  assert.equal(calls.feedbackPayloads.at(-1).outcome, "denied");
});

test("models register and set-default update registry and routing default", async () => {
  const { router, calls } = createRouterHarness();

  await router.handle(createCtx("/models register openai gpt-5-mini --alias fast").ctx);
  await router.handle(createCtx("/models set-default openai fast").ctx);

  assert.equal(calls.setDefaultModel, 1);
  const lastAudit = calls.feedbackPayloads.at(-1);
  assert.equal(lastAudit.command, "models");
  assert.equal(lastAudit.outcome, "success");
  assert.equal(lastAudit.args.containsFreeText, false);
  assert.equal(typeof lastAudit.args.hash, "string");
});

test("status command includes threadKey", async () => {
  const { router } = createRouterHarness();
  const { ctx, replies } = createCtx("/status");

  await router.handle(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /threadKey: root:42/);
});
