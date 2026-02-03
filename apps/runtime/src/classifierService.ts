import { llmService } from './llm/service.js';
import { LLMRequest } from './llm/types.js';

export type Intent = {
    type: 'confirmation' | 'rejection' | 'unknown' | 'query' | 'run_automation';
    confidence: number;
    metadata?: Record<string, any>;
};

export class IntentClassifierService {
    /**
     * Classifies the intent of a user message.
     * Uses LLM if available, falls back to regex.
     */
    async classify(text: string): Promise<Intent> {
        // 1. Try LLM Classification
        try {
            const configStatus = await llmService.isConfigured();
            if (configStatus.configured) {
                const prompt = `Classify the user's message into one of these intents:
- confirmation (agreeing to an action, saying yes, proceed)
- rejection (cancelling, saying no, stop)
- run_automation (asking to start a task or run something)
- query (asking a question)
- unknown (doesn't fit above)

Return JSON only: { "type": "...", "confidence": 0.0-1.0, "metadata": {} }

User Message: "${text}"`;

                const request: LLMRequest = {
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1, // Low temp for deterministic classification
                };

                // Use 'cheap' tier for classification to be fast/efficient
                const response = await llmService.chat(request, { tier: 'cheap' });
                const content = (response.content || '').trim();

                // Extract JSON from potential markdown code blocks
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : content;

                const result = JSON.parse(jsonStr);

                if (result.type && ['confirmation', 'rejection', 'run_automation', 'query', 'unknown'].includes(result.type)) {
                    return {
                        type: result.type,
                        confidence: result.confidence || 0.8,
                        metadata: result.metadata
                    };
                }
            }
        } catch (e) {
            console.warn('LLM Classification failed, falling back to regex:', e);
        }

        // 2. Fallback: Regex Heuristics
        const lower = text.toLowerCase().trim();

        if (['yes', 'y', 'confirm', 'sure', 'ok', 'okay', 'run it', 'do it', 'please do', 'go ahead'].some(k => lower.includes(k))) {
            return { type: 'confirmation', confidence: 0.9 };
        }

        if (['no', 'n', 'cancel', 'stop', 'deny', 'don\'t', 'do not'].some(k => lower.includes(k))) {
            return { type: 'rejection', confidence: 0.9 };
        }

        if (lower.startsWith('run ') || lower.startsWith('start ')) {
            return { type: 'run_automation', confidence: 0.8, metadata: { command: lower } };
        }

        if (lower.endsWith('?')) {
            return { type: 'query', confidence: 0.7 };
        }

        return { type: 'unknown', confidence: 0.0 };
    }
}

export const classifier = new IntentClassifierService();
