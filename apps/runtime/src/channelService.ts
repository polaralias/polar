import { loadChannels, updateChannel, ChannelConfig } from './channelStore.js';
import { TelegramAdapter } from './channels/telegram.js';
import { ChannelAdapter, InboundMessage } from './channels/adapter.js';
import { ingestEvent } from './eventBus.js';
import { classifier } from './classifierService.js';
import { confirmProposal, rejectProposal, getLastPendingProposalForOwner } from './automationService.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runtimeConfig } from './config.js';
import { appendMessage } from './messageStore.js';
import { createSession, getSession, listSessions } from './sessions.js';
import { runCompaction } from './compactor.js';

const adapters = new Map<string, ChannelAdapter>();
const pairingCodes = new Map<string, string>(); // code -> userId
const conversationSessionMap = new Map<string, string>();
const senderRateMap = new Map<string, { count: number; windowStart: number }>();

const CHANNEL_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const CHANNEL_RATE_LIMIT_MAX = 30;
const ATTACHMENT_QUARANTINE_PATH = path.join(runtimeConfig.dataDir, 'attachments_quarantine.ndjson');
const CHANNEL_ROUTES_PATH = path.join(runtimeConfig.dataDir, 'channel_routes.json');
let routesLoaded = false;

export type ChannelRoute = {
    channelId: string;
    conversationId: string;
    sessionId: string;
};

export type QuarantinedAttachment = {
    id: string;
    quarantinedAt: string;
    sessionId: string;
    userId?: string;
    channelId: string;
    conversationId: string;
    senderId: string;
    attachment: {
        type: 'image' | 'document';
        url: string;
        mimeType: string;
    };
    status: 'quarantined' | 'analysis_requested' | 'analyzed' | 'rejected';
    analysisRequestedAt?: string;
    analysisRequestedBy?: string;
    analysisNote?: string;
};

setInterval(() => {
    const now = Date.now();
    for (const [key, record] of senderRateMap.entries()) {
        if (now - record.windowStart > CHANNEL_RATE_LIMIT_WINDOW_MS) {
            senderRateMap.delete(key);
        }
    }
}, CHANNEL_RATE_LIMIT_WINDOW_MS).unref();

function isSenderRateLimited(channelId: string, senderId: string): boolean {
    const key = `${channelId}:${senderId}`;
    const now = Date.now();

    let record = senderRateMap.get(key);
    if (!record) {
        record = { count: 0, windowStart: now };
        senderRateMap.set(key, record);
    } else if (now - record.windowStart > CHANNEL_RATE_LIMIT_WINDOW_MS) {
        record.count = 0;
        record.windowStart = now;
    }

    record.count += 1;
    return record.count > CHANNEL_RATE_LIMIT_MAX;
}

function routeKey(channelId: string, conversationId: string): string {
    return `${channelId}::${conversationId}`;
}

async function loadRoutesIfNeeded(): Promise<void> {
    if (routesLoaded) return;
    routesLoaded = true;
    try {
        const raw = await fs.readFile(CHANNEL_ROUTES_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, string>;
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string' && value.length > 0) {
                conversationSessionMap.set(key, value);
            }
        }
    } catch {
        // no-op: file may not exist on first run
    }
}

async function persistRoutes(): Promise<void> {
    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
    const serialized = Object.fromEntries(conversationSessionMap.entries());
    await fs.writeFile(CHANNEL_ROUTES_PATH, JSON.stringify(serialized, null, 2), 'utf-8');
}

