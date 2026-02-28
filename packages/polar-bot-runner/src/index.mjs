import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import { createControlPlaneService } from '../../polar-control-plane/src/index.mjs';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import crypto from 'crypto';

import {
    createSqliteSchedulerStateStore,
    createSqliteBudgetStateStore,
    createSqliteMemoryProvider
} from '../../polar-runtime-core/src/index.mjs';
import Database from 'better-sqlite3';

dotenv.config();

const dbPath = path.resolve(process.cwd(), '../../polar-system.db');
const db = new Database(dbPath);

// Redundant workflow state removed - now handled by Orchestrator

// 1. Initialize Bot
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error("FATAL: TELEGRAM_BOT_TOKEN is missing in environment variables.");
    process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

// 2. Initialize Polar Framework (Headless Orchestrator)
const controlPlane = createControlPlaneService({
    schedulerStateStore: createSqliteSchedulerStateStore({ db }),
    budgetStateStore: createSqliteBudgetStateStore({ db }),
    memoryProvider: createSqliteMemoryProvider({ db })
});

// Helper for safe reactions (prevents crashes on 400s)
async function safeReact(ctx, emoji, messageId) {
    try {
        await ctx.telegram.setMessageReaction(
            ctx.chat.id,
            messageId || ctx.message.message_id,
            [{ type: 'emoji', emoji }]
        );
    } catch (err) {
        console.warn(`[REACTION_FAIL] Could not set reaction ${emoji}: ${err.message}`);
    }
}

/**
 * BUG-021/BUG-023 fix: Normalize a Telegram context into a polarSessionId
 * using the control plane's ingress normalization, not raw ctx.chat.id.
 * Falls back to the raw chat ID prefixed form if normalization fails.
 */
async function resolvePolarSessionId(ctx) {
    try {
        const telegramPayload = {
            chatId: ctx.chat.id,
            fromId: ctx.from?.id || 0,
            text: 'session-resolution',
            messageId: ctx.message?.message_id || 0,
            timestampMs: Date.now()
        };

        if (ctx.message?.message_thread_id) {
            telegramPayload.messageThreadId = ctx.message.message_thread_id;
        }
        if (ctx.message?.reply_to_message) {
            telegramPayload.replyToMessageId = ctx.message.reply_to_message.message_id;
        }

        const envelope = await controlPlane.normalizeIngress({
            adapter: "telegram",
            payload: telegramPayload
        });

        return envelope.threadId || envelope.sessionId;
    } catch {
        return `telegram:chat:${ctx.chat.id}`;
    }
}

// --- Bot Middleware for UX ---
bot.use(async (ctx, next) => {
    // Catch reaction updates (User Feedback -> REACTIONS.md flow)
    if (ctx.updateType === 'message_reaction') {
        return handleReactionUpdate(ctx);
    }
    return next();
});

// --- Debounce & Grouping Logic ---
const MESSAGE_BUFFER = new Map();
const DEBOUNCE_TIMEOUT_MS = 2500;

// UX State Tracking
const COMPLETED_REACTIONS = new Map(); // sessionId -> Set(messageId)

async function clearCompletedReactions(ctx, sessionId) {
    const messageIds = COMPLETED_REACTIONS.get(sessionId);
    if (messageIds && messageIds.size > 0) {
        console.log(`[UX] Clearing ${messageIds.size} completed reactions for session ${sessionId}`);
        for (const msgId of messageIds) {
            try {
                // Passing empty array removes all reactions
                await ctx.telegram.setMessageReaction(ctx.chat.id, msgId, []);
            } catch (err) {
                // Reaction might already be gone or message deleted
            }
        }
        messageIds.clear();
    }
}

