import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createTelegramCommandRouter,
  parseSchedulePromptPair,
  parseSlashCommand,
} from "../packages/polar-bot-runner/src/commands.mjs";

function createCtx(text, userId = 7, options = {}) {
  const chatId = options.chatId ?? 42;
  const chatType = options.chatType ?? "private";
  const replies = [];
  return {
    ctx: {
      chat: { id: chatId, type: chatType },
      from: { id: userId, username: "tester" },
      message: { text, message_id: 100, chat: { id: chatId, type: chatType } },
      async reply(message) {
        replies.push(message);
      },
    },
    replies,
  };
}

function createRouterHarness(overrides = {}) {
  const {
    commandAccessConfig: initialCommandAccessConfig,
    commandAccessConfigStatus: initialCommandAccessConfigStatus,
    routerConfig = {},
    ...controlPlaneOverrides
  } = overrides;
  const calls = {
    orchestrate: 0,
    orchestrateRequests: [],
    appendMessage: 0,
    setDefaultModel: 0,
    feedbackPayloads: [],
    reactions: [],
    pinProfileRequests: [],
    memorySearchRequests: [],
    memoryGetRequests: [],
    skillInstallRequests: [],
    extensionLifecycleRequests: [],
    commandAccessUpserts: [],
  };
  let modelRegistry = {
    version: 1,
    entries: [],
    defaults: null,
  };
  let agentProfiles = [
    {
      agentId: "@writer",
      profileId: "profile.writer",
      description: "Writes documentation",
      tags: ["writing"],
    },
  ];

  let commandAccessConfig =
    initialCommandAccessConfig ??
    {
      operatorUserIds: ["7"],
      adminUserIds: [],
      allowBangCommands: false,
    };
  let commandAccessConfigStatus = initialCommandAccessConfigStatus ?? "found";

  const controlPlane = {
    async getConfig(request) {
      if (
        request?.resourceType === "policy" &&
        request?.resourceId === "telegram_command_access"
      ) {
        if (commandAccessConfigStatus !== "found") {
          return { status: "not_found" };
        }
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
    async upsertConfig(request) {
      if (
        request?.resourceType === "policy" &&
        request?.resourceId === "telegram_command_access"
      ) {
        commandAccessConfig = request.config;
        commandAccessConfigStatus = "found";
        calls.commandAccessUpserts.push(request.config);
      }
      return { status: "applied" };
    },
    async orchestrate() {
      calls.orchestrate += 1;
      calls.orchestrateRequests.push(arguments[0]);
      return { status: "completed", text: "Preview in new style." };
    },
    async appendMessage() {
      calls.appendMessage += 1;
      return { status: "appended" };
    },
    async searchMemory(request) {
      calls.memorySearchRequests.push(request);
      return {
        status: "completed",
        resultCount: 1,
        records: [{ memoryId: "mem-1", summary: "Daily recap preference", secretToken: "sensitive" }],
      };
    },
    async getMemory(request) {
      calls.memoryGetRequests.push(request);
      if (request.memoryId === "missing") {
        return { status: "not_found" };
      }
      return {
        status: "completed",
        record: { memoryId: request.memoryId, content: "Preferred concise replies", authToken: "redact-me" },
      };
    },
    listExtensionStates() {
      return [
        {
          extensionId: "skill.docs-helper",
          extensionType: "skill",
          trustLevel: "reviewed",
          lifecycleState: "enabled",
        },
        {
          extensionId: "plugin.logger",
          extensionType: "plugin",
          trustLevel: "sandboxed",
          lifecycleState: "installed",
        },
      ];
    },
    async listBlockedSkills() {
      return [
        {
          extensionId: "skill.docs-helper",
          missingMetadata: [{ capabilityId: "docs.search", missingFields: ["riskLevel"] }],
        },
      ];
    },
    async installSkill(request) {
      calls.skillInstallRequests.push(request);
      return {
        status: "applied",
        extensionId: "skill.docs-helper",
        lifecycleState: "enabled",
      };
    },
    async applyExtensionLifecycle(request) {
      calls.extensionLifecycleRequests.push(request);
      return { status: "applied", lifecycleState: request.trustLevel === "blocked" ? "blocked" : "enabled" };
    },
    async setModelRegistryDefault() {
      calls.setDefaultModel += 1;
      return { status: "applied", profileId: "profile.global" };
    },
    async listAgentProfiles() {
      return { status: "ok", items: agentProfiles, totalCount: agentProfiles.length };
    },
    async getAgentProfile(request) {
      const found = agentProfiles.find((item) => item.agentId === request.agentId);
      if (!found) {
        return { status: "not_found", agentId: request.agentId };
      }
      return { status: "found", agent: found };
    },
    async registerAgentProfile(request) {
      const next = {
        agentId: request.agentId,
        profileId: request.profileId,
        description: request.description,
      };
      agentProfiles = [...agentProfiles.filter((item) => item.agentId !== request.agentId), next];
      return { status: "applied", agent: next };
    },
    async unregisterAgentProfile(request) {
      const countBefore = agentProfiles.length;
      agentProfiles = agentProfiles.filter((item) => item.agentId !== request.agentId);
      return countBefore === agentProfiles.length
        ? { status: "not_found", agentId: request.agentId }
        : { status: "deleted", agentId: request.agentId };
    },
    async pinProfileForScope(request) {
      calls.pinProfileRequests.push(request);
      return {
        status: "applied",
        scope: request.scope,
        profileId: request.profileId,
        pinResourceId: `profile-pin:${request.scope}`,
      };
    },
    async unpinProfileForScope(request) {
      return {
        status: "applied",
        scope: request.scope,
      };
    },
    async getEffectivePinnedProfile() {
      return {
        status: "found",
        scope: "session",
        profileId: "profile.writer",
        pinResourceId: "profile-pin:session:telegram:chat:42",
      };
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
    ...controlPlaneOverrides,
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
    ...routerConfig,
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
  const { ctx, replies } = createCtx("/models list", 99, { chatType: "group" });
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
  assert.equal(calls.orchestrate, 2);
  const lastAudit = calls.feedbackPayloads.at(-1);
  assert.equal(lastAudit.command, "models");
  assert.equal(lastAudit.outcome, "success");
  assert.equal(lastAudit.args.containsFreeText, false);
  assert.equal(typeof lastAudit.args.hash, "string");
  assert.ok(
    calls.orchestrateRequests.every(
      (request) => request.metadata?.suppressUserMessagePersist === true,
    ),
  );
});

test("status command includes threadKey", async () => {
  const { router, calls } = createRouterHarness();
  const { ctx, replies } = createCtx("/status");

  await router.handle(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /threadKey: root:42/);
  assert.equal(calls.orchestrate, 0);
});

test("whoami remains deterministic and does not orchestrate", async () => {
  const { router, calls } = createRouterHarness();
  const { ctx, replies } = createCtx("/whoami");
  await router.handle(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /userId: 7/);
  assert.equal(calls.orchestrate, 0);
});

test("agents pin resolves agentId to profile and returns orchestrated confirmation", async () => {
  const { router, calls } = createRouterHarness();
  const { ctx, replies } = createCtx("/agents pin @writer --session");
  const result = await router.handle(ctx);
  assert.equal(result.handled, true);
  assert.equal(calls.orchestrate, 1);
  assert.equal(calls.appendMessage, 0);
  assert.equal(calls.pinProfileRequests.length, 1);
  assert.equal(calls.pinProfileRequests[0].scope, "session");
  assert.equal(calls.pinProfileRequests[0].profileId, "profile.writer");
  assert.equal(replies.length, 1);
  assert.equal(replies[0], "Preview in new style.");
});

test("state-changing command confirmations go through orchestrate in side-effect-free mode", async () => {
  const { router, calls } = createRouterHarness();
  const { ctx, replies } = createCtx(
    "/personality set --session Keep answers concise and implementation-focused.",
  );
  const result = await router.handle(ctx);
  assert.equal(result.handled, true);
  assert.equal(replies.length, 1);
  assert.equal(calls.orchestrate, 1);
  assert.equal(calls.appendMessage, 0);
  assert.equal(calls.orchestrateRequests.length, 1);
  const request = calls.orchestrateRequests[0];
  assert.equal(request.metadata.executionType, "command");
  assert.equal(request.metadata.suppressUserMessagePersist, true);
  assert.equal(request.metadata.suppressMemoryWrite, true);
  assert.equal(request.metadata.suppressTaskWrites, true);
  assert.equal(request.metadata.suppressAutomationWrites, true);
  assert.doesNotMatch(request.text, /^\/personality/);
});

test("agents register is operator-gated", async () => {
  const { router } = createRouterHarness({
    commandAccessConfig: {
      operatorUserIds: [],
      adminUserIds: [],
      allowBangCommands: false,
    },
  });
  const { ctx, replies } = createCtx(
    "/agents register @research | profile.research | Handles research",
    99,
    { chatType: "group" },
  );
  await router.handle(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /requires operator access/);
});

test("memory search uses scoped gateway call and redacts sensitive fields", async () => {
  const { router, calls } = createRouterHarness();
  const { ctx, replies } = createCtx("/memory search --limit 5 daily recap");
  await router.handle(ctx);
  assert.equal(calls.memorySearchRequests.length, 1);
  assert.equal(calls.memorySearchRequests[0].scope, "session");
  assert.equal(calls.memorySearchRequests[0].query, "daily recap");
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Memory search \(session scope\)/);
  assert.doesNotMatch(replies[0], /sensitive/);
});

test("memory show returns not found when missing", async () => {
  const { router } = createRouterHarness();
  const { ctx, replies } = createCtx("/memory show missing");
  await router.handle(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Memory not found: missing/);
});

test("memory search --all requires operator access", async () => {
  const { router } = createRouterHarness({
    commandAccessConfig: {
      operatorUserIds: [],
      adminUserIds: [],
      allowBangCommands: false,
    },
  });
  const { ctx, replies } = createCtx("/memory search --all all users", 99, {
    chatType: "group",
  });
  await router.handle(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Access denied/);
});

test("private chat bootstrap grants first user admin and persists policy once", async () => {
  const { router, calls } = createRouterHarness({
    commandAccessConfigStatus: "not_found",
  });

  const first = createCtx("/models list", 101, { chatType: "private" });
  await router.handle(first.ctx);
  assert.equal(first.replies.length, 1);
  assert.doesNotMatch(first.replies[0], /Access denied/);
  assert.equal(calls.commandAccessUpserts.length, 1);
  assert.deepEqual(calls.commandAccessUpserts[0].adminTelegramUserIds, ["101"]);

  const second = createCtx("/models list", 202, { chatType: "private" });
  await router.handle(second.ctx);
  assert.equal(second.replies.length, 1);
  assert.match(second.replies[0], /Access denied/);

  const firstAgain = createCtx("/models list", 101, { chatType: "private" });
  await router.handle(firstAgain.ctx);
  assert.equal(firstAgain.replies.length, 1);
  assert.doesNotMatch(firstAgain.replies[0], /Access denied/);
});

test("group chat denies privileged commands when using bootstrap mode without allowlists", async () => {
  const { router, calls } = createRouterHarness({
    commandAccessConfigStatus: "not_found",
  });
  const { ctx, replies } = createCtx("/models list", 303, { chatType: "group" });
  await router.handle(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Access denied/);
  assert.equal(calls.commandAccessUpserts.length, 0);
});

test("explicit allowlists override bootstrap and do not persist bootstrap admin", async () => {
  const { router, calls } = createRouterHarness({
    commandAccessConfigStatus: "not_found",
    routerConfig: {
      explicitAdminUserIds: ["555"],
      explicitOperatorUserIds: ["777"],
      hasExplicitAdminAllowlist: true,
      hasExplicitOperatorAllowlist: true,
      singleUserAdminBootstrapEnabled: true,
    },
  });

  const allowed = createCtx("/models list", 555, { chatType: "group" });
  await router.handle(allowed.ctx);
  assert.equal(allowed.replies.length, 1);
  assert.doesNotMatch(allowed.replies[0], /Access denied/);

  const denied = createCtx("/models list", 888, { chatType: "private" });
  await router.handle(denied.ctx);
  assert.equal(denied.replies.length, 1);
  assert.match(denied.replies[0], /Access denied/);
  assert.equal(calls.commandAccessUpserts.length, 0);
});

test("fails closed when policy missing and bootstrap disabled with no allowlists", async () => {
  const { router } = createRouterHarness({
    commandAccessConfigStatus: "not_found",
    routerConfig: {
      singleUserAdminBootstrapEnabled: false,
    },
  });
  const { ctx, replies } = createCtx("/models list", 404, { chatType: "private" });
  await router.handle(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Access denied/);
});

test("skills list reports installed skill state", async () => {
  const { router } = createRouterHarness();
  const { ctx, replies } = createCtx("/skills list");
  await router.handle(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /skill\.docs-helper/);
  assert.match(replies[0], /missingMetadata=1/);
});

test("skills install reads manifest from file source and calls installSkill", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "polar-skill-"));
  try {
    const manifestPath = path.join(workspace, "SKILL.md");
    fs.writeFileSync(manifestPath, "# skill manifest\nname: docs-helper\n", "utf8");
    const { router, calls } = createRouterHarness();
    const { ctx, replies } = createCtx(`/skills install file:${manifestPath}`);
    await router.handle(ctx);
    assert.equal(calls.skillInstallRequests.length, 1);
    assert.equal(calls.skillInstallRequests[0].sourceUri, manifestPath);
    assert.match(calls.skillInstallRequests[0].skillManifest, /skill manifest/);
    assert.equal(replies.length, 1);
    assert.match(replies[0], /Skill install result/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("skills block and unblock call extension lifecycle", async () => {
  const { router, calls } = createRouterHarness();
  await router.handle(createCtx("/skills block skill.docs-helper").ctx);
  await router.handle(createCtx("/skills unblock skill.docs-helper").ctx);
  assert.equal(calls.extensionLifecycleRequests.length, 3);
  assert.equal(calls.extensionLifecycleRequests[0].operation, "retrust");
  assert.equal(calls.extensionLifecycleRequests[0].trustLevel, "blocked");
  assert.equal(calls.extensionLifecycleRequests[1].trustLevel, "reviewed");
  assert.equal(calls.extensionLifecycleRequests[2].operation, "enable");
});
