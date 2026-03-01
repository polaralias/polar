import {
    RuntimeExecutionError,
    createStrictObjectSchema,
    stringArrayField
} from '@polar/domain';

const memoryExtractionResponseSchema = createStrictObjectSchema({
    schemaId: 'memory.extraction.response',
    fields: {
        facts: stringArrayField({ minItems: 0, required: false })
    }
});

/**
 * @param {string} rawText
 * @returns {Record<string, unknown>}
 */
function parseExtractionResponse(rawText) {
    const normalized = rawText.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(normalized);
    const validation = memoryExtractionResponseSchema.validate(parsed);
    if (!validation.ok) {
        throw new RuntimeExecutionError(`Invalid ${memoryExtractionResponseSchema.schemaId}: ${(validation.errors || []).join('; ')}`);
    }
    return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * Middleware that automatically extracts durable facts from chat messages
 * and persists them to the Memory Gateway.
 * 
 * @param {{
 *   memoryGateway: { upsert: (req: any) => Promise<any> },
 *   providerGateway: { generate: (req: any) => Promise<any> },
 *   extractionProviderId?: string,
 *   extractionModel?: string
 * }} config
 */
export function createMemoryExtractionMiddleware({
    memoryGateway,
    providerGateway,
    extractionProviderId = 'openai',
    extractionModel = 'gpt-4.1-mini'
}) {
    return {
        id: 'memory-extraction',

        async after(context) {
            // Only extract from successful user message appends
            if (context.actionId === 'chat.message.append' &&
                context.output.status === 'appended' &&
                context.input.role === 'user') {

                const { sessionId, userId, text, traceId } = context.input;

                // Run extraction in background but attach a .catch() to prevent unhandled rejections (BUG-007)
                const extractionPromise = (async () => {
                    try {
                        const extractionResult = await providerGateway.generate({
                            traceId: `${traceId}-extract`,
                            executionType: 'tool',
                            providerId: extractionProviderId,
                            model: extractionModel,
                            system: 'You are a fact extraction engine. Extract only evergreen user/project facts.',
                            prompt: `Extract durable facts from this user message.\nReturn JSON only in this shape: {"facts":["..."]}\nIf none, return {"facts":[]}\n\nUser message:\n${text}`,
                            responseFormat: { type: 'json_object' }
                        });

                        // Provider gateway returns { text: "..." }, not { content: "..." } (BUG-019 fix)
                        const parsed = parseExtractionResponse(extractionResult.text || '{}');
                        const facts = Array.isArray(parsed.facts) ? parsed.facts : [];

                        for (const fact of facts) {
                            await memoryGateway.upsert({
                                traceId: `${traceId}-extract-upsert`,
                                sessionId,
                                userId,
                                scope: 'session',
                                record: {
                                    type: 'extracted_fact',
                                    fact,
                                    sourceMessageId: context.input.messageId,
                                    extractedAt: Date.now()
                                },
                                metadata: {
                                    strategy: 'automated_extraction',
                                    originalText: text.substring(0, 100) + '...'
                                }
                            });
                        }
                    } catch (err) {
                        // Log the error for observability instead of silently swallowing (BUG-004 fix)
                        console.warn(`[memory-extraction] Failed to extract facts: ${err.message}`);
                    }
                })();

                // Attach a no-op catch to prevent unhandled rejection if the IIFE itself throws (BUG-007 fix)
                extractionPromise.catch(() => { });
            }
        }
    };
}
