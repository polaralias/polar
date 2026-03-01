import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import { createPolarPlatform } from '@polar/platform';
import path from 'path';
import { createRequire } from 'module';
import { createTelegramCommandRouter } from './commands.mjs';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

dotenv.config();

// Redundant workflow state removed - now handled by Orchestrator

// 1. Initialize Bot
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error("FATAL: TELEGRAM_BOT_TOKEN is missing in environment variables.");
    process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

// 2. Initialize Polar Framework (Headless Orchestrator)
const platform = createPolarPlatform({
    dbPath: path.resolve(process.cwd(), '../../polar-system.db')
});
const controlPlane = platform.controlPlane;

function automationProposalTaskId(proposalId) {
    return `automation:proposal:${proposalId}`;
}

async function recordAutomationProposalEvent({ proposalId, sessionId, userId, metadata, status = "todo" }) {
    try {
        await controlPlane.upsertTask({
            executionType: "automation",
            taskId: automationProposalTaskId(proposalId),
            title: `Automation proposal ${proposalId}`,
            assigneeType: "user",
            assigneeId: userId,
            sessionId,
            status,
            metadata
        });
    } catch (error) {
        console.warn(`[AUTOMATION_AUDIT] failed to upsert proposal task ${proposalId}: ${error.message}`);
    }
}

async function recordAutomationProposalDecision({ proposalId, toStatus, sessionId, userId, reason, metadata }) {
    try {
        await controlPlane.transitionTask({
            executionType: "automation",
            taskId: automationProposalTaskId(proposalId),
            toStatus,
            assigneeType: "user",
            assigneeId: userId,
            sessionId,
            actorId: userId,
            reason,
            metadata
        });
    } catch (error) {
        console.warn(`[AUTOMATION_AUDIT] failed to transition proposal task ${proposalId}: ${error.message}`);
    }
}

const REACTION_EMOJI_BY_STATE = Object.freeze({
    received: '👀',
    thinking: '✍️',
    waiting_user: '⏳',
    done: '✅',
    error: '❌',
});
const REACTION_DONE_CLEAR_MS = 45_000;
const REACTION_CLEAR_RATE_LIMIT_MS = 250;
const reactionStateMap = new Map(); // reactionKey -> { state, lastSetAtMs, clearAtMs? }
const reactionClearTimers = new Map(); // reactionKey -> Timeout
const reactionClearRateLimit = new Map(); // reactionKey -> lastClearMs

function createReactionKey(chatId, messageId) {
    return `${chatId}:${messageId}`;
}

