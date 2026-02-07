/**
 * MiniMax provider adapter.
 * MiniMax uses OpenAI-compatible payloads with `max_completion_tokens`.
 */

import { LLM_PROVIDER_ENDPOINTS } from '../types.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

export class MiniMaxProvider extends OpenAICompatibleProvider {
    constructor() {
        super({
            name: 'minimax',
            defaultBaseUrl: LLM_PROVIDER_ENDPOINTS.minimax,
            authType: 'bearer',
            maxTokensParameter: 'max_completion_tokens',
        });
    }
}
