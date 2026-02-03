import fs from 'node:fs/promises';
import path from 'node:path';
import { runtimeConfig } from './config.js';
import { Mutex } from 'async-mutex';

const mutex = new Mutex();

export type ChannelType = 'slack' | 'discord' | 'webhook' | 'email' | 'telegram';

export type ChannelConfig = {
    id: string;
    type: ChannelType;
    name: string;
    enabled: boolean;
    credentials: Record<string, string>;
    allowlist: string[]; // List of verified sender IDs
};

const channelsPath = path.join(runtimeConfig.dataDir, 'channels.json');

let channels: ChannelConfig[] = [];

export async function loadChannels() {
    try {
        const raw = await fs.readFile(channelsPath, 'utf-8');
        channels = JSON.parse(raw);
    } catch {
        channels = [];
    }
    return channels;
}

export async function saveChannels() {
    await fs.writeFile(channelsPath, JSON.stringify(channels, null, 2), 'utf-8');
}

export async function getChannel(id: string) {
    await loadChannels();
    return channels.find(c => c.id === id);
}

export async function updateChannel(config: ChannelConfig) {
    await mutex.runExclusive(async () => {
        await loadChannels();
        const index = channels.findIndex(c => c.id === config.id);
        if (index >= 0) {
            channels[index] = config;
        } else {
            channels.push(config);
        }
        await saveChannels();
    });
}

export async function deleteChannel(id: string) {
    await mutex.runExclusive(async () => {
        await loadChannels();
        channels = channels.filter(c => c.id !== id);
        await saveChannels();
    });
}

export function isSenderAllowed(channel: ChannelConfig, senderId: string) {
    return channel.allowlist.includes(senderId);
}