function parseFinitePositiveInteger(value) {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function deriveThreadKey(messageContext) {
    const chatId = messageContext?.chat?.id;
    if (chatId === undefined || chatId === null) {
        return "root:unknown";
    }
    if (messageContext?.message_thread_id !== undefined) {
        return `topic:${chatId}:${messageContext.message_thread_id}`;
    }
    if (messageContext?.reply_to_message?.message_id !== undefined) {
        return `reply:${chatId}:${messageContext.reply_to_message.message_id}`;
    }
    return `root:${chatId}`;
}

async function safeReact(ctx, emoji, messageId, chatIdOverride) {
    try {
        await ctx.telegram.setMessageReaction(
            chatIdOverride ?? ctx.chat?.id ?? ctx.message?.chat?.id,
            messageId || ctx.message?.message_id,
            [{ type: 'emoji', emoji }]
        );
    } catch (err) {
        console.warn(`[REACTION_FAIL] Could not set reaction ${emoji}: ${err.message}`);
    }
}

async function clearReaction(ctx, chatId, inboundMessageId) {
    const reactionKey = createReactionKey(chatId, inboundMessageId);
    const nowMs = Date.now();
    const lastClearMs = reactionClearRateLimit.get(reactionKey) || 0;
    if (nowMs - lastClearMs < REACTION_CLEAR_RATE_LIMIT_MS) {
        return;
    }
    reactionClearRateLimit.set(reactionKey, nowMs);
    try {
        await ctx.telegram.setMessageReaction(chatId, inboundMessageId, []);
    } catch (err) {
        // no-op: message can be stale/deleted or the reaction may already be cleared
    } finally {
        reactionStateMap.delete(reactionKey);
        const timer = reactionClearTimers.get(reactionKey);
        if (timer) {
            clearTimeout(timer);
            reactionClearTimers.delete(reactionKey);
        }
    }
}

async function setReactionState(ctx, chatId, inboundMessageId, state) {
    const emoji = REACTION_EMOJI_BY_STATE[state];
    if (!emoji) {
        return;
    }
    const reactionKey = createReactionKey(chatId, inboundMessageId);
    const existing = reactionStateMap.get(reactionKey);
    if (existing?.state === state) {
        return;
    }
    await safeReact(ctx, emoji, inboundMessageId, chatId);
    reactionStateMap.set(reactionKey, {
        state,
        lastSetAtMs: Date.now(),
    });

    const existingTimer = reactionClearTimers.get(reactionKey);
    if (existingTimer) {
        clearTimeout(existingTimer);
        reactionClearTimers.delete(reactionKey);
    }

    if (state === 'done') {
        const clearAtMs = Date.now() + REACTION_DONE_CLEAR_MS;
        reactionStateMap.set(reactionKey, {
            state,
            lastSetAtMs: Date.now(),
            clearAtMs,
        });
        const timer = setTimeout(() => {
            clearReaction(ctx, chatId, inboundMessageId).catch(() => undefined);
        }, REACTION_DONE_CLEAR_MS);
        if (typeof timer.unref === "function") {
            timer.unref();
        }
        reactionClearTimers.set(reactionKey, timer);
    }
}

function parseCallbackOriginMessageId(callbackData) {
    const parts = callbackData.split(':');
    const maybeId = parts[parts.length - 1];
    const parsed = parseFinitePositiveInteger(maybeId);
    return parsed;
}

async function transitionWaitingReactionToDone(ctx, callbackData) {
    const messageContext = resolveTelegramMessageContext(ctx);
    const chatId = messageContext?.chat?.id ?? ctx.chat?.id;
    const originMessageId = parseCallbackOriginMessageId(callbackData);
    if (chatId === undefined || originMessageId === null) {
        return;
    }
    await setReactionState(ctx, chatId, originMessageId, 'done');
}

async function resolveAnchorChannelMessageId(sessionId, anchorId) {
    if (anchorId === undefined || anchorId === null) {
        return null;
    }
    const numericAnchor = parseFinitePositiveInteger(anchorId);
    if (numericAnchor !== null) {
        return numericAnchor;
    }
    if (typeof anchorId !== "string" || anchorId.length === 0) {
        return null;
    }

    const history = await controlPlane.getSessionHistory({ sessionId, limit: 500 });
    const items = Array.isArray(history.items) ? history.items : [];
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        const itemMetadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
        if (item.messageId === anchorId) {
            const directChannelId = parseFinitePositiveInteger(
                itemMetadata.channelMessageId ?? itemMetadata.telegram?.message_id
            );
            if (directChannelId !== null) {
                return directChannelId;
            }
        }
        if (
            itemMetadata.bindingType === "channel_message_id" &&
            itemMetadata.internalMessageId === anchorId
        ) {
            const mapped = parseFinitePositiveInteger(itemMetadata.channelMessageId);
            if (mapped !== null) {
                return mapped;
            }
        }
    }
    return null;
}

function buildTopicReplyOptions(inboundMessage) {
    if (!inboundMessage || inboundMessage.message_thread_id === undefined) {
        return {};
    }
    return { message_thread_id: inboundMessage.message_thread_id };
}

/**
 * Resolve message-bearing context from either a direct message event
 * or a callback query event.
 * @param {import("telegraf").Context} ctx
 * @returns {import("telegraf/typings/core/types/typegram").Message.CommonMessage | undefined}
 */
function resolveTelegramMessageContext(ctx) {
    const directMessage = ctx.message;
    if (directMessage && typeof directMessage === "object") {
        return directMessage;
    }
    const callbackMessage = ctx.callbackQuery?.message;
    if (callbackMessage && typeof callbackMessage === "object" && "message_id" in callbackMessage) {
        return callbackMessage;
    }
    return undefined;
}

/**
 * Resolve normalized Telegram chat context from control-plane ingress contracts.
 * Session identity is always chat-scoped (`telegram:chat:<chatId>`); thread context
 * is returned separately for routing metadata only.
 * @param {import("telegraf").Context} ctx
 */
