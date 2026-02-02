import fs from 'node:fs/promises';
import path from 'node:path';
import { runtimeConfig } from './config.js';

export type Message = {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    compacted?: boolean;
};

const MESSAGE_FILE = path.join(runtimeConfig.dataDir, 'messages.json');

async function loadMessages(): Promise<Message[]> {
    try {
        const data = await fs.readFile(MESSAGE_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

async function saveMessages(messages: Message[]): Promise<void> {
    await fs.writeFile(MESSAGE_FILE, JSON.stringify(messages, null, 2));
}

export async function appendMessage(message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    const messages = await loadMessages();
    const newMessage: Message = {
        ...message,
        id: Math.random().toString(36).substring(7),
        timestamp: new Date().toISOString(),
    };
    messages.push(newMessage);
    await saveMessages(messages);
    return newMessage;
}

export async function getSessionMessages(sessionId: string, includeCompacted = false): Promise<Message[]> {
    const messages = await loadMessages();
    return messages.filter(m => m.sessionId === sessionId && (includeCompacted || !m.compacted));
}

export async function markAsCompacted(messageIds: string[]): Promise<void> {
    const messages = await loadMessages();
    const updated = messages.map(m => messageIds.includes(m.id) ? { ...m, compacted: true } : m);
    await saveMessages(updated);
}
