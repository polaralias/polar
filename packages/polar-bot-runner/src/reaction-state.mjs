const REACTION_EMOJI_BY_STATE = Object.freeze({
  received: "👀",
  thinking: "✍️",
  waiting_user: "⏳",
  done: "✅",
  error: "❌",
});

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
   * @param {unknown} ctx
   * @param {string} emoji
   * @param {number} messageId
   * @param {string|number} chatId
   */
  async function safeReact(ctx, emoji, messageId, chatId) {
    if (reactionSupportByChat.get(chatId) === false) {
      return false;
    }
    try {
      await ctx.telegram.setMessageReaction(chatId, messageId, [
        { type: "emoji", emoji },
      ]);
      reactionSupportByChat.set(chatId, true);
      return true;
    } catch (error) {
      const errorMessage = String(error?.message || "");
      if (errorMessage.includes("REACTION_INVALID")) {
        if (reactionSupportByChat.get(chatId) !== false) {
          logger.warn?.(
            `[REACTION_DISABLED] Chat ${chatId} does not support configured emoji reactions; disabling reactions for this chat.`,
          );
        }
        reactionSupportByChat.set(chatId, false);
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
    if (reactionSupportByChat.get(chatId) === false) {
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
      reactionSupportByChat.set(chatId, true);
    } catch (error) {
      const errorMessage = String(error?.message || "");
      if (errorMessage.includes("REACTION_INVALID")) {
        reactionSupportByChat.set(chatId, false);
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
    if (reactionSupportByChat.get(chatId) === false) {
      return;
    }
    const emoji = REACTION_EMOJI_BY_STATE[state];
    if (!emoji) {
      return;
    }
    const reactionKey = createReactionKey(chatId, inboundMessageId);
    const existing = reactionStateMap.get(reactionKey);
    if (existing?.state === state) {
      return;
    }
    const applied = await safeReact(ctx, emoji, inboundMessageId, chatId);
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