async function resolvePolarSessionContext(ctx) {
    const messageContext = resolveTelegramMessageContext(ctx);
    const chatId = messageContext?.chat?.id ?? ctx.chat?.id;
    const fromId = messageContext?.from?.id ?? ctx.from?.id;
    const messageId = messageContext?.message_id;

    if (chatId === undefined) {
        return {
            sessionId: "telegram:chat:unknown",
            threadId: undefined,
            replyToMessageId: undefined
        };
    }

    try {
        const telegramPayload = {
            chatId,
            fromId: fromId ?? 0,
            text: "session-resolution",
            messageId: messageId ?? 0,
            timestampMs: Date.now()
        };

        if (messageContext?.message_thread_id) {
            telegramPayload.messageThreadId = messageContext.message_thread_id;
        }
        if (messageContext?.reply_to_message?.message_id) {
            telegramPayload.replyToMessageId = messageContext.reply_to_message.message_id;
        }

        const envelope = await controlPlane.normalizeIngress({
            adapter: "telegram",
            payload: telegramPayload
        });

        return {
            sessionId: envelope.sessionId,
            threadId: envelope.threadId,
            replyToMessageId: envelope.metadata?.replyToMessageId
        };
    } catch {
        return {
            sessionId: `telegram:chat:${chatId}`,
            threadId: undefined,
            replyToMessageId: undefined
        };
    }
}

function parseTelegramIdAllowlist(rawValue) {
    if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
        return new Set();
    }
    return new Set(
        rawValue
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
    );
}

const OPERATOR_TELEGRAM_IDS = parseTelegramIdAllowlist(process.env.POLAR_OPERATOR_TELEGRAM_IDS);
const ADMIN_TELEGRAM_IDS = parseTelegramIdAllowlist(process.env.POLAR_ADMIN_TELEGRAM_IDS);

const commandRouter = createTelegramCommandRouter({
    controlPlane,
    dbPath: platform.dbPath,
    fallbackOperatorUserIds: [...OPERATOR_TELEGRAM_IDS],
    fallbackAdminUserIds: [...ADMIN_TELEGRAM_IDS],
    resolveSessionContext: resolvePolarSessionContext,
    deriveThreadKey,
    setReactionState,
    async replyWithOptions(ctx, text) {
        await ctx.reply(text, buildTopicReplyOptions(ctx.message));
    },
});

// --- Bot Middleware for UX ---
bot.use(async (ctx, next) => {
    // Catch reaction updates (User Feedback -> SQLite feedback event flow)
    if (ctx.updateType === 'message_reaction') {
        return handleReactionUpdate(ctx);
    }
    return next();
});

// --- Debounce & Grouping Logic ---
const MESSAGE_BUFFER = new Map();
const DEBOUNCE_TIMEOUT_MS = 2500;

async function handleMessageDebounced(ctx) {
    let envelope;
    try {
        const telegramPayload = {
            chatId: ctx.chat.id,
            fromId: ctx.from.id,
            text: ctx.message.text || "",
            messageId: ctx.message.message_id,
            timestampMs: Date.now()
        };

        if (ctx.message.message_thread_id) {
            telegramPayload.messageThreadId = ctx.message.message_thread_id;
        }
        if (ctx.message.reply_to_message) {
            telegramPayload.replyToMessageId = ctx.message.reply_to_message.message_id;
        }

        envelope = await controlPlane.normalizeIngress({
            adapter: "telegram",
            payload: telegramPayload
        });
    } catch (err) {
        console.error("Failed to parse into canonical envelope", err);
        return;
    }

    const messageThreadKey = deriveThreadKey(ctx.message);
    const polarSessionId = envelope.sessionId;
    const bufferKey = `${polarSessionId}|${messageThreadKey}|${ctx.from.id.toString()}`;

    if (!MESSAGE_BUFFER.has(bufferKey)) {
        MESSAGE_BUFFER.set(bufferKey, { contexts: [], timer: null });
    }
    const buffer = MESSAGE_BUFFER.get(bufferKey);
    buffer.contexts.push({ ctx, envelope });

    if (buffer.timer) clearTimeout(buffer.timer);

    buffer.timer = setTimeout(() => {
        MESSAGE_BUFFER.delete(bufferKey);
        processGroupedMessages(polarSessionId, buffer.contexts).catch(err => {
            console.error("Error processing grouped text:", err);
            setReactionState(ctx, ctx.chat.id, ctx.message.message_id, 'error').catch(() => undefined);
        });
    }, DEBOUNCE_TIMEOUT_MS);
}

