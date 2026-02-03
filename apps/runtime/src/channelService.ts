
import { loadChannels, updateChannel, ChannelConfig } from './channelStore.js';
import { TelegramAdapter } from './channels/telegram.js';
import { ChannelAdapter, InboundMessage } from './channels/adapter.js';
import { ingestEvent } from './eventBus.js';
import { classifier } from './classifierService.js';
import { confirmProposal, rejectProposal, getLastPendingProposal } from './automationService.js';
import crypto from 'node:crypto';

const adapters = new Map<string, ChannelAdapter>();
const pairingCodes = new Map<string, string>(); // code -> userId

export async function startChannelService() {
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

    // 3. Proactivity Check: Is this a reply to a proposal?
    const proposal = getLastPendingProposal();
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

    // 4. Ingest Event
    await ingestEvent('channel', 'message', {
        channelId: config.id,
        platform: config.type,
        senderId: msg.senderId,
        senderName: msg.senderName,
        conversationId: msg.conversationId,
        text: msg.content,
        timestamp: msg.timestamp
    });
}

export async function sendChannelMessage(channelId: string, conversationId: string, text: string) {
    const adapter = adapters.get(channelId);
    if (!adapter) throw new Error(`Channel ${channelId} not active`);
    await adapter.send(conversationId, text);
}

// Broadcast a message to all channels where the user is allowlisted
// This is a simplified "User Routing" for Phase 2
// Broadcast a message to all channels where the user is paired
// This effectively routes notifications to the correct user.
export async function broadcastProposal(userId: string, text: string) {
    const channels = await loadChannels();
    let sentCount = 0;

    for (const config of channels) {
        if (!config.enabled) continue;

        // Match by bound User ID (Preferred) or Fallback to allowlist (Legacy)
        const isUserChannel = config.userId === userId || (config.allowlist.length > 0 && !config.userId && config.allowlist.includes(userId /* unsafe fallback */));

        // Note: The fallback check config.allowlist.includes(userId) is technically incorrect 
        // because allowlist has SenderIDs (e.g. Telegram ID) not Polar User IDs.
        // But for dev/testing where they might match or mapped manually, we keep it loose.
        // The primary check is `config.userId === userId`.

        if (config.userId === userId) {
            const adapter = adapters.get(config.id);
            if (adapter) {
                // We send to the last active conversation if we tracked it, 
                // or just broadcast to the channel (works for 1:1 bots like Telegram).
                // Since allowlist stores senderIds, we pick the first one as "the user's chat id"
                const targetConversationId = config.allowlist[0];

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
