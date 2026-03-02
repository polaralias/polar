const REACTION_EMOJI_BY_STATE = Object.freeze({
  received: "👀",
  thinking: "✍",
  waiting_user: "🤔",
  done: "👌",
  error: "👎",
});

const REACTION_CANDIDATE_EMOJIS_BY_STATE = Object.freeze({
  received: Object.freeze(["👀", "❤"]),
  thinking: Object.freeze(["✍", "👨‍💻"]),
  waiting_user: Object.freeze(["🤔", "🙏"]),
  done: Object.freeze(["👌", "👍"]),
  error: Object.freeze(["👎", "😢"]),
});

const CONFIGURED_REACTION_EMOJIS = Object.freeze(
  Array.from(
    new Set(
      Object.values(REACTION_CANDIDATE_EMOJIS_BY_STATE).flatMap((candidates) => candidates),
    ),
  ),
);

/**
 * @param {unknown} value
 */
function parseFinitePositiveInteger(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * @param {string|number} chatId
 * @param {number} messageId
 */
function createReactionKey(chatId, messageId) {
  return `${chatId}:${messageId}`;
}

/**
 * @param {string} callbackData
 */
export function parseCallbackOriginMessageId(callbackData) {
  const parts = callbackData.split(":");
  const maybeId = parts[parts.length - 1];
  return parseFinitePositiveInteger(maybeId);
}

/**
 * @param {{
 *  doneClearMs?: number,
 *  clearRateLimitMs?: number,
 *  now?: () => number,
 *  scheduleTimeout?: (fn: () => void, delayMs: number) => unknown,
 *  cancelTimeout?: (timer: unknown) => void,
 *  logger?: { warn?: (...args: unknown[]) => void }
 * }} [options]
 */
export function createTelegramReactionController(options = {}) {
  const doneClearMs =
    typeof options.doneClearMs === "number" ? options.doneClearMs : 45_000;
  const clearRateLimitMs =
    typeof options.clearRateLimitMs === "number" ? options.clearRateLimitMs : 250;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const scheduleTimeout =
    typeof options.scheduleTimeout === "function"
      ? options.scheduleTimeout
      : (fn, delayMs) => setTimeout(fn, delayMs);
  const cancelTimeout =
    typeof options.cancelTimeout === "function"
      ? options.cancelTimeout
      : (timer) => clearTimeout(/** @type {NodeJS.Timeout} */ (timer));
  const logger = options.logger ?? console;

  const reactionStateMap = new Map();
  const reactionClearTimers = new Map();
  const reactionClearRateLimit = new Map();
  const reactionSupportByChat = new Map();

  /**
   * @param {string|number} chatId
   */
  function getChatReactionSupport(chatId) {
    let support = reactionSupportByChat.get(chatId);
    if (!support) {
      support = {
        disabled: false,
        hasAnySuccess: false,
        unsupportedEmojis: new Set(),
      };
      reactionSupportByChat.set(chatId, support);
    }
    return support;
  }

  /**
   * @param {unknown} ctx
   * @param {string} emoji
   * @param {number} messageId
   * @param {string|number} chatId
   */
  async function safeReact(ctx, emoji, messageId, chatId) {
    const support = getChatReactionSupport(chatId);
    if (support.disabled) {
      return false;
    }
    if (support.unsupportedEmojis.has(emoji)) {
      return false;
    }
    try {
      await ctx.telegram.setMessageReaction(chatId, messageId, [
        { type: "emoji", emoji },
      ]);
      support.hasAnySuccess = true;
      return true;
    } catch (error) {
      const errorMessage = String(error?.message || "");
      if (errorMessage.includes("REACTION_INVALID")) {
        const isNewlyUnsupported = !support.unsupportedEmojis.has(emoji);
        support.unsupportedEmojis.add(emoji);
        if (isNewlyUnsupported) {
          logger.warn?.(
            `[REACTION_UNSUPPORTED] Chat ${chatId} does not support emoji ${emoji}; skipping this emoji for future reactions.`,
          );
        }
        if (
          !support.hasAnySuccess &&
          CONFIGURED_REACTION_EMOJIS.every((candidate) =>
            support.unsupportedEmojis.has(candidate),
          )
        ) {
          if (!support.disabled) {
            logger.warn?.(
              `[REACTION_DISABLED] Chat ${chatId} rejected all configured emoji reactions; disabling reactions for this chat.`,
            );
          }
          support.disabled = true;
        }
        return false;
      }
      logger.warn?.(
        `[REACTION_FAIL] Could not set reaction ${emoji}: ${String(error?.message || error)}`,
      );
      return false;
    }
  }

  /**
   * @param {unknown} ctx
   * @param {string|number} chatId
   * @param {number} inboundMessageId
   */
  async function clearReaction(ctx, chatId, inboundMessageId) {
    const reactionKey = createReactionKey(chatId, inboundMessageId);
    const support = getChatReactionSupport(chatId);
    if (support.disabled) {
      reactionStateMap.delete(reactionKey);
      const timer = reactionClearTimers.get(reactionKey);
      if (timer) {
        cancelTimeout(timer);
        reactionClearTimers.delete(reactionKey);
      }
      return;
    }
    const nowMs = now();
    const lastClearMs = reactionClearRateLimit.get(reactionKey) || 0;
    if (nowMs - lastClearMs < clearRateLimitMs) {
      return;
    }
    reactionClearRateLimit.set(reactionKey, nowMs);
    try {
      await ctx.telegram.setMessageReaction(chatId, inboundMessageId, []);
      support.hasAnySuccess = true;
    } catch (error) {
      const errorMessage = String(error?.message || "");
      if (errorMessage.includes("REACTION_INVALID")) {
        if (!support.hasAnySuccess) {
          support.disabled = true;
        }
        return;
      }
    } finally {
      reactionStateMap.delete(reactionKey);
      const timer = reactionClearTimers.get(reactionKey);
      if (timer) {
        cancelTimeout(timer);
        reactionClearTimers.delete(reactionKey);
      }
    }
  }

  /**
   * @param {unknown} ctx
   * @param {string|number} chatId
   * @param {number} inboundMessageId
   * @param {"received"|"thinking"|"waiting_user"|"done"|"error"} state
   */
  async function setReactionState(ctx, chatId, inboundMessageId, state) {
    const support = getChatReactionSupport(chatId);
    if (support.disabled) {
      return;
    }
    const candidates = REACTION_CANDIDATE_EMOJIS_BY_STATE[state];
    if (!candidates || candidates.length === 0) {
      return;
    }
    const reactionKey = createReactionKey(chatId, inboundMessageId);
    const existing = reactionStateMap.get(reactionKey);
    if (existing?.state === state) {
      return;
    }
    let applied = false;
    for (const emoji of candidates) {
      // Try supported fallbacks before giving up to avoid disabling all reactions on a single bad emoji.
      applied = await safeReact(ctx, emoji, inboundMessageId, chatId);
      if (applied) {
        break;
      }
    }
    if (!applied) {
      return;
    }
    reactionStateMap.set(reactionKey, {
      state,
      lastSetAtMs: now(),
    });
    const timer = reactionClearTimers.get(reactionKey);
    if (timer) {
      cancelTimeout(timer);
      reactionClearTimers.delete(reactionKey);
    }
    if (state === "done") {
      const clearAtMs = now() + doneClearMs;
      reactionStateMap.set(reactionKey, {
        state,
        lastSetAtMs: now(),
        clearAtMs,
      });
      const clearTimer = scheduleTimeout(() => {
        clearReaction(ctx, chatId, inboundMessageId).catch(() => undefined);
      }, doneClearMs);
      if (
        clearTimer &&
        typeof clearTimer === "object" &&
        typeof clearTimer.unref === "function"
      ) {
        clearTimer.unref();
      }
      reactionClearTimers.set(reactionKey, clearTimer);
    }
  }

  /**
   * @param {unknown} ctx
   * @param {string} callbackData
   * @param {(ctx: unknown) => { chat?: { id?: number|string } } | undefined} resolveMessageContext
   */
  async function transitionWaitingReactionToDone(
    ctx,
    callbackData,
    resolveMessageContext,
  ) {
    const messageContext = resolveMessageContext(ctx);
    const chatId = messageContext?.chat?.id ?? ctx?.chat?.id;
    const originMessageId = parseCallbackOriginMessageId(callbackData);
    if (chatId === undefined || originMessageId === null) {
      return;
    }
    await setReactionState(ctx, chatId, originMessageId, "done");
  }

  return Object.freeze({
    setReactionState,
    clearReaction,
    transitionWaitingReactionToDone,
    parseCallbackOriginMessageId,
  });
}