async function getOrCreateDefaultSessionId(userId: string, channelId: string, conversationId: string): Promise<string> {
    await loadRoutesIfNeeded();
    const routingKey = routeKey(channelId, conversationId);
    const mappedSessionId = conversationSessionMap.get(routingKey);
    if (mappedSessionId) {
        const mappedSession = getSession(mappedSessionId);
        if (mappedSession?.status === 'active') {
            return mappedSession.id;
        }
    }

    const activeUserSessions = listSessions('active')
        .filter((session) => session.subject === userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const session = activeUserSessions[0] || createSession(userId);
    conversationSessionMap.set(routingKey, session.id);
    await persistRoutes();
    return session.id;
}

async function quarantineAttachments(config: ChannelConfig, sessionId: string, msg: InboundMessage): Promise<void> {
    if (!msg.attachments || msg.attachments.length === 0) return;

    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });

    const lines = msg.attachments.map((attachment) =>
        JSON.stringify({
            id: crypto.randomUUID(),
            quarantinedAt: new Date().toISOString(),
            sessionId,
            userId: config.userId,
            channelId: config.id,
            conversationId: msg.conversationId,
            senderId: msg.senderId,
            attachment,
            status: 'quarantined',
        }),
    );

    await fs.appendFile(ATTACHMENT_QUARANTINE_PATH, `${lines.join('\n')}\n`, 'utf-8');
}

async function readQuarantinedAttachments(): Promise<QuarantinedAttachment[]> {
    try {
        const raw = await fs.readFile(ATTACHMENT_QUARANTINE_PATH, 'utf-8');
        const lines = raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
        const parsed: QuarantinedAttachment[] = [];
        for (const line of lines) {
            try {
                const item = JSON.parse(line) as QuarantinedAttachment;
                if (item?.id && item?.channelId && item?.conversationId) {
                    parsed.push(item);
                }
            } catch {
                // Skip malformed lines.
            }
        }
        return parsed;
    } catch {
        return [];
    }
}

async function writeQuarantinedAttachments(items: QuarantinedAttachment[]): Promise<void> {
    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
    const body = items.map((item) => JSON.stringify(item)).join('\n');
    const suffix = body.length > 0 ? '\n' : '';
    await fs.writeFile(ATTACHMENT_QUARANTINE_PATH, `${body}${suffix}`, 'utf-8');
}

export async function listChannelRoutes(channelId: string): Promise<ChannelRoute[]> {
    await loadRoutesIfNeeded();
    const prefix = `${channelId}::`;
    return Array.from(conversationSessionMap.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, sessionId]) => ({
            channelId,
            conversationId: key.slice(prefix.length),
            sessionId,
        }))
        .sort((a, b) => a.conversationId.localeCompare(b.conversationId));
}

export async function setChannelRoute(channelId: string, conversationId: string, sessionId: string): Promise<void> {
    await loadRoutesIfNeeded();
    conversationSessionMap.set(routeKey(channelId, conversationId), sessionId);
    await persistRoutes();
}

export async function listQuarantinedChannelAttachments(filter: {
    userId?: string;
    channelId?: string;
    sessionId?: string;
    status?: QuarantinedAttachment['status'];
} = {}): Promise<QuarantinedAttachment[]> {
    const items = await readQuarantinedAttachments();
    return items
        .filter((item) => {
            if (filter.userId && item.userId !== filter.userId) return false;
            if (filter.channelId && item.channelId !== filter.channelId) return false;
            if (filter.sessionId && item.sessionId !== filter.sessionId) return false;
            if (filter.status && item.status !== filter.status) return false;
            return true;
        })
        .sort((a, b) => new Date(b.quarantinedAt).getTime() - new Date(a.quarantinedAt).getTime());
}

export async function requestAttachmentAnalysis(params: {
    attachmentId: string;
    requestedBy: string;
    note?: string;
}): Promise<QuarantinedAttachment | null> {
    const items = await readQuarantinedAttachments();
    const index = items.findIndex((item) => item.id === params.attachmentId);
    if (index < 0) return null;

    const current = items[index];
    if (!current) return null;
    const updated: QuarantinedAttachment = {
        ...current,
        status: 'analysis_requested',
        analysisRequestedAt: new Date().toISOString(),
        analysisRequestedBy: params.requestedBy,
        ...(params.note ? { analysisNote: params.note } : {}),
    };
    items[index] = updated;
    await writeQuarantinedAttachments(items);

    await appendMessage({
        sessionId: updated.sessionId,
        role: 'user',
        content: `Analyze quarantined attachment ${updated.id} (${updated.attachment.mimeType}) from ${updated.channelId}. ${params.note || ''}`.trim(),
    });

    await ingestEvent('channel', 'attachment_analysis_requested', {
        attachmentId: updated.id,
        sessionId: updated.sessionId,
        channelId: updated.channelId,
        conversationId: updated.conversationId,
        requestedBy: params.requestedBy,
    });

    const adapter = adapters.get(updated.channelId);
    if (adapter) {
        await adapter.send(
            updated.conversationId,
            'Attachment marked for analysis. I will review it in the linked session.',
        );
    }

    return updated;
}

