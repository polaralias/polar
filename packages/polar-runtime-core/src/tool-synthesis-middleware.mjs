/**
 * Middleware that performs a "Planning" turn to prune the toolset
 * for complex requests, improving LLM accuracy and reducing context bloat.
 * 
 * @param {{
 *   providerGateway: { generate: (req: any) => Promise<any> },
 *   plannerProfileId?: string
 * }} config
 */
export function createToolSynthesisMiddleware({ providerGateway, plannerProfileId = 'primary' }) {
    return {
        id: 'tool-synthesis',

        async before(context) {
            // Only synthesize tools for provider calls that have a significant toolset
            if ((context.actionId === 'provider.generate' || context.actionId === 'provider.stream') &&
                Array.isArray(context.input.tools) &&
                context.input.tools.length > 3 &&
                !context.input.skipSynthesis) {

                const { messages, tools, traceId } = context.input;
                const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');

                if (lastUserMessage) {
                    try {
                        // Run a lightweight planning turn to rank/select tools
                        const synthesisResult = await providerGateway.generate({
                            traceId: `${traceId}-synthesis`,
                            profileId: plannerProfileId,
                            messages: [
                                {
                                    role: 'system',
                                    content: `You are a Tool Selection Planner. Analyze the user request and select the subset of available tools that are RELEVANT to solving it.
                  
Available Tools:
${tools.map(t => `- ${t.id}: ${t.description.substring(0, 100)}...`).join('\n')}

Output JSON: { "selectedToolIds": ["id1", "id2"] }`
                                },
                                { role: 'user', content: lastUserMessage.content }
                            ],
                            responseFormat: { type: 'json_object' }
                        });

                        // Provider gateway returns { text: "..." }, not { content: "..." } (BUG-020 fix)
                        const parsed = JSON.parse(synthesisResult.text || '{}');
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