// --- Handlers ---
bot.on(message('text'), async (ctx) => {
    try {
        const result = await commandRouter.handle(ctx);
        if (result.handled) {
            return;
        }
    } catch (error) {
        console.error('[COMMAND_ROUTER_ERROR]', error);
        await ctx.reply(`❌ Command failed: ${error.message}`, buildTopicReplyOptions(ctx.message));
        return;
    }
    await handleMessageDebounced(ctx);
});

async function processGroupedMessages(polarSessionId, items) {
    if (items.length === 0) return;
    const lastItem = items[items.length - 1];
    const { ctx, envelope } = lastItem;
    const telegramMessageId = ctx.message.message_id;
    const threadKey = deriveThreadKey(ctx.message);
    const topicReplyOptions = buildTopicReplyOptions(ctx.message);

    try {
        await setReactionState(ctx, ctx.chat.id, telegramMessageId, 'received');

        let userText = "";
        for (const { ctx: c } of items) {
            let chunkText = c.message.text || "";
            if (c.message.reply_to_message) {
                const r = c.message.reply_to_message;
                let snippet = r.text || r.caption || "a message";
                if (snippet.length > 80) snippet = snippet.substring(0, 80) + "...";
                const author = r.from?.first_name || (r.from?.is_bot ? "Bot/Sub-Agent" : "Someone");
                chunkText = `[In reply to ${author}: "${snippet}"]\n${chunkText}`;
            }
            if (userText) userText += "\n\n";
            userText += chunkText;
        }

        await setReactionState(ctx, ctx.chat.id, telegramMessageId, 'thinking');

        const result = await controlPlane.orchestrate({
            sessionId: polarSessionId,
            userId: ctx.from.id.toString(),
            text: userText,
            messageId: `msg_u_${telegramMessageId}`,
            metadata: {
                threadId: envelope.threadId,
                threadKey,
                replyToMessageId: ctx.message.reply_to_message?.message_id,
                ...(ctx.message.message_thread_id !== undefined
                    ? { messageThreadId: ctx.message.message_thread_id }
                    : {}),
            }
        });

        const useInlineReply = result.useInlineReply === true;
        const anchorId = result.anchorMessageId;
        const numericAnchor = useInlineReply
            ? await resolveAnchorChannelMessageId(polarSessionId, anchorId)
            : null;
        let replyOptions = { ...topicReplyOptions };
        if (useInlineReply && numericAnchor !== null) {
            replyOptions = {
                ...replyOptions,
                reply_parameters: {
                    message_id: numericAnchor,
                    allow_sending_without_reply: true,
                },
            };
        }

        if (result.status === 'workflow_proposed') {
            let primaryReplyMessage;
            if (result.text) {
                primaryReplyMessage = await ctx.reply(result.text, replyOptions);
            }
            if (result.assistantMessageId && primaryReplyMessage?.message_id) {
                await controlPlane.updateMessageChannelId(polarSessionId, result.assistantMessageId, primaryReplyMessage.message_id);
            }

            let formattedSteps = "✨ *Proposed Workflow:*\n\n";
            result.steps.forEach((step, idx) => {
                formattedSteps += `*Step ${idx + 1}:* \`${step.capabilityId}\`\n`;
                formattedSteps += `  Ext: \`${step.extensionId}\`\n`;
            });

            // Send Workflow block with Approve/Reject buttons
            const stepsMsg = await ctx.reply(formattedSteps, {
                parse_mode: 'Markdown',
                ...replyOptions,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ Approve", callback_data: `wf_app:${result.workflowId}:${telegramMessageId}` },
                            { text: "❌ Reject", callback_data: `wf_rej:${result.workflowId}:${telegramMessageId}` }
                        ]
                    ]
                }
            });
            if (result.assistantMessageId && !primaryReplyMessage?.message_id) {
                await controlPlane.updateMessageChannelId(polarSessionId, result.assistantMessageId, stepsMsg.message_id);
            }
        } else if (result.status === 'automation_proposed') {
            let primaryReplyMessage;
            if (result.text) {
                primaryReplyMessage = await ctx.reply(result.text, replyOptions);
            }
            if (result.assistantMessageId && primaryReplyMessage?.message_id) {
                await controlPlane.updateMessageChannelId(polarSessionId, result.assistantMessageId, primaryReplyMessage.message_id);
            }

            const proposal = result.proposal || {};
            const proposalMsg = await ctx.reply(
                `🗓️ *Automation Proposal*\n` +
                `Schedule: \`${proposal.schedule || 'unknown'}\`\n` +
                `Prompt: \`${proposal.promptTemplate || 'unknown'}\`\n` +
                `Limits: \`${JSON.stringify(proposal.limits || {})}\`\n` +
                `Quiet hours: \`${JSON.stringify(proposal.quietHours || {})}\`\n` +
                `Template: \`${proposal.templateType || 'generic'}\``,
                {
                    parse_mode: 'Markdown',
                    ...replyOptions,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "✅ Approve", callback_data: `auto_app:${result.proposalId}:${telegramMessageId}` },
                                { text: "❌ Reject", callback_data: `auto_rej:${result.proposalId}:${telegramMessageId}` }
                            ]
                        ]
                    }
                }
            );
            if (result.assistantMessageId && !primaryReplyMessage?.message_id) {
                await controlPlane.updateMessageChannelId(polarSessionId, result.assistantMessageId, proposalMsg.message_id);
            }
            if (result.proposalId) {
                await recordAutomationProposalEvent({
                    proposalId: result.proposalId,
                    sessionId: polarSessionId,
                    userId: ctx.from.id.toString(),
                    metadata: {
                        source: "telegram",
                        decision: "proposed",
                        proposal: result.proposal || {}
                    }
                });
            }
        } else if (result.status === 'repair_question') {
            const optA = result.options.find(o => o.id === 'A');
            const optB = result.options.find(o => o.id === 'B');
            const repairMsg = await ctx.reply(result.question, {
                ...replyOptions,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: `🅰️ ${optA?.label || 'Option A'}`, callback_data: `repair_sel:A:${result.correlationId}:${telegramMessageId}` },
                            { text: `🅱️ ${optB?.label || 'Option B'}`, callback_data: `repair_sel:B:${result.correlationId}:${telegramMessageId}` }
                        ]
                    ]
                }
            });
            if (result.assistantMessageId) {
                await controlPlane.updateMessageChannelId(polarSessionId, result.assistantMessageId, repairMsg.message_id);
            }
        } else if (result.status === 'completed') {
            const msg = await ctx.reply(result.text, replyOptions);
            if (result.assistantMessageId) {
                await controlPlane.updateMessageChannelId(polarSessionId, result.assistantMessageId, msg.message_id);
            }
        } else if (result.status === 'error') {
            await ctx.reply(result.text || "Wait, I didn't generate any text.", replyOptions);
        }

        if (result.status === 'completed') {
            await setReactionState(ctx, ctx.chat.id, telegramMessageId, 'done');
        } else if (result.status === 'workflow_proposed' || result.status === 'repair_question' || result.status === 'automation_proposed') {
            await setReactionState(ctx, ctx.chat.id, telegramMessageId, 'waiting_user');
        } else if (result.status === 'error') {
            await setReactionState(ctx, ctx.chat.id, telegramMessageId, 'error');
        } else {
            await setReactionState(ctx, ctx.chat.id, telegramMessageId, 'done');
        }

    } catch (err) {
        console.error("Error processing text:", err);
        await setReactionState(ctx, ctx.chat.id, telegramMessageId, 'error');
    }
}


