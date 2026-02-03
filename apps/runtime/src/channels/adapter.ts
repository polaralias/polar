
import { IngestedEvent } from '@polar/core';

export type InboundMessage = {
    id: string;
    channelId: string;
    senderId: string;
    senderName?: string;
    conversationId: string; // Chat ID or Thread ID
    content: string;
    attachments?: Array<{
        type: 'image' | 'document';
        url: string;
        mimeType: string;
    }>;
    timestamp: string;
};

export interface ChannelAdapter {
    id: string;
    platform: 'telegram' | 'slack';

    connect(): Promise<void>;
    disconnect(): Promise<void>;

    send(conversationId: string, text: string, attachments?: any[]): Promise<void>;

    onMessage(handler: (msg: InboundMessage) => Promise<void>): void;
}
