/**
 * Mistral Provider Adapter
 * Direct access to Mistral AI models (Mistral Large, Small, Codestral, etc.)
 */

import type { LLMProviderAdapter } from './base.js';
import { createHeaders } from './base.js';
import type { LLMRequest, LLMResponse, LLMConfig } from '../types.js';
import { LLMError, LLM_PROVIDER_ENDPOINTS } from '../types.js';

interface MistralMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
}

interface MistralTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

interface MistralRequest {
    model: string;
    messages: MistralMessage[];
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stop?: string[];
    tools?: MistralTool[];
    tool_choice?: 'auto' | 'none' | 'any';
}

interface MistralToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface MistralResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: 'assistant';
            content: string | null;
            tool_calls?: MistralToolCall[];
        };
        finish_reason: 'stop' | 'length' | 'tool_calls' | 'error';
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export class MistralProvider implements LLMProviderAdapter {
    readonly name = 'mistral';
    private readonly endpoint = LLM_PROVIDER_ENDPOINTS.mistral;

    async chat(request: LLMRequest, apiKey: string, config: LLMConfig): Promise<LLMResponse> {
        const modelId = request.modelOverride || config.modelId;

        // Map messages
        const messages: MistralMessage[] = request.messages.map(msg => {
            const mapped: MistralMessage = {
                role: msg.role,
                content: msg.content,
            };
            if (msg.name) {
                mapped.name = msg.name;
            }
            return mapped;
        });

        const mistralRequest: MistralRequest = {
            model: modelId,
            messages,
        };

        // Conditionally add optional properties
        if (request.temperature !== undefined || config.parameters.temperature !== undefined) {
            mistralRequest.temperature = request.temperature ?? config.parameters.temperature;
        }
        if (request.maxTokens !== undefined) {
            mistralRequest.max_tokens = request.maxTokens;
        } else if (config.parameters.maxTokens !== undefined) {
            mistralRequest.max_tokens = config.parameters.maxTokens;
        }
        if (config.parameters.topP !== undefined) {
            mistralRequest.top_p = config.parameters.topP;
        }
        if (request.stopSequences && request.stopSequences.length > 0) {
            mistralRequest.stop = request.stopSequences;
        }

        // Add tools if provided
        if (request.tools && request.tools.length > 0) {
            mistralRequest.tools = request.tools.map(tool => ({
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            }));
            mistralRequest.tool_choice = 'auto';
        }

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: createHeaders(apiKey),
                body: JSON.stringify(mistralRequest),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`Mistral error [${response.status}]: ${errorBody}`);
                throw new LLMError(
                    `Mistral API error: ${response.statusText}`,
                    'mistral',
                    response.status,
                    response.status >= 500 || response.status === 429,
                );
            }

            const data = (await response.json()) as MistralResponse;
            const choice = data.choices[0];

            if (!choice) {
                throw new LLMError('No response from Mistral', 'mistral');
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
                finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : choice.finish_reason === 'length' ? 'length' : 'stop',
                usage: data.usage ? {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens,
                } : undefined,
                model: data.model,
            };
        } catch (error) {
            if (error instanceof LLMError) throw error;

            console.error(`Mistral request failed:`, error);
            throw new LLMError(
                `Mistral request failed: ${(error as Error).message}`,
                'mistral',
                undefined,
                true,
            );
        }
    }

    async isAvailable(apiKey: string | undefined): Promise<boolean> {
        if (!apiKey) return false;

        try {
            const response = await fetch('https://api.mistral.ai/v1/models', {
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
            const response = await fetch('https://api.mistral.ai/v1/models', {
                method: 'GET',
                headers: createHeaders(apiKey),
            });

            if (!response.ok) {
                console.warn(`Failed to list Mistral models: ${response.status}`);
                return [];
            }

            const data = (await response.json()) as { data?: Array<{ id: string }> };
            return data.data?.map(m => m.id) ?? [];
        } catch (error) {
            console.warn(`Failed to list Mistral models:`, error);
            return [];
        }
    }
}