bot.on(message('document'), async (ctx) => {
    try {
        const doc = ctx.message.document;
        if (doc.mime_type === 'application/pdf') {
            await setReactionState(ctx, ctx.chat.id, ctx.message.message_id, 'received');
            await setReactionState(ctx, ctx.chat.id, ctx.message.message_id, 'thinking');

            const fileUrl = await ctx.telegram.getFileLink(doc.file_id);
            const response = await fetch(fileUrl);
            const buffer = await response.arrayBuffer();

            const pdfData = await pdfParse(Buffer.from(buffer));

            const { sessionId: polarSessionId } = await resolvePolarSessionContext(ctx);
            const threadKey = deriveThreadKey(ctx.message);
            const topicReplyOptions = buildTopicReplyOptions(ctx.message);

            await controlPlane.appendMessage({
                sessionId: polarSessionId,
                userId: ctx.from.id.toString(),
                messageId: `msg_u_${ctx.message.message_id}`,
                role: "user",
                text: `[User uploaded PDF Document: ${doc.file_name}]\n\n${pdfData.text}`,
                timestampMs: Date.now(),
                metadata: {
                    threadKey,
                    ...(ctx.message.message_thread_id !== undefined
                        ? { messageThreadId: ctx.message.message_thread_id }
                        : {}),
                },
            });

            await setReactionState(ctx, ctx.chat.id, ctx.message.message_id, 'done');
            await ctx.reply(`✅ Parsed PDF: ${doc.file_name} (${pdfData.text.length} characters)`, topicReplyOptions);
        } else {
            await setReactionState(ctx, ctx.chat.id, ctx.message.message_id, 'error');
            await ctx.reply("❌ Only PDF documents are supported locally right now.", buildTopicReplyOptions(ctx.message));
        }
    } catch (err) {
        console.error("Error parsing document:", err);
        await setReactionState(ctx, ctx.chat.id, ctx.message.message_id, 'error');
        await ctx.reply("❌ Failed to parse document.", buildTopicReplyOptions(ctx.message));
    }
});

