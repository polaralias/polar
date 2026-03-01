import crypto from "node:crypto";

const COMMAND_ACCESS_CONFIG = Object.freeze({
  resourceType: "policy",
  resourceId: "telegram_command_access",
});
const CHAT_FLAGS_RESOURCE_TYPE = "policy";
const MODEL_REGISTRY_EMPTY = Object.freeze({
  version: 1,
  entries: Object.freeze([]),
  defaults: null,
});

/**
 * @param {string} value
 */
function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * @param {string} value
 */
function asTrimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 */
function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * @param {string} text
 * @param {{ allowBangPrefix?: boolean }} [options]
 */
export function parseSlashCommand(text, options = {}) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  const allowBangPrefix = options.allowBangPrefix === true;
  const firstChar = text[0];
  if (firstChar !== "/" && !(allowBangPrefix && firstChar === "!")) {
    return null;
  }
  const withoutPrefix = text.slice(1);
  const firstSpace = withoutPrefix.search(/\s/);
  const commandToken =
    firstSpace < 0 ? withoutPrefix : withoutPrefix.slice(0, firstSpace);
  const argsRaw = firstSpace < 0 ? "" : withoutPrefix.slice(firstSpace + 1);
  const atIndex = commandToken.indexOf("@");
  const command = (atIndex >= 0 ? commandToken.slice(0, atIndex) : commandToken)
    .trim()
    .toLowerCase();
  if (!command) {
    return null;
  }
  return Object.freeze({
    command,
    argsRaw,
    prefix: firstChar,
  });
}

/**
 * @param {string} raw
 */
export function parseSchedulePromptPair(raw) {
  const delimiterIndex = raw.indexOf("|");
  if (delimiterIndex < 0) {
    return {
      ok: false,
      error: "Expected format: <schedule> | <prompt>",
    };
  }
  const schedule = raw.slice(0, delimiterIndex).trim();
  const promptTemplate = raw.slice(delimiterIndex + 1).trim();
  if (!schedule || !promptTemplate) {
    return {
      ok: false,
      error: "Both schedule and prompt are required",
    };
  }
  return {
    ok: true,
    schedule,
    promptTemplate,
  };
}

/**
 * @param {{ usage: string, example: string, message: string }} request
 */
function createUsageError(request) {
  const error = new Error(request.message);
  error.name = "CommandUsageError";
  error.usage = request.usage;
  error.example = request.example;
  return error;
}

/**
 * @param {{ message: string, usage: string, example: string }} request
 */
function formatUsageError(request) {
  return `${request.message}\nUsage: ${request.usage}\nExample: ${request.example}`;
}

/**
 * @param {unknown} value
 */
function normalizeModelRegistry(value) {
  if (!isPlainObject(value)) {
    return MODEL_REGISTRY_EMPTY;
  }
  const seenEntries = new Set();
  const seenAliases = new Set();
  const entries = [];
  for (const item of Array.isArray(value.entries) ? value.entries : []) {
    if (!isPlainObject(item)) {
      continue;
    }
    const provider = asTrimmed(item.provider);
    const modelId = asTrimmed(item.modelId);
    if (!provider || !modelId) {
      continue;
    }
    const key = `${provider}::${modelId}`;
    if (seenEntries.has(key)) {
      continue;
    }
    const normalized = { provider, modelId };
    const alias = asTrimmed(item.alias);
    if (alias && !seenAliases.has(alias)) {
      normalized.alias = alias;
      seenAliases.add(alias);
    }
    seenEntries.add(key);
    entries.push(normalized);
  }

  let defaults = null;
  if (isPlainObject(value.defaults)) {
    const provider = asTrimmed(value.defaults.provider);
    const modelId = asTrimmed(value.defaults.modelId);
    const alias = asTrimmed(value.defaults.alias);
    if (provider && modelId) {
      defaults = { provider, modelId };
      if (alias) {
        defaults.alias = alias;
      }
    }
  }

  return {
    version: 1,
    entries,
    defaults,
  };
}

/**
 * @param {{ entries: readonly Record<string, unknown>[], provider: string, target: string }} request
 */
function resolveRegistryTarget({ entries, provider, target }) {
  const exact = entries.find(
    (entry) =>
      asTrimmed(entry.provider) === provider &&
      asTrimmed(entry.modelId) === target,
  );
  if (exact) {
    return exact;
  }
  return (
    entries.find(
      (entry) =>
        asTrimmed(entry.provider) === provider &&
        asTrimmed(entry.alias) === target,
    ) || null
  );
}

/**
 * @param {readonly Record<string, unknown>[]} entries
 * @param {string} provider
 * @param {string} modelId
 * @param {string} alias
 */
function upsertRegistryEntry(entries, provider, modelId, alias) {
  const next = [];
  let replaced = false;
  for (const entry of entries) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const entryProvider = asTrimmed(entry.provider);
    const entryModelId = asTrimmed(entry.modelId);
    const entryAlias = asTrimmed(entry.alias);
    if (entryProvider === provider && entryModelId === modelId) {
      if (!replaced) {
        next.push(alias ? { provider, modelId, alias } : { provider, modelId });
        replaced = true;
      }
      continue;
    }
    if (alias && entryAlias && entryAlias === alias) {
      continue;
    }
    next.push(entry);
  }
  if (!replaced) {
    next.push(alias ? { provider, modelId, alias } : { provider, modelId });
  }
  return next;
}

