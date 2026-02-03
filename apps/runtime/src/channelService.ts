
import { loadChannels, updateChannel, ChannelConfig } from './channelStore.js';
import { TelegramAdapter } from './channels/telegram.js';
import { ChannelAdapter, InboundMessage } from './channels/adapter.js';
import { ingestEvent } from './eventBus.js';
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
            if (!config.allowlist.includes(msg.senderId)) {
                config.allowlist.push(msg.senderId);
                await updateChannel(config);
                await adapter.send(msg.conversationId, `✅ Successfully paired with user ${userId}!`);
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

    // 3. Ingest Event
    await ingestEvent('channel', 'message', {
        channelId: config.id,
        platform: config.type,
        senderId: msg.senderId,
        senderName: msg.senderName,
        conversationId: msg.conversationId,
        text: msg.content,
        timestamp: msg.timestamp
    });

    // Acknowledgement (optional, good for UX)
    // await adapter.send(msg.conversationId, "Received.");
}

export async function sendChannelMessage(channelId: string, conversationId: string, text: string) {
    const adapter = adapters.get(channelId);
    if (!adapter) throw new Error(`Channel ${channelId} not active`);
    await adapter.send(conversationId, text);
}