export async function startChannelService() {
    await loadRoutesIfNeeded();
    const channels = await loadChannels();
    for (const config of channels) {
        if (config.enabled && !adapters.has(config.id)) {
            await startAdapter(config);
        }
    }
}

async function startAdapter(config: ChannelConfig) {
    let adapter: ChannelAdapter | undefined;

    if (config.type === 'telegram') {
        adapter = new TelegramAdapter(config);
    } else if (config.type === 'slack') {
        const { SlackAdapter } = await import('./channels/slack.js');
        adapter = new SlackAdapter(config);
    }

    if (adapter) {
        adapter.onMessage((msg) => handleInboundMessage(config, adapter!, msg));
        await adapter.connect();
        adapters.set(config.id, adapter);
        console.log(`Started channel adapter: ${config.id} (${config.type})`);
    }
}

export async function generatePairingCode(userId: string): Promise<string> {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars
    pairingCodes.set(code, userId);
    // Expire/cleanup logic omitted for MVP
    setTimeout(() => pairingCodes.delete(code), 10 * 60 * 1000); // 10 mins
    return code;
}

async function handleInboundMessage(config: ChannelConfig, adapter: ChannelAdapter, msg: InboundMessage) {
    console.log(`[Channel ${config.id}] Inbound from ${msg.senderId}: ${msg.content}`);

    if (isSenderRateLimited(config.id, msg.senderId)) {
        console.warn(`[Channel ${config.id}] Rate limit exceeded for sender ${msg.senderId}; dropping message.`);
        return;
    }

    // 1. Pairing Check
    if (msg.content.startsWith('/pair ')) {
        const code = msg.content.split(' ')[1]?.trim();
        if (code && pairingCodes.has(code)) {
            const userId = pairingCodes.get(code)!;

            // Add to allowlist
            // Add to allowlist and bind to user
            if (!config.allowlist.includes(msg.senderId)) {
                config.allowlist.push(msg.senderId);
                config.userId = userId; // Bind channel to this user
                await updateChannel(config);
                await adapter.send(msg.conversationId, `✅ Successfully paired with user ${userId}!`);

                const { appendAudit } = await import('./audit.js');
                await appendAudit({
                    id: crypto.randomUUID(),
                    time: new Date().toISOString(),
                    subject: userId,
                    action: 'channel.pair_complete',
                    decision: 'allow',
                    resource: { type: 'system', component: 'channel' },
                    requestId: crypto.randomUUID(),
                    metadata: {
                        channelId: config.id,
                        senderId: msg.senderId,
                        platform: config.type
                    }
                });

                pairingCodes.delete(code);
                console.log(`Paired ${msg.senderId} to ${userId}`);
            } else {
                await adapter.send(msg.conversationId, `Already paired.`);
            }
            return;
        } else {
            // Only reply failure if strictly looking like a pairing attempt
            await adapter.send(msg.conversationId, `❌ Invalid or expired pairing code.`);
            return;
        }
    }

    // 2. Allowlist Enforcement
    if (!config.allowlist.includes(msg.senderId)) {
        console.log(`[Channel ${config.id}] Ignored message from unauthorized sender ${msg.senderId}`);
        // Stealth mode: Don't reply
        return;
    }

    const userId = config.userId || 'anonymous';
    const sessionId = await getOrCreateDefaultSessionId(userId, config.id, msg.conversationId);

    await quarantineAttachments(config, sessionId, msg);
    if (msg.attachments && msg.attachments.length > 0) {
        await adapter.send(
            msg.conversationId,
            `Attachment received and quarantined. Ask "Analyze this file" when you want it processed.`,
        );
    }

    // 3. Proactivity Check: Is this a reply to a proposal?
    const proposal = getLastPendingProposalForOwner(userId);
    if (proposal) {
        const intent = await classifier.classify(msg.content);

        // Debug log for classification (useful for MVP validation)
        console.log(`[Channel ${config.id}] Message: "${msg.content}" classified as:`, intent);

        if (intent.type === 'confirmation') {
            await confirmProposal(proposal.id);
            await adapter.send(msg.conversationId, `✅ Confirmed! Executing "${proposal.envelope.name}"...`);
            return;
        }

        if (intent.type === 'rejection') {
            rejectProposal(proposal.id);
            await adapter.send(msg.conversationId, `❌ Cancelled.`);
            return;
        }
    }

    if (msg.content.trim().length > 0) {
        await appendMessage({
            sessionId,
            role: 'user',
            content: msg.content,
        });
        runCompaction(sessionId, userId).catch((error) => {
            console.error(`Compaction failed for channel session ${sessionId}:`, error);
        });
    }

    // 4. Ingest Event
    await ingestEvent('channel', 'message', {
        channelId: config.id,
        platform: config.type,
        sessionId,
        senderId: msg.senderId,
        senderName: msg.senderName,
        conversationId: msg.conversationId,
        text: msg.content,
        attachmentCount: msg.attachments?.length || 0,
        timestamp: msg.timestamp
    });
}