bot.on(message('photo'), async (ctx) => {
    try {
        await setReactionState(ctx, ctx.chat.id, ctx.message.message_id, 'received');
        await setReactionState(ctx, ctx.chat.id, ctx.message.message_id, 'thinking');

        // BUG-034 fix: Defensive check for empty photo array
        const photos = ctx.message.photo;
        if (!photos || photos.length === 0) {
            await ctx.reply("❌ No photo data received.");
            return;
        }
        const photo = photos[photos.length - 1]; // Use last element without mutating the array

        const fileUrl = await ctx.telegram.getFileLink(photo.file_id);
        const response = await fetch(fileUrl);
        const buffer = await response.arrayBuffer();

        // BUG-027 fix: Store a reference/summary instead of the full base64 image
        // to prevent context window pollution and SQLite bloat
        const imageSizeKb = Math.round(buffer.byteLength / 1024);
        const caption = ctx.message.caption || "";

        const { sessionId: polarSessionId } = await resolvePolarSessionContext(ctx);
        const threadKey = deriveThreadKey(ctx.message);
        const topicReplyOptions = buildTopicReplyOptions(ctx.message);

        await controlPlane.appendMessage({
            sessionId: polarSessionId,
            userId: ctx.from.id.toString(),
            messageId: `msg_u_${ctx.message.message_id}`,
            role: "user",
            text: `[User uploaded Photo: ${imageSizeKb}KB image${caption ? `, caption: "${caption}"` : ""}. Photo stored as file reference, not embedded in context.]`,
            timestampMs: Date.now(),
            metadata: {
                threadKey,
                ...(ctx.message.message_thread_id !== undefined
                    ? { messageThreadId: ctx.message.message_thread_id }
                    : {}),
            },
        });

        await setReactionState(ctx, ctx.chat.id, ctx.message.message_id, 'done');
        await ctx.reply(`✅ Photo received (${imageSizeKb}KB). Stored in context as reference.`, topicReplyOptions);
    } catch (err) {
        console.error("Error parsing photo:", err);
        await setReactionState(ctx, ctx.chat.id, ctx.message.message_id, 'error');
        await ctx.reply("❌ Failed to parse photo.", buildTopicReplyOptions(ctx.message));
    }
});

