/**
 * Middleware that automatically retrieves relevant memories for the current turn
 * and injects them into the provider prompt.
 * 
 * @param {{
 *   memoryGateway: { search: (req: any) => Promise<any> }
 * }} config
 */
export function createMemoryRecallMiddleware({ memoryGateway }) {
    return {
        id: 'memory-recall',

        async before(context) {
            // Only inject for provider generation calls with a valid session
            if ((context.actionId === 'provider.generate' || context.actionId === 'provider.stream') &&
                context.input.sessionId &&
                context.input.userId &&
                !context.input.skipRecall) {

                const { sessionId, userId, messages } = context.input;

                // Find the last user message to use as the search query
                const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');

                if (lastUserMessage && typeof lastUserMessage.content === 'string') {
                    try {
                        const searchResult = await memoryGateway.search({
                            traceId: `${context.traceId}-recall`,
                            sessionId,
                            userId,
                            scope: 'session',
                            query: lastUserMessage.content,
                            limit: 5
                        });

                        if (searchResult.status === 'completed' && searchResult.records.length > 0) {
                            const facts = searchResult.records
                                .map(r => r.record.fact || JSON.stringify(r.record))
                                .filter(Boolean)
                                .join('\n- ');

                            if (facts) {
                                const recallBlock = `\n\n[DURABLE_MEMORY_RECALL]\nThe following relevant facts were retrieved from persistent storage:\n- ${facts}\n[END_RECALL]`;

                                // Clone messages array to avoid mutating frozen/shared input (BUG-008 fix)
                                const clonedMessages = messages.map(m => ({ ...m }));

                                // Find existing system message or prepend one
                                const systemMessage = clonedMessages.find(m => m.role === 'system');
                                if (systemMessage) {
                                    systemMessage.content = (systemMessage.content || '') + recallBlock;
                                } else {
                                    clonedMessages.unshift({
                                        role: 'system',
                                        content: `You are a helpful AI assistant.${recallBlock}`
                                    });
                                }

                                // Replace the messages reference on context.input with the cloned version
                                context.input = { ...context.input, messages: clonedMessages };
                            }
                        }
                    } catch (err) {
                        // Log the error for observability instead of silently swallowing (BUG-005 fix)
                        console.warn(`[memory-recall] Failed to recall memories: ${err.message}`);
                    }
                }
            }
        }
    };
}
