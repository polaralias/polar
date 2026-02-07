/**
 * Ollama Provider Adapter
 * Local inference support for running models on-device
 */

import type { LLMProviderAdapter } from './base.js';
import type { LLMRequest, LLMResponse, LLMConfig } from '../types.js';
import { LLMError, LLM_PROVIDER_ENDPOINTS } from '../types.js';

interface OllamaMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OllamaRequest {
    model: string;
    messages: OllamaMessage[];
    options?: {
        temperature?: number;
        num_predict?: number;
        top_p?: number;
        stop?: string[];
    };
    stream: false;
}

interface OllamaResponse {
    model: string;
    created_at: string;
    message: {
        role: 'assistant';
        content: string;
    };
    done: boolean;
    done_reason?: 'stop' | 'length' | 'load';
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

interface OllamaTagsResponse {
    models: Array<{
        name: string;
        model: string;
        modified_at: string;
        size: number;
        digest: string;
    }>;
}

export class OllamaProvider implements LLMProviderAdapter {
    readonly name = 'ollama';

    private getBaseUrl(baseUrl: string | undefined): string {
        const resolved = (baseUrl && baseUrl.trim().length > 0 ? baseUrl : LLM_PROVIDER_ENDPOINTS.ollama)
            .replace(/\/+$/, '');
        return resolved;
    }

    private getChatEndpoint(baseUrl: string | undefined): string {
        const root = this.getBaseUrl(baseUrl);
        if (root.endsWith('/api/chat')) {
            return root;
        }
        return `${root}/api/chat`;
    }

    private getTagsEndpoint(baseUrl: string | undefined): string {
        const root = this.getBaseUrl(baseUrl).replace(/\/api\/chat$/, '');
        if (root.endsWith('/api/tags')) {
            return root;
        }
        return `${root}/api/tags`;
    }

    async chat(request: LLMRequest, baseUrl: string, config: LLMConfig): Promise<LLMResponse> {
        const modelId = request.modelOverride || config.modelId;
        const endpoint = this.getChatEndpoint(baseUrl);

        // Convert messages to Ollama format (no tool role)
        const messages: OllamaMessage[] = request.messages
            .filter(msg => msg.role !== 'tool') // Ollama doesn't support tool messages directly
            .map(msg => ({
                role: msg.role === 'tool' ? 'user' : msg.role as 'system' | 'user' | 'assistant',
                content: msg.content,
            }));

        const ollamaRequest: OllamaRequest = {
            model: modelId,
            messages,
            stream: false,
        };

        // Only add options if we have values
        const options: NonNullable<OllamaRequest['options']> = {};
        if (request.temperature !== undefined || config.parameters.temperature !== undefined) {
            options.temperature = request.temperature ?? config.parameters.temperature;
        }
        if (request.maxTokens !== undefined) {
            options.num_predict = request.maxTokens;
        } else if (config.parameters.maxTokens !== undefined) {
            options.num_predict = config.parameters.maxTokens;
        }
        if (config.parameters.topP !== undefined) {
            options.top_p = config.parameters.topP;
        }
        if (request.stopSequences && request.stopSequences.length > 0) {
            options.stop = request.stopSequences;
        }
        if (Object.keys(options).length > 0) {
            ollamaRequest.options = options;
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(ollamaRequest),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`Ollama error [${response.status}]: ${errorBody}`);
                throw new LLMError(
                    `Ollama API error: ${response.statusText}`,
                    'ollama',
                    response.status,
                    response.status >= 500,
                );
            }

            const data = (await response.json()) as OllamaResponse;

            // Map Ollama's done_reason to our format
            const finishReasonMap: Record<string, LLMResponse['finishReason']> = {
                stop: 'stop',
                length: 'length',
                load: 'stop',
            };

            // Estimate token counts from Ollama metrics
            const promptTokens = data.prompt_eval_count ?? 0;
            const completionTokens = data.eval_count ?? 0;

            return {
                content: data.message.content,
                toolCalls: undefined, // Ollama doesn't support native tool calling
                finishReason: finishReasonMap[data.done_reason ?? 'stop'] ?? 'stop',
                usage: {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                },
                model: data.model,
            };
        } catch (error) {
            if (error instanceof LLMError) throw error;

            console.error(`Ollama request failed:`, error);
            throw new LLMError(
                `Ollama request failed: ${(error as Error).message}`,
                'ollama',
                undefined,
                true,
            );
        }
    }

    async isAvailable(baseUrl: string | undefined): Promise<boolean> {
        const endpoint = this.getTagsEndpoint(baseUrl);

        try {
            // Check if Ollama is running by hitting the tags endpoint
            const response = await fetch(endpoint, {
                method: 'GET',
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async listModels(baseUrl: string): Promise<string[]> {
        const endpoint = this.getTagsEndpoint(baseUrl);

        try {
            const response = await fetch(endpoint, {
                method: 'GET',
            });

            if (!response.ok) {
                console.warn(`Failed to list Ollama models: ${response.status}`);
                return [];
            }

            const data = (await response.json()) as OllamaTagsResponse;
            return data.models?.map(m => m.name) ?? [];
        } catch (error) {
            console.warn(`Failed to list Ollama models:`, error);
            return [];
        }
    }
}
