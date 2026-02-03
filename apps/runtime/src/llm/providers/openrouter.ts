/**
 * OpenRouter Provider Adapter
 * Aggregator service for accessing Claude, GPT-4, Llama, and other models
 */

import type { LLMProviderAdapter } from './base.js';
import { createHeaders, redactApiKey } from './base.js';
import type { LLMRequest, LLMResponse, LLMConfig } from '../types.js';
import { LLMError, LLM_PROVIDER_ENDPOINTS } from '../types.js';

interface OpenRouterMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
}

interface OpenRouterTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

interface OpenRouterRequest {
    model: string;
    messages: OpenRouterMessage[];
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stop?: string[];
    tools?: OpenRouterTool[];
    tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

interface OpenRouterToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface OpenRouterResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: 'assistant';
            content: string | null;
            tool_calls?: OpenRouterToolCall[];
        };
        finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export class OpenRouterProvider implements LLMProviderAdapter {
    readonly name = 'openrouter';
    private readonly endpoint = LLM_PROVIDER_ENDPOINTS.openrouter;

    async chat(request: LLMRequest, apiKey: string, config: LLMConfig): Promise<LLMResponse> {
        const modelId = request.modelOverride || config.modelId;

        // Map messages, only including name when it's defined
        const messages: OpenRouterMessage[] = request.messages.map(msg => {
            const mapped: OpenRouterMessage = {
                role: msg.role,
                content: msg.content,
            };
            if (msg.name) {
                mapped.name = msg.name;
            }
            return mapped;
        });

        const openRouterRequest: OpenRouterRequest = {
            model: modelId,
            messages,
        };

        // Conditionally add optional properties
        if (request.temperature !== undefined || config.parameters.temperature !== undefined) {
            openRouterRequest.temperature = request.temperature ?? config.parameters.temperature;
        }
        if (request.maxTokens !== undefined) {
            openRouterRequest.max_tokens = request.maxTokens;
        } else if (config.parameters.maxTokens !== undefined) {
            openRouterRequest.max_tokens = config.parameters.maxTokens;
        }
        if (config.parameters.topP !== undefined) {
            openRouterRequest.top_p = config.parameters.topP;
        }
        if (request.stopSequences && request.stopSequences.length > 0) {
            openRouterRequest.stop = request.stopSequences;
        }

        // Add tools if provided
        if (request.tools && request.tools.length > 0) {
            openRouterRequest.tools = request.tools.map(tool => ({
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            }));
            openRouterRequest.tool_choice = 'auto';
        }

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: createHeaders(apiKey, {
                    'HTTP-Referer': 'https://polar-ai.local', // Required by OpenRouter
                    'X-Title': 'Polar AI Assistant',
                }),
                body: JSON.stringify(openRouterRequest),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`OpenRouter error [${response.status}]: ${errorBody}`);
                throw new LLMError(
                    `OpenRouter API error: ${response.statusText}`,
                    'openrouter',
                    response.status,
                    response.status >= 500 || response.status === 429,
                );
            }

            const data = (await response.json()) as OpenRouterResponse;
            const choice = data.choices[0];

            if (!choice) {
                throw new LLMError('No response from OpenRouter', 'openrouter');
            }

            // Parse tool calls if present
            const toolCalls = choice.message.tool_calls?.map(tc => ({
                id: tc.id,
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments),
            }));

            return {
                content: choice.message.content,
                toolCalls,
                finishReason: choice.finish_reason,
                usage: data.usage ? {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens,
                } : undefined,
                model: data.model,
            };
        } catch (error) {
            if (error instanceof LLMError) throw error;

            console.error(`OpenRouter request failed:`, error);
            throw new LLMError(
                `OpenRouter request failed: ${(error as Error).message}`,
                'openrouter',
                undefined,
                true,
            );
        }
    }

    async isAvailable(apiKey: string | undefined): Promise<boolean> {
        if (!apiKey) return false;

        try {
            // Make a minimal request to check availability
            const response = await fetch('https://openrouter.ai/api/v1/models', {
                method: 'GET',
                headers: createHeaders(apiKey),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async listModels(apiKey: string): Promise<string[]> {
        try {
            const response = await fetch('https://openrouter.ai/api/v1/models', {
                method: 'GET',
                headers: createHeaders(apiKey),
            });

            if (!response.ok) {
                console.warn(`Failed to list OpenRouter models: ${response.status}`);
                return [];
            }

            const data = (await response.json()) as { data?: Array<{ id: string }> };
            return data.data?.map(m => m.id) ?? [];
        } catch (error) {
            console.warn(`Failed to list OpenRouter models:`, error);
            return [];
        }
    }
}