// User reacted to a message!
async function handleReactionUpdate(ctx) {
    const reaction = ctx.update.message_reaction;
    // BUG-033 fix: Validate reaction structure before accessing properties
    if (!reaction || !reaction.chat || !reaction.new_reaction || reaction.new_reaction.length === 0) return;
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

// --- Callback Query Handlers (Buttons) ---
bot.on('callback_query', async (ctx) => {
    const callbackData = ctx.callbackQuery.data;
    const callbackReplyOptions = buildTopicReplyOptions(ctx.callbackQuery?.message);

    // We stored the JSON in an in-memory Map, mapping an ID from callback_data

    if (callbackData.startsWith('wf_app:')) {
        const parts = callbackData.split(':');
        const workflowId = parts[1];

        await ctx.answerCbQuery("Workflow Approved! Executing...");
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        await ctx.reply("🚀 Executing workflow... ", callbackReplyOptions);

        try {
            const result = await controlPlane.executeWorkflow(workflowId);
            const sessionId = (await resolvePolarSessionContext(ctx).catch(() => ({
                sessionId: `telegram:chat:${ctx.callbackQuery?.message?.chat?.id ?? ctx.message?.chat?.id ?? "unknown"}`,
                threadId: undefined,
                replyToMessageId: undefined
            }))).sessionId;

            if (result.status === 'completed') {
                if (result.text) {
                    const msg = await ctx.reply(result.text, callbackReplyOptions);
                    if (result.assistantMessageId) {
                        await controlPlane.updateMessageChannelId(sessionId, result.assistantMessageId, msg.message_id);
                    }
                }
            } else if (result.status === 'error') {
                const errMsg = await ctx.reply("❌ " + (result.text || "Workflow execution failed."), callbackReplyOptions);
                if (result.internalMessageId) {
                    await controlPlane.updateMessageChannelId(sessionId, result.internalMessageId, errMsg.message_id);
                }
            }
            await transitionWaitingReactionToDone(ctx, callbackData);
        } catch (execErr) {
            console.error(execErr);
            await ctx.reply("❌ Workflow execution crashed: " + execErr.message, callbackReplyOptions);
            await transitionWaitingReactionToDone(ctx, callbackData);
        }

    } else if (callbackData.startsWith('wf_rej:')) {
        const parts = callbackData.split(':');
        const workflowId = parts[1];
        await controlPlane.rejectWorkflow(workflowId);

        await ctx.answerCbQuery("Workflow Rejected.");
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        await ctx.reply("❌ The workflow was abandoned.", callbackReplyOptions);
        await transitionWaitingReactionToDone(ctx, callbackData);

    } else if (callbackData.startsWith('auto_app:')) {
        const parts = callbackData.split(':');
        const proposalId = parts[1];
        await ctx.answerCbQuery("Automation approved. Creating job...");
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

        const sessionContext = await resolvePolarSessionContext(ctx).catch(() => ({
            sessionId: `telegram:chat:${ctx.callbackQuery?.message?.chat?.id ?? "unknown"}`,
            threadId: undefined,
            replyToMessageId: undefined
        }));

        try {
            const proposalResult = await controlPlane.consumeAutomationProposal(proposalId);
            if (proposalResult.status !== "found") {
                await ctx.reply("⚠️ This automation proposal expired or was already handled.", callbackReplyOptions);
                await transitionWaitingReactionToDone(ctx, callbackData);
                return;
            }
            const proposal = proposalResult.proposal;
            const created = await controlPlane.createAutomationJob({
                ownerUserId: proposal.userId,
                sessionId: proposal.sessionId,
                schedule: proposal.schedule,
                promptTemplate: proposal.promptTemplate,
                limits: proposal.limits,
                quietHours: proposal.quietHours,
                enabled: true
            });

            if (created.status === "created") {
                let dryRunSummary = "";
                if (proposal.templateType === "inbox_check") {
                    const inboxLimits = proposal.limits?.inbox && typeof proposal.limits.inbox === "object"
                        ? proposal.limits.inbox
                        : {};
                    const dryRun = await controlPlane.proactiveInboxDryRun({
                        sessionId: proposal.sessionId,
                        userId: proposal.userId,
                        ...(typeof inboxLimits.connectorId === "string" ? { connectorId: inboxLimits.connectorId } : {}),
                        ...(typeof inboxLimits.lookbackHours === "number" ? { lookbackHours: inboxLimits.lookbackHours } : {}),
                        maxNotificationsPerDay:
                            typeof proposal.limits?.maxNotificationsPerDay === "number"
                                ? proposal.limits.maxNotificationsPerDay
                                : 3,
                        capabilities: Array.isArray(inboxLimits.capabilities)
                            ? inboxLimits.capabilities
                            : ["mail.search_headers"]
                    });
                    const wouldTrigger = Array.isArray(dryRun.wouldTrigger) ? dryRun.wouldTrigger : [];
                    if (dryRun.status === "completed") {
                        dryRunSummary =
                            `\n\nDry run (headers-only, UTC quiet hours): scanned ${dryRun.scannedHeaderCount} headers, ` +
                            `would trigger ${dryRun.wouldTriggerCount} notifications.` +
                            (wouldTrigger.length > 0
                                ? `\nTop candidates:\n${wouldTrigger
                                    .map((item) => `- ${item.subject} (${item.senderDomain || "unknown"})`)
                                    .join("\n")}`
                                : "");
                    } else {
                        dryRunSummary =
                            `\n\nDry run (headers-only) did not complete: ` +
                            `${dryRun.blockedReason || dryRun.degradedReason || "unknown_reason"}`;
                    }
                }
                await recordAutomationProposalDecision({
                    proposalId,
                    toStatus: "done",
                    sessionId: sessionContext.sessionId,
                    userId: ctx.from.id.toString(),
                    reason: "Automation proposal approved and created",
                    metadata: {
                        source: "telegram",
                        decision: "approved",
                        jobId: created.job?.id,
                        schedule: created.job?.schedule,
                        promptTemplate: created.job?.promptTemplate
                    }
                });
                await ctx.reply(
                    `✅ Automation created.\nJob ID: ${created.job.id}\nSchedule: ${created.job.schedule}${dryRunSummary}`,
                    callbackReplyOptions
                );
                await transitionWaitingReactionToDone(ctx, callbackData);
            } else {
                await recordAutomationProposalDecision({
                    proposalId,
                    toStatus: "blocked",
                    sessionId: sessionContext.sessionId,
                    userId: ctx.from.id.toString(),
                    reason: "Automation proposal approval failed",
                    metadata: {
                        source: "telegram",
                        decision: "approved_create_failed",
                        createStatus: created.status
                    }
                });
                await ctx.reply("⚠️ Automation approval received, but job creation did not complete.", callbackReplyOptions);
                await transitionWaitingReactionToDone(ctx, callbackData);
            }
        } catch (error) {
            await recordAutomationProposalDecision({
                proposalId,
                toStatus: "blocked",
                sessionId: sessionContext.sessionId,
                userId: ctx.from.id.toString(),
                reason: "Automation proposal approval crashed",
                metadata: {
                    source: "telegram",
                    decision: "approved_error",
                    error: error instanceof Error ? error.message : String(error)
                }
            });
            await ctx.reply(`❌ Failed to create automation: ${error.message}`, callbackReplyOptions);
            await transitionWaitingReactionToDone(ctx, callbackData);
        }
    } else if (callbackData.startsWith('auto_rej:')) {
        const parts = callbackData.split(':');
        const proposalId = parts[1];
        await controlPlane.rejectAutomationProposal(proposalId);
        const sessionContext = await resolvePolarSessionContext(ctx).catch(() => ({
            sessionId: `telegram:chat:${ctx.callbackQuery?.message?.chat?.id ?? "unknown"}`,
            threadId: undefined,
            replyToMessageId: undefined
        }));
        await recordAutomationProposalDecision({
            proposalId,
            toStatus: "done",
            sessionId: sessionContext.sessionId,
            userId: ctx.from.id.toString(),
            reason: "Automation proposal rejected",
            metadata: {
                source: "telegram",
                decision: "rejected"
            }
        });
        await ctx.answerCbQuery("Automation proposal rejected.");
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        await ctx.reply("❌ Automation proposal rejected.", callbackReplyOptions);
        await transitionWaitingReactionToDone(ctx, callbackData);

    } else if (callbackData.startsWith('repair_sel:')) {
        const parts = callbackData.split(':');
        const selection = parts[1];
        const originMessageId = parseFinitePositiveInteger(parts[parts.length - 1]);
        const correlationId = originMessageId !== null
            ? parts.slice(2, parts.length - 1).join(':')
            : parts.slice(2).join(':');

        // Resolve session ID from the chat
        let sessionId;
        try {
            sessionId = (await resolvePolarSessionContext(ctx)).sessionId;
        } catch {
            sessionId = `telegram:chat:${ctx.callbackQuery.message?.chat?.id}`;
        }

        await ctx.answerCbQuery(`Selected option ${selection}...`);
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

        try {
            const result = await controlPlane.handleRepairSelection({
                sessionId,
                selection,
                correlationId
            });

            if (result.status === 'completed') {
                await ctx.reply(`✅ ${result.text}`, callbackReplyOptions);
                if (originMessageId !== null && ctx.callbackQuery?.message?.chat?.id !== undefined) {
                    await setReactionState(ctx, ctx.callbackQuery.message.chat.id, originMessageId, 'done');
                } else {
                    await transitionWaitingReactionToDone(ctx, callbackData);
                }
            } else {
                await ctx.reply(`⚠️ ${result.text || 'Could not process selection.'}`, callbackReplyOptions);
                await transitionWaitingReactionToDone(ctx, callbackData);
            }
        } catch (repairErr) {
            console.error('[REPAIR_SELECTION_ERROR]', repairErr);
            await ctx.reply('⚠️ Something went wrong processing your selection.', callbackReplyOptions);
            await transitionWaitingReactionToDone(ctx, callbackData);
        }
    }

});

// Graceful stops
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    platform.shutdown();
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    platform.shutdown();
});

// Start listening
bot.launch().then(() => {
    console.log("🚀 Polar Telegram Runner is online and listening...");
});
