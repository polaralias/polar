
import { ChannelAdapter, InboundMessage } from './adapter.js';
import { ChannelConfig } from '../channelStore.js';

/**
 * Stub implementation of Slack Adapter for Phase 2.
 * This satisfies the requirement of having a range of channels available.
 * 
 * In a real implementation effectively:
 * - Uses @slack/bolt or @slack/web-api
 * - Uses Socket Mode (via WebSocket) or Events API (via Webhook) for inbound
 * - Uses Web API chat.postMessage for outbound
 */
export class SlackAdapter implements ChannelAdapter {
    id: string;
    platform: 'slack' = 'slack';
    private token: string;
    private appToken: string | undefined;
    private messageHandler?: (msg: InboundMessage) => Promise<void>;
    private connected: boolean = false;

    constructor(config: ChannelConfig) {
        this.id = config.id;
        this.token = config.credentials?.['botToken'] || '';
        this.appToken = config.credentials?.['appToken']; // Required for Socket Mode

        if (!this.token) {
            console.warn(`Slack adapter ${this.id} initialized without 'botToken'. It will not function.`);
        }
    }

    async connect(): Promise<void> {
        if (this.connected) return;
        this.connected = true;
        console.log(`Slack Adapter ${this.id} connected (STUB).`);

        // STUB: In a real implementation, this would start the SocketModeClient
        // For Phase 2 validation, we can simulate a connection.
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        console.log(`Slack Adapter ${this.id} disconnected.`);
    }

    onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    async send(conversationId: string, text: string): Promise<void> {
        if (!this.token) {
            console.error(`Slack send failed: No bot token configured for adapter ${this.id}`);
            return;
        }

        console.log(`[Slack STUB] Would send to ${conversationId}: "${text}"`);

        // STUB: Real implementation:
        /*
        const response = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                channel: conversationId,
                text: text
            })
        });
        */
    }

    // Helper to simulate receiving a message (useful for testing/stubbing)
    async simulateIncomingMessage(senderId: string, text: string, conversationId: string) {
        if (!this.messageHandler) return;

        const msg: InboundMessage = {
            id: `msg_${Date.now()}`,
            channelId: this.id,
            senderId,
            senderName: `User-${senderId}`,
            conversationId,
            content: text,
            timestamp: new Date().toISOString()
        };

        await this.messageHandler(msg);
    }
}