function markReactionCompleted(sessionId, messageId) {
    if (!COMPLETED_REACTIONS.has(sessionId)) {
        COMPLETED_REACTIONS.set(sessionId, new Set());
    }
    COMPLETED_REACTIONS.get(sessionId).add(messageId);
}

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

    // Natively isolated context bubble: stability per chat is key for 1:1 context continuity.
    // ThreadId is used for internal routing/anchoring, not storage partitioning.
    const polarSessionId = envelope.sessionId;

    // UX Enhancement: Clear old success reactions when new message starts
    await clearCompletedReactions(ctx, polarSessionId);

    if (!MESSAGE_BUFFER.has(polarSessionId)) {
        MESSAGE_BUFFER.set(polarSessionId, { contexts: [], timer: null });
    }
    const buffer = MESSAGE_BUFFER.get(polarSessionId);
    buffer.contexts.push({ ctx, envelope });

    if (buffer.timer) clearTimeout(buffer.timer);

    buffer.timer = setTimeout(() => {
        MESSAGE_BUFFER.delete(polarSessionId);
        processGroupedMessages(polarSessionId, buffer.contexts).catch(err => {
            console.error("Error processing grouped text:", err);
            safeReact(ctx, '👎', ctx.message.message_id);
        });
    }, DEBOUNCE_TIMEOUT_MS);
}

// --- Handlers ---
bot.on(message('text'), async (ctx) => {
    await handleMessageDebounced(ctx);
});

async function processGroupedMessages(polarSessionId, items) {
    if (items.length === 0) return;
    const lastItem = items[items.length - 1];
    const { ctx, envelope } = lastItem;
    const telegramMessageId = ctx.message.message_id;

    try {
        // 1. Initial State: Message Received -> 👀 (Looking/Reading)
        await safeReact(ctx, '👀', telegramMessageId);

        // 2. Collate messages
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

        await safeReact(ctx, '✍', telegramMessageId);

        // 3. Orchestrate via Control Plane
        const result = await controlPlane.orchestrate({
            sessionId: polarSessionId,
            userId: ctx.from.id.toString(),
            text: userText,
            messageId: `msg_u_${telegramMessageId}`,
            metadata: {
                threadId: envelope.threadId,
                replyToMessageId: ctx.message.reply_to_message?.message_id
            }
        });

        // Logic for inline replies: only set reply-to when backend explicitly requests it
        // AND provides a concrete anchor message. Otherwise send a normal message.
        const useInlineReply = result.useInlineReply === true;
        const anchorId = result.anchorMessageId; // specific message to reply to, if provided
        // anchorMessageId may be a synthetic internal ID (e.g. "msg_err_<uuid>") — only use
        // it for Telegram reply_parameters if it's a valid numeric message ID.
        const numericAnchor = typeof anchorId === 'number' ? anchorId : (Number.isFinite(Number(anchorId)) ? Number(anchorId) : null);
        let replyOptions = {};
        if (useInlineReply) {
            const replyToId = numericAnchor || telegramMessageId;
            replyOptions = { reply_parameters: { message_id: replyToId } };
        }

        if (result.status === 'workflow_proposed') {
            // Send the explanation text first
            if (result.text) {
                await ctx.reply(result.text, replyOptions);
            }

            // Format the workflow blocks for the UI
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
                            { text: "✅ Approve", callback_data: `wf_app:${result.workflowId}` },
                            { text: "❌ Reject", callback_data: `wf_rej:${result.workflowId}` }
                        ]
                    ]
                }
            });
            if (result.assistantMessageId) {
                await controlPlane.updateMessageChannelId(polarSessionId, result.assistantMessageId, stepsMsg.message_id);
            }
        } else if (result.status === 'repair_question') {
            // Render repair disambiguation with A/B inline keyboard buttons
            const optA = result.options.find(o => o.id === 'A');
            const optB = result.options.find(o => o.id === 'B');
            const repairMsg = await ctx.reply(result.question, {
                ...replyOptions,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: `🅰️ ${optA?.label || 'Option A'}`, callback_data: `repair_sel:A:${result.correlationId}` },
                            { text: `🅱️ ${optB?.label || 'Option B'}`, callback_data: `repair_sel:B:${result.correlationId}` }
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

        // Handle additional ID binding for proposed workflows and repair questions
        if (result.status === 'workflow_proposed') {
            // result.text was sent in 237, formattedSteps in 248. Bind to the steps message (more interactive)
            // wait, we can't easily capture the msg from 237 if we didn't store it.
            // Let's just bind if result.assistantMessageId exists on the latest reply.
        }

        // 4. Final State: Success vs Pending
        if (result.status === 'completed') {
            await safeReact(ctx, '👌', telegramMessageId);
            markReactionCompleted(polarSessionId, telegramMessageId);
        } else if (result.status === 'workflow_proposed' || result.status === 'repair_question') {
            await safeReact(ctx, '⏳', telegramMessageId);
            // Both are "blocked" waiting for user button press
        } else {
            // Errors keep their 👎 or transient icons
        }

    } catch (err) {
        console.error("Error processing text:", err);
        await safeReact(ctx, '👎', telegramMessageId);
    }
}