export async function sendChannelMessage(channelId: string, conversationId: string, text: string) {
    const adapter = adapters.get(channelId);
    if (!adapter) throw new Error(`Channel ${channelId} not active`);
    await adapter.send(conversationId, text);
}

function getRoutedConversationForChannel(channelId: string): string | undefined {
    const prefix = `${channelId}::`;
    const entries = Array.from(conversationSessionMap.keys()).filter((key) => key.startsWith(prefix));
    if (entries.length === 0) return undefined;
    const latestKey = entries[entries.length - 1];
    if (!latestKey) return undefined;
    return latestKey.slice(prefix.length);
}

// Broadcast a message to all channels where the user is paired.
export async function broadcastUserMessage(userId: string, text: string): Promise<number> {
    await loadRoutesIfNeeded();
    const channels = await loadChannels();
    let sentCount = 0;

    for (const config of channels) {
        if (!config.enabled) continue;

        if (config.userId === userId) {
            const adapter = adapters.get(config.id);
            if (adapter) {
                const targetConversationId = getRoutedConversationForChannel(config.id) || config.allowlist[0];

                if (targetConversationId) {
                    console.log(`[Broadcast] Sending to ${userId} on ${config.id} (Conversation: ${targetConversationId})`);
                    await adapter.send(targetConversationId, text);
                    sentCount++;
                }
            }
        }
    }
    return sentCount;
}

export async function broadcastProposal(userId: string, text: string) {
    return broadcastUserMessage(userId, text);
}

export async function ingestSlackEvent(channelId: string, payload: unknown): Promise<{
    ok: boolean;
    challenge?: string;
    ignored?: boolean;
    reason?: string;
}> {
    const { getChannel } = await import('./channelStore.js');
    const channel = await getChannel(channelId);
    if (!channel || channel.type !== 'slack') {
        return { ok: false, reason: 'Channel not found or not slack' };
    }

    if (channel.enabled && !adapters.has(channel.id)) {
        await startAdapter(channel);
    }

    const adapter = adapters.get(channel.id);
    if (!adapter) {
        return { ok: false, reason: 'Slack adapter is not active' };
    }

    const { SlackAdapter } = await import('./channels/slack.js');
    if (!(adapter instanceof SlackAdapter)) {
        return { ok: false, reason: 'Adapter type mismatch' };
    }

    return adapter.handleWebhookEvent(payload);
}