/**
 * @param {readonly Record<string, unknown>[]} entries
 * @param {string} provider
 * @param {string} target
 */
function removeRegistryEntry(entries, provider, target) {
  const next = [];
  let removed = null;
  for (const entry of entries) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const entryProvider = asTrimmed(entry.provider);
    const entryModelId = asTrimmed(entry.modelId);
    const entryAlias = asTrimmed(entry.alias);
    if (
      entryProvider === provider &&
      (entryModelId === target || (entryAlias && entryAlias === target))
    ) {
      removed = entry;
      continue;
    }
    next.push(entry);
  }
  return { next, removed };
}

/**
 * @param {{ controlPlane: Record<string, (...args: unknown[]) => Promise<unknown>|unknown>, cacheTtlMs?: number }} request
 */
function createAuthResolver(request) {
  const cacheTtlMs = typeof request.cacheTtlMs === "number" ? request.cacheTtlMs : 30_000;
  let cache = null;

  async function ensureConfigRecord() {
    const existing = await request.controlPlane.getConfig(COMMAND_ACCESS_CONFIG);
    if (existing.status === "found") {
      return existing.config;
    }
    await request.controlPlane.upsertConfig({
      ...COMMAND_ACCESS_CONFIG,
      config: {
        operatorUserIds: [],
        adminUserIds: [],
        allowBangCommands: false,
      },
    });
    return {
      operatorUserIds: [],
      adminUserIds: [],
      allowBangCommands: false,
    };
  }

  /**
   * @param {unknown} rawConfig
   * @param {readonly string[]} fallbackOperatorIds
   * @param {readonly string[]} fallbackAdminIds
   */
  function normalize(rawConfig, fallbackOperatorIds, fallbackAdminIds) {
    const config = isPlainObject(rawConfig) ? rawConfig : {};
    const operatorUserIds = new Set(
      [
        ...(Array.isArray(config.operatorUserIds) ? config.operatorUserIds : []),
        ...fallbackOperatorIds,
      ]
        .map((value) => asTrimmed(String(value)))
        .filter((value) => value.length > 0),
    );
    const adminUserIds = new Set(
      [
        ...(Array.isArray(config.adminUserIds) ? config.adminUserIds : []),
        ...fallbackAdminIds,
      ]
        .map((value) => asTrimmed(String(value)))
        .filter((value) => value.length > 0),
    );
    for (const adminId of adminUserIds) {
      operatorUserIds.add(adminId);
    }
    return {
      operatorUserIds,
      adminUserIds,
      allowBangCommands: config.allowBangCommands === true,
    };
  }

  return Object.freeze({
    /**
     * @param {{ nowMs: number, userId: string, fallbackOperatorIds: readonly string[], fallbackAdminIds: readonly string[] }} request
     */
    async resolve(request) {
      if (cache !== null && request.nowMs - cache.cachedAtMs < cacheTtlMs) {
        return {
          isOperator: cache.operatorUserIds.has(request.userId),
          isAdmin: cache.adminUserIds.has(request.userId),
          allowBangCommands: cache.allowBangCommands,
        };
      }

      const config = await ensureConfigRecord();
      const normalized = normalize(
        config,
        request.fallbackOperatorIds,
        request.fallbackAdminIds,
      );
      cache = {
        ...normalized,
        cachedAtMs: request.nowMs,
      };

      return {
        isOperator: normalized.operatorUserIds.has(request.userId),
        isAdmin: normalized.adminUserIds.has(request.userId),
        allowBangCommands: normalized.allowBangCommands,
      };
    },
  });
}

/**
 * @param {"public"|"operator"|"admin"} requiredAccess
 * @param {{ isOperator: boolean, isAdmin: boolean }} auth
 */
function hasAccess(requiredAccess, auth) {
  if (requiredAccess === "public") {
    return true;
  }
  if (requiredAccess === "operator") {
    return auth.isOperator || auth.isAdmin;
  }
  return auth.isAdmin;
}

/**
 * @param {unknown} chatId
 */
function createChatFlagResourceId(chatId) {
  return `telegram_chat_flags:${String(chatId)}`;
}

/**
 * @param {{
 *   controlPlane: Record<string, (...args: unknown[]) => Promise<unknown>|unknown>,
 *   dbPath: string,
 *   now?: () => number,
 *   resolveSessionContext: (ctx: unknown) => Promise<{ sessionId: string }>,
 *   deriveThreadKey: (message: unknown) => string,
 *   setReactionState: (ctx: unknown, chatId: number|string, messageId: number, state: string) => Promise<void>,
 *   replyWithOptions: (ctx: unknown, text: string, options?: { markdown?: boolean }) => Promise<void>,
 *   fallbackOperatorUserIds?: readonly string[],
 *   fallbackAdminUserIds?: readonly string[],
 *   logger?: { warn?: (...args: unknown[]) => void, error?: (...args: unknown[]) => void }
 * }} config
 */
