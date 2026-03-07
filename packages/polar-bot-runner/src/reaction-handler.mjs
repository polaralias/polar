import { parseFinitePositiveInteger } from './reaction-state.mjs';

/**
 * Handle message reaction updates from Telegram.
 * Validates the reaction structure and records a feedback event in the control plane.
 *
 * @param {object} ctx - The Telegraf context object.
 * @param {object} dependencies - Dependencies for the handler.
 * @param {object} dependencies.controlPlane - The Polar control plane instance.
 */
export async function handleReactionUpdate(ctx, { controlPlane }) {
    const reaction = ctx?.update?.message_reaction;

    // BUG-033 fix: Validate reaction structure before accessing properties
    if (
        !reaction ||
        !reaction.chat ||
        typeof reaction.chat.id === 'undefined' ||
        typeof reaction.message_id === 'undefined' ||
        !reaction.new_reaction ||
        reaction.new_reaction.length === 0
    ) {
        return;
    }

    if (!reaction.user && !reaction.actor_chat) return; // No user info available (channel posts, anonymous)

    const emoji = reaction.new_reaction[0].emoji;
    if (typeof emoji !== 'string' || emoji.length === 0) return;

    const sessionId = `telegram:chat:${reaction.chat.id}`;
    const polarity = (emoji === '👍' || emoji === '💯' || emoji === '🔥')
        ? 'positive'
        : (emoji === '👎' ? 'negative' : 'neutral');

    const sessionHistory = await controlPlane.getSessionHistory({ sessionId, limit: 500 });
    const items = Array.isArray(sessionHistory.items) ? sessionHistory.items : [];

    let resolvedInternalMessageId = null;
    let targetMsg = null;
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        const itemMetadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
        if (
            itemMetadata.bindingType === "channel_message_id" &&
            parseFinitePositiveInteger(itemMetadata.channelMessageId) === reaction.message_id &&
            typeof itemMetadata.internalMessageId === "string"
        ) {
            resolvedInternalMessageId = itemMetadata.internalMessageId;
            targetMsg = items.find((entry) => entry.messageId === resolvedInternalMessageId) || null;
            break;
        }
        if (
            item.role === "assistant" &&
            parseFinitePositiveInteger(itemMetadata.channelMessageId ?? itemMetadata.telegram?.message_id) === reaction.message_id
        ) {
            resolvedInternalMessageId = item.messageId;
            targetMsg = item;
            break;
        }
    }

    if (!resolvedInternalMessageId) {
        const legacy = items.find((entry) => entry.messageId === `msg_a_${reaction.message_id}`);
        if (legacy) {
            resolvedInternalMessageId = legacy.messageId;
            targetMsg = legacy;
        }
    }

    const feedbackMessageId = resolvedInternalMessageId || `telegram:${reaction.chat.id}:${reaction.message_id}`;

    await controlPlane.recordFeedbackEvent({
        type: 'reaction_added',
        sessionId,
        messageId: feedbackMessageId,
        emoji,
        polarity,
        payload: {
            telegramMessageId: reaction.message_id,
            targetMessageText: targetMsg?.text,
            timestampMs: Date.now(),
            ...(resolvedInternalMessageId ? {} : { unresolved: true }),
        }
    });
}
