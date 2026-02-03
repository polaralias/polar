
import { ChannelAdapter, InboundMessage } from './adapter.js';
import { ChannelConfig } from '../channelStore.js';

export class TelegramAdapter implements ChannelAdapter {
    id: string;
    platform: 'telegram' = 'telegram';
    private token: string;
    private polling: boolean = false;
    private offset: number = 0;
    private messageHandler?: (msg: InboundMessage) => Promise<void>;

    constructor(config: ChannelConfig) {
        this.id = config.id;
        this.token = config.credentials?.['token'] || '';
        if (!this.token) {
            throw new Error(`Telegram adapter ${this.id} missing 'token' in credentials`);
        }
    }

    async connect(): Promise<void> {
        if (this.polling) return;
        this.polling = true;
        console.log(`Telegram Adapter ${this.id} connected. Starting long-polling...`);
        this.pollLoop();
    }

    async disconnect(): Promise<void> {
        this.polling = false;
        console.log(`Telegram Adapter ${this.id} disconnected.`);
    }

    onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    async send(conversationId: string, text: string): Promise<void> {
        try {
            const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: conversationId,
                    text: text
                })
            });
            if (!resp.ok) {
                const err = await resp.text();
                console.error(`Telegram send failed: ${err}`);
            }
        } catch (e) {
            console.error(`Telegram send network error:`, e);
        }
    }

    private async pollLoop() {
        while (this.polling) {
            try {
                // Long polling with 30s timeout
                const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset + 1}&timeout=30`;
                const resp = await fetch(url);

                if (!resp.ok) {
                    await new Promise(r => setTimeout(r, 5000)); // Backoff on error
                    continue;
                }

                const data = await resp.json() as any;
                if (!data.ok) {
                    console.error('Telegram polling error:', data.description);
                    await new Promise(r => setTimeout(r, 5000));
                    continue;
                }

                const updates = data.result as any[];
                for (const update of updates) {
                    this.offset = update.update_id;
                    if (update.message && update.message.text) {
                        await this.processMessage(update.message);
                    }
                }
            } catch (e) {
                console.error('Telegram polling exception:', e);
                await new Promise(r => setTimeout(r, 5000)); // Backoff
            }
        }
    }

    private async processMessage(telegramMsg: any) {
        if (!this.messageHandler) return;

        const msg: InboundMessage = {
            id: String(telegramMsg.message_id),
            channelId: this.id,
            senderId: String(telegramMsg.from.id),
            senderName: telegramMsg.from.username || telegramMsg.from.first_name,
            conversationId: String(telegramMsg.chat.id),
            content: telegramMsg.text,
            timestamp: new Date(telegramMsg.date * 1000).toISOString()
        };

        try {
            await this.messageHandler(msg);
        } catch (e) {
            console.error('Error handling telegram message:', e);
        }
    }
}
