import {
    RuntimeExecutionError,
    createStrictObjectSchema,
    stringArrayField
} from '@polar/domain';
import { parseJsonProposalText } from './proposal-contracts.mjs';
import { createJsonSchemaResponseFormat, requestStructuredJsonResponse } from './structured-output.mjs';

const memoryExtractionResponseSchema = createStrictObjectSchema({
    schemaId: 'memory.extraction.response',
    fields: {
        facts: stringArrayField({ minItems: 0 })
    }
});

const memoryExtractionResponseFormat = createJsonSchemaResponseFormat(
    'memory_extraction_response_v1',
    Object.freeze({
        type: 'object',
        additionalProperties: false,
        required: ['facts'],
        properties: {
            facts: {
                type: 'array',
                items: { type: 'string' },
            }
        }
    })
);

/**
 * Middleware that automatically extracts durable facts from chat messages
 * and persists them to the Memory Gateway.
 *
 * @param {{
 *   memoryGateway: { upsert: (req: any) => Promise<any> },
 *   providerGateway: { generate: (req: any) => Promise<any>, embed?: (req: any) => Promise<any> },
 *   extractionProviderId?: string,
 *   extractionModel?: string,
 *   embeddingProviderId?: string,
 *   embeddingModel?: string
 * }} config
 */
export function createMemoryExtractionMiddleware({
    memoryGateway,
    providerGateway,
    extractionProviderId = 'openai',
    extractionModel = 'gpt-4.1-mini',
    embeddingProviderId = 'openai',
    embeddingModel = 'text-embedding-3-small'
}) {
    return {
        id: 'memory-extraction',

        async after(context) {
            if (context.actionId === 'chat.message.append' &&
                context.output.status === 'appended' &&
                context.input.role === 'user') {

                const { sessionId, userId, text, traceId } = context.input;
                const laneThreadKey =
                    typeof context.input.threadKey === "string" && context.input.threadKey.length > 0
                        ? context.input.threadKey
                        : (
                            typeof context.input.metadata?.threadKey === "string" &&
                                context.input.metadata.threadKey.length > 0
                                ? context.input.metadata.threadKey
                                : undefined
                        );

                const extractionPromise = (async () => {
                    try {
                        const extractionPayload = {
                            userMessage: text,
                            laneThreadKey: laneThreadKey || null,
                        };
                        const extractionValidation = await requestStructuredJsonResponse({
                            providerGateway,
                            responseFormat: memoryExtractionResponseFormat,
                            initialRequest: {
                                traceId: `${traceId}-extract`,
                                executionType: 'tool',
                                providerId: extractionProviderId,
                                model: extractionModel,
                                system:
                                    `You are a fact extraction engine. Return exactly one JSON object matching ${memoryExtractionResponseSchema.schemaId}. `
                                    + 'Extract only evergreen user/project facts. No markdown or prose outside JSON.',
                                prompt:
                                    'Extract durable facts from this user message.\n'
                                    + 'Return JSON only in this shape: {"facts":["..."]}\n'
                                    + 'If none, return {"facts":[]}\n\n'
                                    + `Payload:\n${JSON.stringify(extractionPayload)}`,
                                temperature: 0,
                                maxOutputTokens: 240,
                            },
                            validateResponseText(rawText) {
                                return parseJsonProposalText(rawText, memoryExtractionResponseSchema);
                            },
                            buildRepairRequest({ invalidOutput, validationErrors }) {
                                return {
                                    traceId: `${traceId}-extract-repair`,
                                    executionType: 'tool',
                                    providerId: extractionProviderId,
                                    model: extractionModel,
                                    system:
                                        `You are a fact extraction JSON repairer. Return exactly one corrected JSON object matching ${memoryExtractionResponseSchema.schemaId}. `
                                        + 'Do not explain the changes.',
                                    prompt:
                                        `The prior memory extraction output was invalid. Fix it and return corrected JSON only. ${JSON.stringify({
                                            validationErrors,
                                            extractionPayload,
                                            invalidOutput,
                                        })}`,
                                    temperature: 0,
                                    maxOutputTokens: 240,
                                };
                            },
                            unavailableFallbackReason: 'memory_extraction_unavailable',
                            invalidFallbackReason: 'schema_invalid',
                        });
                        if (!extractionValidation.valid) {
                            const failureMessage =
                                typeof extractionValidation.errorMessage === 'string' &&
                                    extractionValidation.errorMessage.length > 0
                                    ? extractionValidation.errorMessage
                                    : `Invalid ${memoryExtractionResponseSchema.schemaId}: ${(extractionValidation.validationErrors || []).join('; ') || (extractionValidation.clampReasons || []).join('; ')}`;
                            throw new RuntimeExecutionError(
                                failureMessage
                            );
                        }

                        const facts = Array.isArray(extractionValidation.value?.facts)
                            ? extractionValidation.value.facts
                            : [];

                        for (const fact of facts) {
                            let embeddingVector = undefined;
                            if (typeof providerGateway.embed === "function") {
                                try {
                                    const embeddingResult = await providerGateway.embed({
                                        traceId: `${traceId}-extract-embed`,
                                        executionType: 'tool',
                                        providerId: embeddingProviderId,
                                        model: embeddingModel,
                                        text: fact,
                                    });
                                    if (
                                        embeddingResult &&
                                        Array.isArray(embeddingResult.vector) &&
                                        embeddingResult.vector.length > 0 &&
                                        embeddingResult.vector.every((value) => Number.isFinite(Number(value)))
                                    ) {
                                        embeddingVector = embeddingResult.vector.map((value) => Number(value));
                                    }
                                } catch {
                                    // non-fatal embedding failure
                                }
                            }
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
                                    originalText: text.substring(0, 100) + '...',
                                    ...(laneThreadKey ? { threadKey: laneThreadKey } : {}),
                                    ...(embeddingVector ? { embeddingVector, embeddingModel } : {}),
                                }
                            });
                        }
                    } catch (err) {
                        console.warn(`[memory-extraction] Failed to extract facts: ${err.message}`);
                    }
                })();

                extractionPromise.catch(() => { });
            }
        }
    };
}