export function createTelegramCommandRouter({
  controlPlane,
  dbPath,
  now = () => Date.now(),
  resolveSessionContext,
  deriveThreadKey,
  setReactionState,
  replyWithOptions,
  fallbackOperatorUserIds = [],
  fallbackAdminUserIds = [],
  logger = console,
}) {
  const authResolver = createAuthResolver({ controlPlane });

  /**
   * @param {{
   *   command: string,
   *   outcome: "success"|"failure"|"denied",
   *   userId: string,
   *   sessionId: string,
   *   threadKey: string,
   *   argsRaw: string,
   *   containsFreeText: boolean,
   *   error?: string
   * }} entry
   */
  async function auditCommand(entry) {
    const argsLength = entry.argsRaw.length;
    const argsMeta = {
      length: argsLength,
      containsFreeText: entry.containsFreeText,
    };
    if (!entry.containsFreeText && argsLength > 0) {
      argsMeta.hash = sha256(entry.argsRaw);
    }
    await controlPlane.recordFeedbackEvent({
      type: "command_executed",
      sessionId: entry.sessionId,
      messageId: `command:${entry.command}:${now()}`,
      polarity: entry.outcome === "success" ? "positive" : "neutral",
      payload: {
        command: entry.command,
        outcome: entry.outcome,
        userId: entry.userId,
        sessionId: entry.sessionId,
        threadKey: entry.threadKey,
        args: argsMeta,
        timestampMs: now(),
        ...(entry.error ? { error: entry.error } : {}),
      },
    });
  }

  /**
   * @param {unknown} ctx
   * @param {{ usage: string, example: string, message: string }} details
   */
  async function replyUsageError(ctx, details) {
    await replyWithOptions(ctx, formatUsageError(details));
  }

  /**
   * @param {unknown} ctx
   * @param {{
   *   sessionId: string,
   *   userId: string,
   *   chatId: string|number,
   *   threadKey: string,
   *   username: string|null,
   *   auth: { isOperator: boolean, isAdmin: boolean }
   * }} identity
   * @param {string} argsRaw
   */
  async function handleHelp(ctx, identity, argsRaw) {
    const topic = asTrimmed(argsRaw).toLowerCase();

    if (topic) {
      const target = commandIndex.get(topic);
      if (!target || !hasAccess(target.access, identity.auth)) {
        await replyWithOptions(ctx, `No help topic found for "${topic}".`);
        return;
      }
      await replyWithOptions(
        ctx,
        [`/${target.name} - ${target.help}`, `Usage: ${target.usage}`, `Example: ${target.example}`].join("\n"),
      );
      return;
    }

    const visible = commandDefinitions.filter((definition) =>
      hasAccess(definition.access, identity.auth),
    );
    const lines = visible.map((definition) => `/${definition.name} - ${definition.help}`);
    await replyWithOptions(ctx, `Commands:\n${lines.join("\n")}`);
  }

  /**
   * @param {unknown} ctx
   * @param {{
   *   sessionId: string,
   *   userId: string,
   *   chatId: string|number,
   *   threadKey: string,
   *   username: string|null
   * }} identity
   */
  async function handleWhoAmI(ctx, identity) {
    await replyWithOptions(
      ctx,
      [
        `userId: ${identity.userId}`,
        `chatId: ${identity.chatId}`,
        `sessionId: ${identity.sessionId}`,
        `threadKey: ${identity.threadKey}`,
        `username: ${identity.username ?? "n/a"}`,
      ].join("\n"),
    );
  }

  /**
   * @param {unknown} ctx
   * @param {{ sessionId: string, userId: string, threadKey: string }} identity
   */
  async function handleStatus(ctx, identity) {
    const [health, history, automations] = await Promise.all([
      controlPlane.health(),
      controlPlane.getSessionHistory({ sessionId: identity.sessionId, limit: 1 }),
      controlPlane.listAutomationJobs({ ownerUserId: identity.userId, sessionId: identity.sessionId, limit: 1 }),
    ]);

    const lastMessage = Array.isArray(history.items) && history.items.length > 0 ? history.items[history.items.length - 1] : null;
    const lastMessageIso =
      typeof lastMessage?.timestampMs === "number"
        ? new Date(lastMessage.timestampMs).toISOString()
        : "unknown";

    await replyWithOptions(
      ctx,
      [
        `status: ${health.status}`,
        `sessionId: ${identity.sessionId}`,
        `threadKey: ${identity.threadKey}`,
        `dbPath: ${dbPath}`,
        `lastMessageAt: ${lastMessageIso}`,
        `automationJobs: ${automations.totalCount ?? 0}`,
      ].join("\n"),
    );
  }

  /**
   * @param {unknown} ctx
   */
  async function handlePing(ctx) {
    await replyWithOptions(ctx, `pong ${new Date(now()).toISOString()}`);
  }

  /**
   * @param {unknown} ctx
   * @param {{ sessionId: string, userId: string, auth: { isOperator: boolean, isAdmin: boolean } }} identity
   * @param {string} argsRaw
   */
  async function handlePersonality(ctx, identity, argsRaw) {
    const trimmed = asTrimmed(argsRaw);
    if (!trimmed || trimmed === "show") {
      const effective = await controlPlane.getEffectivePersonality({
        userId: identity.userId,
        sessionId: identity.sessionId,
      });
      if (effective.status !== "found") {
        await replyWithOptions(ctx, "No personality profile is active.");
        return;
      }
      const prompt = typeof effective.profile?.prompt === "string" ? effective.profile.prompt : "";
      const preview = prompt.length > 200 ? `${prompt.slice(0, 200)}...` : prompt;
      const updatedAtIso =
        typeof effective.profile?.updatedAtMs === "number"
          ? new Date(effective.profile.updatedAtMs).toISOString()
          : "unknown";
      await replyWithOptions(
        ctx,
        [
          `scope: ${effective.profile.scope}`,
          `updatedAt: ${updatedAtIso}`,
          `preview: ${preview || "(empty)"}`,
        ].join("\n"),
      );
      return;
    }

    if (trimmed === "preview") {
      const previewResult = await controlPlane.orchestrate({
        sessionId: identity.sessionId,
        userId: identity.userId,
        messageId: `msg_cmd_personality_preview_${now()}`,
        text: "Give a short response in my current configured style.",
        metadata: {
          previewMode: true,
          source: "telegram_command_personality_preview",
        },
      });
      await replyWithOptions(
        ctx,
        typeof previewResult?.text === "string" && previewResult.text
          ? previewResult.text
          : "Preview unavailable.",
      );
      return;
    }

    if (trimmed.startsWith("set ")) {
      let scope = "user";
      let prompt = trimmed.slice(4);
      if (prompt.startsWith("--session ")) {
        scope = "session";
        prompt = prompt.slice("--session ".length);
      } else if (prompt.startsWith("--global ")) {
        scope = "global";
        prompt = prompt.slice("--global ".length);
      }
      const finalPrompt = asTrimmed(prompt);
      if (!finalPrompt) {
        throw createUsageError({
          message: "Missing personality text.",
          usage: "/personality set [--session|--global] <text>",
          example: "/personality set --session Keep answers concise and practical.",
        });
      }
      if (scope === "global" && !(identity.auth.isOperator || identity.auth.isAdmin)) {
        throw new Error("Global personality changes require operator access.");
      }
      const result = await controlPlane.upsertPersonalityProfile({
        scope,
        prompt: finalPrompt,
        ...(scope !== "global" ? { userId: identity.userId } : {}),
        ...(scope === "session" ? { sessionId: identity.sessionId } : {}),
      });
      await replyWithOptions(ctx, `Personality updated (${result.profile.scope} scope).`);
      return;
    }

    if (trimmed === "reset" || trimmed === "reset --session" || trimmed === "reset --global") {
      const scope =
        trimmed === "reset --session"
          ? "session"
          : trimmed === "reset --global"
            ? "global"
            : "user";
      if (scope === "global" && !(identity.auth.isOperator || identity.auth.isAdmin)) {
        throw new Error("Global personality reset requires operator access.");
      }
      const result = await controlPlane.resetPersonalityProfile({
        scope,
        ...(scope !== "global" ? { userId: identity.userId } : {}),
        ...(scope === "session" ? { sessionId: identity.sessionId } : {}),
      });
      await replyWithOptions(
        ctx,
        result.deleted
          ? `Personality reset (${scope} scope).`
          : `No personality profile found for ${scope} scope.`,
      );
      return;
    }

    throw createUsageError({
      message: "Unknown personality subcommand.",
      usage: "/personality [show|preview|set|reset]",
      example: "/personality set Write with direct, implementation-first guidance.",
    });
  }

  /**
   * @param {{ job: Record<string, unknown>, identity: { userId: string, auth: { isOperator: boolean, isAdmin: boolean } } }} request
   */
  function ensureJobAccess(request) {
    if (request.identity.auth.isOperator || request.identity.auth.isAdmin) {
      return;
    }
    if (asTrimmed(request.job.ownerUserId) !== request.identity.userId) {
      throw new Error("You can only manage your own automation jobs.");
    }
  }

  /**
   * @param {unknown} ctx
   * @param {{ sessionId: string, userId: string, auth: { isOperator: boolean, isAdmin: boolean } }} identity
   * @param {string} argsRaw
   */
  async function handleAutomations(ctx, identity, argsRaw) {
    const trimmed = asTrimmed(argsRaw);
    if (!trimmed || trimmed === "list" || trimmed.startsWith("--")) {
      let ownerUserId = identity.userId;
      if (trimmed === "--all") {
        if (!(identity.auth.isOperator || identity.auth.isAdmin)) {
          throw new Error("/automations --all requires operator access.");
        }
        ownerUserId = undefined;
      } else if (trimmed.startsWith("--user ")) {
        if (!(identity.auth.isOperator || identity.auth.isAdmin)) {
          throw new Error("/automations --user requires operator access.");
        }
        ownerUserId = asTrimmed(trimmed.slice("--user ".length));
        if (!ownerUserId) {
          throw createUsageError({
            message: "Missing userId.",
            usage: "/automations --user <userId>",
            example: "/automations --user 12345",
          });
        }
      }

      const listed = await controlPlane.listAutomationJobs({
        ...(ownerUserId ? { ownerUserId } : {}),
        ...(ownerUserId ? { sessionId: identity.sessionId } : {}),
        limit: 20,
      });
      const items = Array.isArray(listed.items) ? listed.items : [];
      if (items.length === 0) {
        await replyWithOptions(ctx, "No automation jobs found.");
        return;
      }
      const lines = items.map((item) => {
        const shortPrompt = asTrimmed(item.promptTemplate).slice(0, 80);
        return `- ${item.id} | ${item.enabled ? "enabled" : "disabled"} | ${item.schedule} | ${shortPrompt}`;
      });
      await replyWithOptions(ctx, `Automation jobs:\n${lines.join("\n")}`);
      return;
    }

    if (trimmed.startsWith("create ")) {
      const pair = parseSchedulePromptPair(trimmed.slice("create ".length));
      if (!pair.ok) {
        throw createUsageError({
          message: pair.error,
          usage: "/automations create <schedule> | <prompt>",
          example: "/automations create daily 18:00 | Tell me to do evening mobility.",
        });
      }
      const preview = await controlPlane.previewAutomationJob({
        schedule: pair.schedule,
        promptTemplate: pair.promptTemplate,
      });
      const created = await controlPlane.createAutomationJob({
        ownerUserId: identity.userId,
        sessionId: identity.sessionId,
        schedule: preview.preview.schedule,
        promptTemplate: preview.preview.promptTemplate,
      });
      await replyWithOptions(ctx, `Automation created. id=${created.job.id}`);
      return;
    }

    if (trimmed.startsWith("preview ")) {
      const pair = parseSchedulePromptPair(trimmed.slice("preview ".length));
      if (!pair.ok) {
        throw createUsageError({
          message: pair.error,
          usage: "/automations preview <schedule> | <prompt>",
          example: "/automations preview weekly Mon 07:00 | Weekly planning check.",
        });
      }
      const preview = await controlPlane.previewAutomationJob({
        schedule: pair.schedule,
        promptTemplate: pair.promptTemplate,
      });
      await replyWithOptions(
        ctx,
        [
          "Preview:",
          `schedule: ${preview.preview.schedule}`,
          `prompt: ${preview.preview.promptTemplate}`,
        ].join("\n"),
      );
      return;
    }

    const [subcommand, ...restParts] = trimmed.split(/\s+/);
    const jobId = asTrimmed(restParts.join(" "));
    if (!jobId) {
      throw createUsageError({
        message: "Missing jobId.",
        usage: "/automations <show|enable|disable|delete|run> <jobId>",
        example: "/automations show auto_abc123",
      });
    }

    const found = await controlPlane.getAutomationJob({ id: jobId });
    if (found.status !== "found" || !found.job) {
      await replyWithOptions(ctx, `Automation job not found: ${jobId}`);
      return;
    }
    ensureJobAccess({ job: found.job, identity });

    if (subcommand === "show") {
      await replyWithOptions(
        ctx,
        [
          `id: ${found.job.id}`,
          `enabled: ${found.job.enabled}`,
          `ownerUserId: ${found.job.ownerUserId}`,
          `sessionId: ${found.job.sessionId}`,
          `schedule: ${found.job.schedule}`,
          `promptTemplate: ${found.job.promptTemplate}`,
        ].join("\n"),
      );
      return;
    }

    if (subcommand === "enable") {
      const result = await controlPlane.enableAutomationJob({ id: jobId });
      await replyWithOptions(ctx, result.status === "updated" ? `Enabled ${jobId}.` : `Job ${jobId} not found.`);
      return;
    }

    if (subcommand === "disable") {
      const result = await controlPlane.disableAutomationJob({ id: jobId });
      await replyWithOptions(ctx, result.status === "disabled" ? `Disabled ${jobId}.` : `Job ${jobId} not found.`);
      return;
    }

    if (subcommand === "delete") {
      const result = await controlPlane.deleteAutomationJob({ id: jobId });
      await replyWithOptions(ctx, result.status === "deleted" ? `Deleted ${jobId}.` : `Job ${jobId} not found.`);
      return;
    }

    if (subcommand === "run") {
      const result = await controlPlane.runAutomationJob({
        id: jobId,
        sessionId: identity.sessionId,
        userId: identity.userId,
      });
      if (result.status !== "completed") {
        await replyWithOptions(ctx, `Job ${jobId} not found.`);
        return;
      }
      await replyWithOptions(
        ctx,
        `Run triggered (${result.runId}).\n${typeof result.output?.text === "string" ? result.output.text : "Completed."}`,
      );
      return;
    }

    throw createUsageError({
      message: "Unknown automations subcommand.",
      usage: "/automations [list|create|preview|show|enable|disable|delete|run] ...",
      example: "/automations run auto_abc123",
    });
  }

  /**
   * @param {unknown} ctx
   * @param {{ chatId: string|number, auth: { isOperator: boolean, isAdmin: boolean } }} identity
   * @param {string} argsRaw
   */
  async function handleArtifacts(ctx, identity, argsRaw) {
    const trimmed = asTrimmed(argsRaw);
    if (!trimmed || trimmed === "show") {
      const result = await controlPlane.showArtifacts({});
      const lines = (Array.isArray(result.items) ? result.items : []).map((item) => {
        const stamp =
          typeof item.updatedAtMs === "number"
            ? new Date(item.updatedAtMs).toISOString()
            : "not generated";
        return `- ${item.filename}: ${stamp}`;
      });
      await replyWithOptions(ctx, lines.length > 0 ? `Artifacts:\n${lines.join("\n")}` : "No artifacts found.");
      return;
    }

    if (trimmed === "export") {
      let allowed = identity.auth.isOperator || identity.auth.isAdmin;
      if (!allowed) {
        const chatFlags = await controlPlane.getConfig({
          resourceType: CHAT_FLAGS_RESOURCE_TYPE,
          resourceId: createChatFlagResourceId(identity.chatId),
        });
        allowed = chatFlags.status === "found" && isPlainObject(chatFlags.config) && chatFlags.config.allowArtifactsExport === true;
      }
      if (!allowed) {
        throw new Error("Artifacts export requires operator access.");
      }
      const result = await controlPlane.exportArtifacts({});
      await replyWithOptions(ctx, `Artifacts exported (${result.files.length} files).`);
      return;
    }

    throw createUsageError({
      message: "Unknown artifacts subcommand.",
      usage: "/artifacts [show|export]",
      example: "/artifacts show",
    });
  }

  /**
   * @param {unknown} ctx
   * @param {string} argsRaw
   */
  async function handleModels(ctx, argsRaw) {
    const trimmed = asTrimmed(argsRaw);
    const [subcommandRaw, ...rest] = trimmed ? trimmed.split(/\s+/) : ["list"];
    const subcommand = (subcommandRaw || "list").toLowerCase();
    const restRaw = rest.join(" ").trim();

    const registryResponse = await controlPlane.getModelRegistry({});
    const registry = normalizeModelRegistry(registryResponse.registry);

    if (subcommand === "list") {
      const providers = [...new Set(registry.entries.map((entry) => asTrimmed(entry.provider)))];
      const providerModels = [];
      for (const provider of providers) {
        try {
          const listed = await controlPlane.listModels({ providerId: provider });
          providerModels.push({
            provider,
            models: Array.isArray(listed.models) ? listed.models : [],
          });
        } catch {
          providerModels.push({ provider, models: [] });
        }
      }

      const lines = [];
      lines.push("Registered models:");
      if (registry.entries.length === 0) {
        lines.push("- (none)");
      } else {
        for (const entry of registry.entries) {
          lines.push(`- ${entry.provider} ${entry.modelId}${entry.alias ? ` (alias: ${entry.alias})` : ""}`);
        }
      }
      if (registry.defaults) {
        lines.push(`default: ${registry.defaults.provider} ${registry.defaults.modelId}`);
      } else {
        lines.push("default: (not set)");
      }

      if (providerModels.length > 0) {
        lines.push("provider models:");
        for (const item of providerModels) {
          const summary = item.models.length > 0 ? item.models.join(", ") : "(unavailable)";
          lines.push(`- ${item.provider}: ${summary}`);
        }
      }
      await replyWithOptions(ctx, lines.join("\n"));
      return;
    }

    if (subcommand === "register") {
      const tokens = restRaw.split(/\s+/).filter((token) => token.length > 0);
      if (tokens.length < 2) {
        throw createUsageError({
          message: "Missing provider/modelId.",
          usage: "/models register <provider> <modelId> [--alias <alias>]",
          example: "/models register openai gpt-5-mini --alias fast",
        });
      }
      const provider = tokens[0];
      const modelId = tokens[1];
      let alias = "";
      const aliasIndex = tokens.indexOf("--alias");
      if (aliasIndex >= 0) {
        alias = asTrimmed(tokens[aliasIndex + 1]);
        if (!alias) {
          throw createUsageError({
            message: "Missing alias value after --alias.",
            usage: "/models register <provider> <modelId> [--alias <alias>]",
            example: "/models register openai gpt-5-mini --alias fast",
          });
        }
      }

      const nextEntries = upsertRegistryEntry(registry.entries, provider, modelId, alias);
      const nextRegistry = {
        version: 1,
        entries: nextEntries,
        defaults: registry.defaults,
      };
      await controlPlane.upsertModelRegistry({ registry: nextRegistry });
      await replyWithOptions(ctx, `Registered model ${provider} ${modelId}${alias ? ` as ${alias}` : ""}.`);
      return;
    }

    if (subcommand === "unregister") {
      const tokens = restRaw.split(/\s+/).filter((token) => token.length > 0);
      if (tokens.length < 2) {
        throw createUsageError({
          message: "Missing provider and modelId|alias.",
          usage: "/models unregister <provider> <modelId|alias>",
          example: "/models unregister openai fast",
        });
      }
      const provider = tokens[0];
      const target = tokens[1];
      const removed = removeRegistryEntry(registry.entries, provider, target);
      if (!removed.removed) {
        await replyWithOptions(ctx, `No registry entry found for ${provider} ${target}.`);
        return;
      }
      const removedModelId = asTrimmed(removed.removed.modelId);
      const nextDefaults =
        registry.defaults &&
        asTrimmed(registry.defaults.provider) === provider &&
        asTrimmed(registry.defaults.modelId) === removedModelId
          ? null
          : registry.defaults;
      await controlPlane.upsertModelRegistry({
        registry: {
          version: 1,
          entries: removed.next,
          defaults: nextDefaults,
        },
      });
      await replyWithOptions(ctx, `Unregistered model ${provider} ${target}.`);
      return;
    }

    if (subcommand === "set-default") {
      const tokens = restRaw.split(/\s+/).filter((token) => token.length > 0);
      if (tokens.length < 2) {
        throw createUsageError({
          message: "Missing provider and modelId|alias.",
          usage: "/models set-default <provider> <modelId|alias>",
          example: "/models set-default openai fast",
        });
      }
      const provider = tokens[0];
      const target = tokens[1];
      const resolved = resolveRegistryTarget({ entries: registry.entries, provider, target });
      if (!resolved) {
        throw new Error(`Model registration not found: ${provider} ${target}`);
      }
      const modelId = asTrimmed(resolved.modelId);
      const nextRegistry = {
        version: 1,
        entries: registry.entries,
        defaults: {
          provider,
          modelId,
          ...(asTrimmed(resolved.alias) ? { alias: asTrimmed(resolved.alias) } : {}),
        },
      };
      await controlPlane.upsertModelRegistry({ registry: nextRegistry });
      await controlPlane.setModelRegistryDefault({
        providerId: provider,
        modelId,
      });
      await replyWithOptions(ctx, `Default model set to ${provider} ${modelId}.`);
      return;
    }

    throw createUsageError({
      message: "Unknown models subcommand.",
      usage: "/models [list|register|unregister|set-default] ...",
      example: "/models list",
    });
  }

  /**
   * @param {unknown} ctx
   */
  async function handleSkillsStub(ctx) {
    await replyWithOptions(ctx, "Skills chat commands are not supported yet in this runner.");
  }

  /**
   * @param {unknown} ctx
   */
  async function handleMemoryStub(ctx) {
    await replyWithOptions(ctx, "Memory chat commands are not supported yet in this runner.");
  }

  const commandDefinitions = Object.freeze([
    {
      name: "help",
      aliases: ["commands"],
      help: "Show command help.",
      usage: "/help [topic]",
      example: "/help automations",
      access: "public",
      containsFreeText: () => false,
      handler: (ctx, identity, argsRaw) => handleHelp(ctx, identity, argsRaw),
    },
    {
      name: "whoami",
      aliases: [],
      help: "Show derived identity and chat context.",
      usage: "/whoami",
      example: "/whoami",
      access: "public",
      containsFreeText: () => false,
      handler: (ctx, identity) => handleWhoAmI(ctx, identity),
    },
    {
      name: "status",
      aliases: [],
      help: "Show session status and health hints.",
      usage: "/status",
      example: "/status",
      access: "public",
      containsFreeText: () => false,
      handler: (ctx, identity) => handleStatus(ctx, identity),
    },
    {
      name: "ping",
      aliases: [],
      help: "Health ping.",
      usage: "/ping",
      example: "/ping",
      access: "public",
      containsFreeText: () => false,
      handler: (ctx) => handlePing(ctx),
    },
    {
      name: "personality",
      aliases: [],
      help: "Show or update personality profiles.",
      usage: "/personality [show|preview|set|reset]",
      example: "/personality set --session Keep responses concise.",
      access: "public",
      containsFreeText: (argsRaw) => asTrimmed(argsRaw).startsWith("set "),
      handler: (ctx, identity, argsRaw) => handlePersonality(ctx, identity, argsRaw),
    },
    {
      name: "automations",
      aliases: [],
      help: "Manage automation jobs.",
      usage: "/automations [list|create|preview|show|enable|disable|delete|run]",
      example: "/automations create daily 18:00 | Tell me to stretch.",
      access: "public",
      containsFreeText: (argsRaw) => {
        const trimmed = asTrimmed(argsRaw);
        return trimmed.startsWith("create ") || trimmed.startsWith("preview ");
      },
      handler: (ctx, identity, argsRaw) => handleAutomations(ctx, identity, argsRaw),
    },
    {
      name: "artifacts",
      aliases: [],
      help: "Show or export artifacts.",
      usage: "/artifacts [show|export]",
      example: "/artifacts show",
      access: "public",
      containsFreeText: () => false,
      handler: (ctx, identity, argsRaw) => handleArtifacts(ctx, identity, argsRaw),
    },
    {
      name: "models",
      aliases: [],
      help: "List or manage model registry.",
      usage: "/models [list|register|unregister|set-default]",
      example: "/models register openai gpt-5-mini --alias fast",
      access: "operator",
      containsFreeText: () => false,
      handler: (ctx, _identity, argsRaw) => handleModels(ctx, argsRaw),
    },
    {
      name: "memory",
      aliases: [],
      help: "Memory command surface (not yet implemented).",
      usage: "/memory search <query> | /memory show <memoryId>",
      example: "/memory search daily recap",
      access: "operator",
      containsFreeText: () => false,
      handler: (ctx) => handleMemoryStub(ctx),
    },
    {
      name: "skills",
      aliases: ["extensions"],
      help: "Skills/extensions command surface (not yet implemented).",
      usage: "/skills list|install|block|unblock",
      example: "/skills list",
      access: "operator",
      containsFreeText: () => false,
      handler: (ctx) => handleSkillsStub(ctx),
    },
  ]);

  const commandIndex = new Map();
  for (const definition of commandDefinitions) {
    commandIndex.set(definition.name, definition);
    for (const alias of definition.aliases) {
      commandIndex.set(alias, definition);
    }
  }

  return Object.freeze({
    /**
     * @param {unknown} ctx
     */
    async handle(ctx) {
      const rawText = ctx?.message?.text;
      if (typeof rawText !== "string") {
        return { handled: false };
      }

      const nowMs = now();
      const userId = String(ctx.from?.id ?? "");
      if (!userId) {
        return { handled: false };
      }

      const auth = await authResolver.resolve({
        nowMs,
        userId,
        fallbackOperatorIds: fallbackOperatorUserIds,
        fallbackAdminIds: fallbackAdminUserIds,
      });

      const parsed = parseSlashCommand(rawText, {
        allowBangPrefix: auth.allowBangCommands,
      });
      if (!parsed) {
        return { handled: false };
      }

      const sessionContext = await resolveSessionContext(ctx);
      const sessionId = sessionContext.sessionId;
      const chatId = ctx.chat?.id ?? ctx.message?.chat?.id ?? "unknown";
      const messageId = Number(ctx.message?.message_id ?? 0);
      const threadKey = deriveThreadKey(ctx.message);
      const username = typeof ctx.from?.username === "string" ? ctx.from.username : null;
      const identity = {
        sessionId,
        userId,
        chatId,
        threadKey,
        username,
        auth,
      };

      await setReactionState(ctx, chatId, messageId, "received");

      const definition = commandIndex.get(parsed.command);
      if (!definition) {
        await replyWithOptions(ctx, `Unknown command: /${parsed.command}. Try /help.`);
        await setReactionState(ctx, chatId, messageId, "done");
        await auditCommand({
          command: parsed.command,
          outcome: "failure",
          userId,
          sessionId,
          threadKey,
          argsRaw: parsed.argsRaw,
          containsFreeText: false,
          error: "unknown_command",
        });
        return { handled: true };
      }

      if (!hasAccess(definition.access, auth)) {
        const deniedText = formatUsageError({
          message: "Access denied.",
          usage: definition.usage,
          example: definition.example,
        });
        logger.warn?.(
          `[COMMAND_DENIED] command=/${definition.name} userId=${userId} sessionId=${sessionId} threadKey=${threadKey}`,
        );
        await replyWithOptions(ctx, deniedText);
        await setReactionState(ctx, chatId, messageId, "error");
        await auditCommand({
          command: definition.name,
          outcome: "denied",
          userId,
          sessionId,
          threadKey,
          argsRaw: parsed.argsRaw,
          containsFreeText: definition.containsFreeText(parsed.argsRaw),
          error: "access_denied",
        });
        return { handled: true };
      }

      try {
        await definition.handler(ctx, identity, parsed.argsRaw);
        await setReactionState(ctx, chatId, messageId, "done");
        await auditCommand({
          command: definition.name,
          outcome: "success",
          userId,
          sessionId,
          threadKey,
          argsRaw: parsed.argsRaw,
          containsFreeText: definition.containsFreeText(parsed.argsRaw),
        });
        return { handled: true };
      } catch (error) {
        await setReactionState(ctx, chatId, messageId, "error");
        if (error?.name === "CommandUsageError") {
          await replyUsageError(ctx, {
            message: error.message,
            usage: error.usage,
            example: error.example,
          });
        } else {
          await replyWithOptions(
            ctx,
            formatUsageError({
              message: error instanceof Error ? error.message : "Command failed.",
              usage: definition.usage,
              example: definition.example,
            }),
          );
        }
        await auditCommand({
          command: definition.name,
          outcome: "failure",
          userId,
          sessionId,
          threadKey,
          argsRaw: parsed.argsRaw,
          containsFreeText: definition.containsFreeText(parsed.argsRaw),
          error: error instanceof Error ? error.message : String(error),
        });
        return { handled: true };
      }
    },
  });
}