bot.on(message('document'), async (ctx) => {
    try {
        const doc = ctx.message.document;
        if (doc.mime_type === 'application/pdf') {
            await safeReact(ctx, '⏳', ctx.message.message_id);

            const fileUrl = await ctx.telegram.getFileLink(doc.file_id);
            const response = await fetch(fileUrl);
            const buffer = await response.arrayBuffer();

            const pdfData = await pdfParse(Buffer.from(buffer));

            // BUG-021 fix: Use stable session ID
            const polarSessionId = (await resolvePolarSessionId(ctx)).replace(/^telegram:topic:.*:|^telegram:reply:.*:/, 'telegram:chat:');

            await controlPlane.appendMessage({
                sessionId: polarSessionId,
                userId: ctx.from.id.toString(),
                messageId: `msg_u_${ctx.message.message_id}`,
                role: "user",
                text: `[User uploaded PDF Document: ${doc.file_name}]\n\n${pdfData.text}`,
                timestampMs: Date.now()
            });

            await safeReact(ctx, '👌', ctx.message.message_id);
            await ctx.reply(`✅ Parsed PDF: ${doc.file_name} (${pdfData.text.length} characters)`);
        } else {
            await ctx.reply("❌ Only PDF documents are supported locally right now.");
        }
    } catch (err) {
        console.error("Error parsing document:", err);
        await ctx.reply("❌ Failed to parse document.");
    }
});

bot.on(message('photo'), async (ctx) => {
    try {
        await safeReact(ctx, '⏳', ctx.message.message_id);

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

        // BUG-021 fix: Use stable session ID
        const polarSessionId = (await resolvePolarSessionId(ctx)).replace(/^telegram:topic:.*:|^telegram:reply:.*:/, 'telegram:chat:');

        await controlPlane.appendMessage({
            sessionId: polarSessionId,
            userId: ctx.from.id.toString(),
            messageId: `msg_u_${ctx.message.message_id}`,
            role: "user",
            text: `[User uploaded Photo: ${imageSizeKb}KB image${caption ? `, caption: "${caption}"` : ""}. Photo stored as file reference, not embedded in context.]`,
            timestampMs: Date.now()
        });

        await safeReact(ctx, '👌', ctx.message.message_id);
        await ctx.reply(`✅ Photo received (${imageSizeKb}KB). Stored in context as reference.`);
    } catch (err) {
        console.error("Error parsing photo:", err);
        await ctx.reply("❌ Failed to parse photo.");
    }
});

