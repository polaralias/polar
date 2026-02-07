
import { ChannelAdapter, InboundMessage } from './adapter.js';
import { ChannelConfig } from '../channelStore.js';

export class SlackAdapter implements ChannelAdapter {
    id: string;
    platform: 'slack' = 'slack';
    private token: string;
    private messageHandler?: (msg: InboundMessage) => Promise<void>;
    private connected: boolean = false;

    constructor(config: ChannelConfig) {
        this.id = config.id;
        this.token = config.credentials?.['botToken'] || '';

        if (!this.token) {
            console.warn(`Slack adapter ${this.id} initialized without 'botToken'. It will not function.`);
        }
    }

    async connect(): Promise<void> {
        if (this.connected) return;
        this.connected = true;
        console.log(`Slack Adapter ${this.id} connected.`);
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        console.log(`Slack Adapter ${this.id} disconnected.`);
    }

    onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    private parseConversationTarget(conversationId: string): { channel: string; threadTs?: string } {
        const marker = '::thread::';
        const idx = conversationId.indexOf(marker);
        if (idx >= 0) {
            return {
                channel: conversationId.slice(0, idx),
                threadTs: conversationId.slice(idx + marker.length),
            };
        }
        return { channel: conversationId };
    }

    async send(conversationId: string, text: string): Promise<void> {
        if (!this.token) {
            console.error(`Slack send failed: No bot token configured for adapter ${this.id}`);
            return;
        }

        const target = this.parseConversationTarget(conversationId);
        console.log(`[Slack] Sending to ${target.channel}${target.threadTs ? ` (thread ${target.threadTs})` : ''}: "${text}"`);

        try {
            const response = await fetch('https://slack.com/api/chat.postMessage', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    channel: target.channel,
                    text: text,
                    ...(target.threadTs ? { thread_ts: target.threadTs } : {}),
                })
            });
            const data = await response.json() as any;
            if (!data.ok) {
                console.error(`Slack API error:`, data.error);
            }
        } catch (error) {
            console.error(`Slack network error:`, error);
        }
    }

    async handleWebhookEvent(payload: unknown): Promise<{
        ok: boolean;
        challenge?: string;
        ignored?: boolean;
        reason?: string;
    }> {
        const body = payload as {
            type?: string;
            challenge?: string;
            event?: Record<string, unknown>;
        };

        if (body?.type === 'url_verification') {
            return {
                ok: true,
                challenge: typeof body.challenge === 'string' ? body.challenge : '',
            };
        }

        if (body?.type !== 'event_callback') {
            return { ok: true, ignored: true, reason: 'Unsupported event type' };
        }

        const event = body.event as {
            type?: string;
            user?: string;
            channel?: string;
            text?: string;
            ts?: string;
            thread_ts?: string;
            subtype?: string;
            bot_id?: string;
            files?: Array<{ mimetype?: string; url_private?: string }>;
        };

        if (event?.type !== 'message') {
            return { ok: true, ignored: true, reason: 'Non-message event' };
        }
        if (event.subtype || event.bot_id) {
            return { ok: true, ignored: true, reason: 'Message subtype/bot event ignored' };
        }
        if (!event.user || !event.channel) {
            return { ok: true, ignored: true, reason: 'Missing user or channel' };
        }
        if (!this.messageHandler) {
            return { ok: false, reason: 'No message handler registered' };
        }

        const conversationId = event.thread_ts
            ? `${event.channel}::thread::${event.thread_ts}`
            : event.channel;

        const attachments: InboundMessage['attachments'] = [];
        if (Array.isArray(event.files)) {
            for (const file of event.files) {
                const mimeType = file.mimetype || 'application/octet-stream';
                const type = mimeType.startsWith('image/') ? 'image' : 'document';
                attachments.push({
                    type,
                    url: file.url_private || '',
                    mimeType,
                });
            }
        }

        const timestampMs = event.ts ? Number.parseFloat(event.ts) * 1000 : Date.now();
        const message: InboundMessage = {
            id: event.ts || `slack-${Date.now()}`,
            channelId: this.id,
            senderId: event.user,
            conversationId,
            content: event.text || '',
            ...(attachments.length > 0 ? { attachments } : {}),
            timestamp: new Date(Number.isFinite(timestampMs) ? timestampMs : Date.now()).toISOString(),
        };

        await this.messageHandler(message);
        return { ok: true };
    }
}

