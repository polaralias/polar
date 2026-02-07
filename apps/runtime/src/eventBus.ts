
import MessageBus from 'events';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IngestedEvent } from '@polar/core';
import { runtimeConfig } from './config.js';

const eventHistory: Map<string, IngestedEvent> = new Map();
const bus = new MessageBus();

const MAX_HISTORY = 1000;
const eventsPath = path.join(runtimeConfig.dataDir, 'events.json');
let loaded = false;

async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
        const raw = await fs.readFile(eventsPath, 'utf-8');
        const parsed = JSON.parse(raw) as IngestedEvent[];
        for (const event of parsed) {
            if (event?.id && event?.source && event?.type) {
                eventHistory.set(event.id, event);
            }
        }
    } catch {
        // first boot or file missing
    }
}

async function persistHistory(): Promise<void> {
    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
    const entries = Array.from(eventHistory.values()).slice(-MAX_HISTORY);
    await fs.writeFile(eventsPath, JSON.stringify(entries, null, 2), 'utf-8');
}

export async function ingestEvent(
    source: string,
    type: string,
    payload: Record<string, unknown>,
    originalId?: string
): Promise<IngestedEvent> {
    await ensureLoaded();
    const id = originalId || crypto.randomUUID();

    // 1. Deduplication
    if (eventHistory.has(id)) {
        console.log(`Duplicate event ignored: ${id}`);
        return eventHistory.get(id)!;
    }

    const event: IngestedEvent = {
        id,
        source,
        type,
        payload,
        timestamp: new Date().toISOString(),
    };

    // 2. Persist
    eventHistory.set(id, event);

    // Prune history
    if (eventHistory.size > MAX_HISTORY) {
        const firstKey = eventHistory.keys().next().value;
        eventHistory.delete(firstKey!);
    }
    await persistHistory();

    // 3. Broadcast
    bus.emit('event', event);
    console.log(`Event Ingested: ${source}.${type} [${id}]`);

    return event;
}

export function subscribeToEvents(callback: (event: IngestedEvent) => void) {
    bus.on('event', callback);
    return () => bus.off('event', callback);
}

export function getRecentEvents(limit: number = 50): IngestedEvent[] {
    return Array.from(eventHistory.values()).slice(-limit).reverse();
}
