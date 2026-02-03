
import MessageBus from 'events';
import crypto from 'node:crypto';
import { IngestedEvent } from '@polar/core';

// In-memory event store for MVP
// In production, this would be Redis Stream or Postgres
const eventHistory: Map<string, IngestedEvent> = new Map();
const bus = new MessageBus();

// Deduplication window (e.g., 24 hours) - naive in-memory approach
const MAX_HISTORY = 1000;

export async function ingestEvent(
    source: string,
    type: string,
    payload: Record<string, unknown>,
    originalId?: string
): Promise<IngestedEvent> {
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
