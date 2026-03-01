import test from "node:test";
import assert from "node:assert/strict";

import { createTelegramCommandRouter } from "../packages/polar-bot-runner/src/commands.mjs";
import { handleTextMessageIngress } from "../packages/polar-bot-runner/src/text-ingress.mjs";

function createCtx(text, userId = 7) {
  const replies = [];
  return {
    ctx: {
      chat: { id: 42, type: "private" },
      from: { id: userId, username: "operator" },
      message: { text, message_id: 200, chat: { id: 42, type: "private" } },
      async reply(message) {
        replies.push(message);
      },
    },
    replies,
  };
}

test("telegram text ingress routes /agents register|pin|unpin through command router and audits payloads", async () => {
  const feedbackEvents = [];
  const mutationCalls = {
    register: [],
    pin: [],
    unpin: [],
    orchestrate: [],
  };

  const controlPlane = {
    async getConfig(request) {
      if (
        request?.resourceType === "policy" &&
        request?.resourceId === "telegram_command_access"
      ) {
        return {
          status: "found",
          config: {
            operatorUserIds: ["7"],
            adminUserIds: [],
            allowBangCommands: false,
          },
        };
      }
      return { status: "not_found" };
    },
    async upsertConfig() {
      return { status: "applied" };
    },
    async orchestrate(request) {
      mutationCalls.orchestrate.push(request);
      return { status: "completed", text: "ok" };
    },
    async recordFeedbackEvent(event) {
      feedbackEvents.push(event);
      return { status: "recorded" };
    },
    async listAgentProfiles() {
      return {
        status: "ok",
        items: [
          {
            agentId: "@writer",
            profileId: "profile.writer",
            description: "Writer",
          },
        ],
        totalCount: 1,
      };
    },
    async getAgentProfile(request) {
      if (request.agentId !== "@writer") {
        return { status: "not_found" };
      }
      return {
        status: "found",
        agent: {
          agentId: "@writer",
          profileId: "profile.writer",
          description: "Writer",
        },
      };
    },
    async registerAgentProfile(request) {
      mutationCalls.register.push(request);
      return {
        status: "applied",
        agent: {
          agentId: request.agentId,
          profileId: request.profileId,
          description: request.description,
        },
      };
    },
    async unregisterAgentProfile() {
      return { status: "deleted" };
    },
    async pinProfileForScope(request) {
      mutationCalls.pin.push(request);
      return {
        status: "applied",
        scope: request.scope,
        profileId: request.profileId,
      };
    },
    async unpinProfileForScope(request) {
      mutationCalls.unpin.push(request);
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
      };
    },
  };

  const commandRouter = createTelegramCommandRouter({
    controlPlane,
    dbPath: "db.sqlite",
    resolveSessionContext: async () => ({ sessionId: "telegram:chat:42" }),
    deriveThreadKey: () => "root:42",
    setReactionState: async () => {},
    replyWithOptions: async (ctx, message) => {
      await ctx.reply(message);
    },
  });

  let debouncedCalls = 0;
  for (const command of [
    "/agents register @writer | profile.writer | Handles writing",
    "/agents pin @writer --session",
    "/agents unpin --session",
  ]) {
    const { ctx } = createCtx(command);
    const result = await handleTextMessageIngress({
      ctx,
      commandRouter,
      handleMessageDebounced: async () => {
        debouncedCalls += 1;
      },
      buildTopicReplyOptions: () => ({}),
      logger: { error: () => {} },
    });
    assert.equal(result.route, "command");
  }

  assert.equal(debouncedCalls, 0);
  assert.equal(mutationCalls.register.length, 1);
  assert.equal(mutationCalls.pin.length, 1);
  assert.equal(mutationCalls.unpin.length, 1);
  assert.equal(mutationCalls.orchestrate.length, 3);
  assert.ok(
    mutationCalls.orchestrate.every(
      (request) => request.metadata?.suppressUserMessagePersist === true,
    ),
  );

  const commandPayloads = feedbackEvents.map((event) => event.payload);
  assert.equal(commandPayloads.length, 3);
  assert.deepEqual(
    commandPayloads.map((payload) => payload.command),
    ["agents", "agents", "agents"],
  );
  assert.ok(commandPayloads.every((payload) => payload.outcome === "success"));
  assert.equal(commandPayloads[0].args.containsFreeText, true);
  assert.equal(typeof commandPayloads[1].args.hash, "string");
  assert.equal(typeof commandPayloads[2].args.hash, "string");
});