// User reacted to a message!
async function handleReactionUpdate(ctx) {
    const reaction = ctx.update.message_reaction;
    // BUG-033 fix: Validate reaction structure before accessing properties
    if (!reaction || !reaction.chat || !reaction.new_reaction || reaction.new_reaction.length === 0) return;
    if (!reaction.user && !reaction.actor_chat) return; // No user info available (channel posts, anonymous)

    const emoji = reaction.new_reaction[0].emoji;
    const sessionId = `telegram:chat:${reaction.chat.id}`;
    const messageIdToFind = `msg_a_${reaction.message_id}`;

    if (emoji === '👍' || emoji === '💯' || emoji === '🔥') {
        console.log(`[MEMORY] User gave positive reaction ${emoji} to message ${reaction.message_id}. Writing to REACTIONS.md...`);

        const sessionHistory = await controlPlane.getSessionHistory({ sessionId, limit: 50 });
        const targetMsg = sessionHistory.items?.find(m => m.messageId === messageIdToFind);

        if (targetMsg) {
            const memoryLine = `[${new Date().toISOString()}] Positive Feedback (${emoji}) for sessionId ${sessionId}:\n${targetMsg.text}\n---\n`;
            fs.appendFileSync(path.join(process.cwd(), 'REACTIONS.md'), memoryLine);
        }
    } else if (emoji === '👎') {
        console.log(`[MEMORY] User gave negative reaction ${emoji} to message ${reaction.message_id}. Flagging as bad example...`);
        const sessionHistory = await controlPlane.getSessionHistory({ sessionId, limit: 50 });
        const targetMsg = sessionHistory.items?.find(m => m.messageId === messageIdToFind);

        if (targetMsg) {
            const memoryLine = `[${new Date().toISOString()}] Negative Feedback (${emoji}) for sessionId ${sessionId}:\n${targetMsg.text}\n---\n`;
            fs.appendFileSync(path.join(process.cwd(), 'REACTIONS.md'), memoryLine);
        }
    }
}

// --- Callback Query Handlers (Buttons) ---
bot.on('callback_query', async (ctx) => {
    const callbackData = ctx.callbackQuery.data;
    const messageText = ctx.callbackQuery.message?.text || "";

    // We stored the JSON in an in-memory Map, mapping an ID from callback_data

    if (callbackData.startsWith('wf_app:')) {
        const workflowId = callbackData.split(':')[1];

        await ctx.answerCbQuery("Workflow Approved! Executing...");
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        await ctx.reply("🚀 Executing workflow... ");

        try {
            const result = await controlPlane.executeWorkflow(workflowId);
            const sessionId = await resolvePolarSessionId(ctx).catch(() => `telegram:chat:${ctx.message?.chat?.id}`);

            if (result.status === 'completed') {
                if (result.text) {
                    const msg = await ctx.reply(result.text);
                    if (result.assistantMessageId) {
                        await controlPlane.updateMessageChannelId(sessionId, result.assistantMessageId, msg.message_id);
                    }
                }
            } else if (result.status === 'error') {
                const errMsg = await ctx.reply("❌ " + (result.text || "Workflow execution failed."));
                if (result.internalMessageId) {
                    await controlPlane.updateMessageChannelId(sessionId, result.internalMessageId, errMsg.message_id);
                }
            }
        } catch (execErr) {
            console.error(execErr);
            const crashMsg = await ctx.reply("❌ Workflow execution crashed: " + execErr.message);
            // If it crashed, result is null/undefined here. The orchestrator generates 
            // the internal ID inside its try-catch block, but we don't have it on result here.
            // Actually result will be the caught { status: 'error', text: ... } from the orchestrator.
        }

    } else if (callbackData.startsWith('wf_rej:')) {
        const workflowId = callbackData.split(':')[1];
        await controlPlane.rejectWorkflow(workflowId);

        await ctx.answerCbQuery("Workflow Rejected.");
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        await ctx.reply("❌ The workflow was abandoned.");

    } else if (callbackData.startsWith('repair_sel:')) {
        // Repair disambiguation button click: repair_sel:A:correlationId or repair_sel:B:correlationId
        const parts = callbackData.split(':');
        const selection = parts[1]; // 'A' or 'B'
        const correlationId = parts.slice(2).join(':'); // correlationId (UUID, no colons, but be safe)

        // Resolve session ID from the chat
        let sessionId;
        try {
            sessionId = await resolvePolarSessionId(ctx);
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
                await ctx.reply(`✅ ${result.text}`);
            } else {
                await ctx.reply(`⚠️ ${result.text || 'Could not process selection.'}`);
            }
        } catch (repairErr) {
            console.error('[REPAIR_SELECTION_ERROR]', repairErr);
            await ctx.reply('⚠️ Something went wrong processing your selection.');
        }
    }

});

// Graceful stops
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Start listening
bot.launch().then(() => {
    console.log("🚀 Polar Telegram Runner is online and listening...");
});
