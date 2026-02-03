import { getSessionMessages, markAsCompacted } from './messageStore.js';
import { proposeMemory } from './memoryStore.js';

/**
 * Periodically summarizes session logs into "Session Summary" memory items.
 * This prevents the context window from overflowing while preserving key insights.
 */
export async function runCompaction(sessionId: string, subject: string): Promise<boolean> {
    const messages = await getSessionMessages(sessionId);

    // Threshold: Only compact if we have a substantial history
    if (messages.length < 15) return false;

    // We compact the oldest batch
    const batchSize = 10;
    const contextToCompact = messages.slice(0, batchSize);

    // In production, this would call a "Summarizer" worker or an LLM service.
    // For now, we generate a trace-based summary.
    const summaryText = contextToCompact
        .map(m => `[${m.role}] ${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''}`)
        .join('\n');

    const summaryContent = {
        type: 'session_summary',
        summary: `Automated summary of ${contextToCompact.length} messages.`,
        fullTrace: summaryText,
        timestamp: new Date().toISOString(),
    };

    // Store summary in session memory
    await proposeMemory({
        type: 'session',
        content: summaryContent,
        scopeId: sessionId,
        sourceId: 'system.compactor',
        sensitivityHint: 'low',
        ttlSeconds: 3600 * 24 * 7, // Keep summaries for a week
    }, subject);

    // Mark messages as compacted so they don't show up in primary context
    await markAsCompacted(contextToCompact.map(m => m.id));

    return true;
}
