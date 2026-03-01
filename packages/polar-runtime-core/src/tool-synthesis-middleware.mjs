import {
    RuntimeExecutionError,
    createStrictObjectSchema,
    stringArrayField
} from '../../polar-domain/src/index.mjs';

const toolSynthesisResponseSchema = createStrictObjectSchema({
    schemaId: 'tool.synthesis.response',
    fields: {
        selectedToolIds: stringArrayField({ minItems: 0, required: false })
    }
});

/**
 * @param {string} rawText
 * @returns {Record<string, unknown>}
 */
function parseSynthesisResponse(rawText) {
    const normalized = rawText.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(normalized);
    const validation = toolSynthesisResponseSchema.validate(parsed);
    if (!validation.ok) {
        throw new RuntimeExecutionError(`Invalid ${toolSynthesisResponseSchema.schemaId}: ${(validation.errors || []).join('; ')}`);
    }
    return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * Middleware that performs a "Planning" turn to prune the toolset
 * for complex requests, improving LLM accuracy and reducing context bloat.
 * 
 * @param {{
 *   providerGateway: { generate: (req: any) => Promise<any> },
 *   plannerProviderId?: string,
 *   plannerModel?: string
 * }} config
 */
export function createToolSynthesisMiddleware({
    providerGateway,
    plannerProviderId = 'openai',
    plannerModel = 'gpt-4.1-mini'
}) {
    return {
        id: 'tool-synthesis',

        async before(context) {
            // Only synthesize tools for provider calls that have a significant toolset
            if ((context.actionId === 'provider.generate' || context.actionId === 'provider.stream') &&
                Array.isArray(context.input.tools) &&
                context.input.tools.length > 3 &&
                Array.isArray(context.input.messages) &&
                !context.input.skipSynthesis) {

                const { messages, tools, traceId } = context.input;
                const lastUserMessage = messages.findLast ? messages.findLast(m => m.role === 'user') : [...messages].reverse().find(m => m.role === 'user');

                if (lastUserMessage) {
                    try {
                        // Run a lightweight planning turn to rank/select tools
                        const synthesisResult = await providerGateway.generate({
                            traceId: `${traceId}-synthesis`,
                            executionType: 'tool',
                            providerId: plannerProviderId,
                            model: plannerModel,
                            system: 'You are a Tool Selection Planner. Return only valid JSON.',
                            prompt: `Analyze the request and choose only relevant tools.\n\nUser request:\n${lastUserMessage.content}\n\nAvailable tools:\n${tools.map(t => `- ${t.id}: ${t.description.substring(0, 100)}...`).join('\n')}\n\nReturn JSON only in this shape: {"selectedToolIds":["id1","id2"]}`,
                            responseFormat: { type: 'json_object' }
                        });

                        // Provider gateway returns { text: "..." }, not { content: "..." } (BUG-020 fix)
                        const parsed = parseSynthesisResponse(synthesisResult.text || '{}');
                        const selectedIds = Array.isArray(parsed.selectedToolIds) ? parsed.selectedToolIds : [];

                        if (selectedIds.length > 0) {
                            // Clone the input to avoid mutating frozen objects (BUG-009 fix)
                            const prunedTools = tools.filter(t => selectedIds.includes(t.id));

                            // Ensure we don't accidentally prune EVERYTHING if the planner hallucinated
                            const finalTools = prunedTools.length > 0 ? prunedTools : tools;

                            // Replace context.input immutably instead of mutating frozen property (BUG-009 fix)
                            context.input = { ...context.input, tools: finalTools };
                        }
                    } catch (err) {
                        // Log the error for observability instead of silently swallowing (BUG-006 fix)
                        console.warn(`[tool-synthesis] Failed to synthesize tools, using full toolset: ${err.message}`);
                    }
                }
            }
        }
    };
}
