/**
 * Middleware that automatically retrieves relevant memories for the current turn
 * and injects them into the provider prompt.
 * 
 * @param {{
 *   memoryGateway: { search: (req: any) => Promise<any> },
 *   providerGateway?: { embed?: (req: any) => Promise<any> },
 *   embeddingProviderId?: string,
 *   embeddingModel?: string
 * }} config
 */
export function createMemoryRecallMiddleware({
    memoryGateway,
    providerGateway,
    embeddingProviderId = "openai",
    embeddingModel = "text-embedding-3-small",
}) {
    return {
        id: 'memory-recall',

        async before(context) {
            // Only inject for provider generation calls with a valid session
            if ((context.actionId === 'provider.generate' || context.actionId === 'provider.stream') &&
                context.input.sessionId &&
                context.input.userId &&
                !context.input.skipRecall) {

                const { sessionId, userId, messages } = context.input;
                const hasExistingRecallContext =
                    (typeof context.input.system === "string" &&
                        /\[(THREAD_SUMMARY|SESSION_SUMMARY|TEMPORAL_ATTENTION|RETRIEVED_MEMORIES|DURABLE_MEMORY_RECALL)/.test(context.input.system)) ||
                    (Array.isArray(messages) &&
                        messages.some((entry) =>
                            entry &&
                            entry.role === "system" &&
                            typeof entry.content === "string" &&
                            /\[(THREAD_SUMMARY|SESSION_SUMMARY|TEMPORAL_ATTENTION|RETRIEVED_MEMORIES|DURABLE_MEMORY_RECALL)/.test(entry.content)
                        ));
                if (hasExistingRecallContext) {
                    return;
                }
                const laneThreadKey =
                    typeof context.input.threadKey === "string" && context.input.threadKey.length > 0
                        ? context.input.threadKey
                        : (
                            typeof context.input.metadata?.threadKey === "string" &&
                                context.input.metadata.threadKey.length > 0
                                ? context.input.metadata.threadKey
                                : null
                        );

                // Find the last user message to use as the search query
                const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');

                if (lastUserMessage && typeof lastUserMessage.content === 'string') {
                    try {
                        let queryVector = undefined;
                        if (typeof providerGateway?.embed === "function") {
                            try {
                                const embeddingResult = await providerGateway.embed({
                                    traceId: `${context.traceId}-recall-embed`,
                                    executionType: "tool",
                                    providerId: embeddingProviderId,
                                    model: embeddingModel,
                                    text: lastUserMessage.content,
                                });
                                if (
                                    embeddingResult &&
                                    Array.isArray(embeddingResult.vector) &&
                                    embeddingResult.vector.length > 0 &&
                                    embeddingResult.vector.every((value) => Number.isFinite(Number(value)))
                                ) {
                                    queryVector = embeddingResult.vector.map((value) => Number(value));
                                }
                            } catch {
                                // non-fatal embedding failure
                            }
                        }
                        const searchResult = await memoryGateway.search({
                            traceId: `${context.traceId}-recall`,
                            sessionId,
                            userId,
                            scope: 'session',
                            query: lastUserMessage.content,
                            limit: 5,
                            ...(queryVector ? { filters: { queryVector } } : {}),
                        });

                        if (searchResult.status === 'completed' && searchResult.records.length > 0) {
                            const scopedRecords = laneThreadKey
                                ? searchResult.records.filter((recordEntry) => {
                                    const recordThreadKey = typeof recordEntry?.metadata?.threadKey === "string"
                                        ? recordEntry.metadata.threadKey
                                        : null;
                                    if (!recordThreadKey) {
                                        return recordEntry?.record?.type === "session_summary";
                                    }
                                    return recordThreadKey === laneThreadKey;
                                })
                                : searchResult.records;
                            const facts = scopedRecords
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
