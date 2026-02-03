/**
 * OpenAI Provider Adapter
 * Direct access to OpenAI models (GPT-4o, GPT-4o-mini, o1, etc.)
 */

import type { LLMProviderAdapter } from './base.js';
import { createHeaders } from './base.js';
import type { LLMRequest, LLMResponse, LLMConfig } from '../types.js';
import { LLMError, LLM_PROVIDER_ENDPOINTS } from '../types.js';

interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
}

interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

interface OpenAIRequest {
    model: string;
    messages: OpenAIMessage[];
    temperature?: number;
    max_completion_tokens?: number; // Preferred for GPT-5 family (per provider-alignment.md)
    max_tokens?: number; // Legacy fallback for older models
    top_p?: number;
    stop?: string[];
    tools?: OpenAITool[];
    tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
    reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; // GPT-5.2 reasoning control
}

interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface OpenAIResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: 'assistant';
            content: string | null;
            tool_calls?: OpenAIToolCall[];
        };
        finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export class OpenAIProvider implements LLMProviderAdapter {
    readonly name = 'openai';
    private readonly endpoint = LLM_PROVIDER_ENDPOINTS.openai;

    async chat(request: LLMRequest, apiKey: string, config: LLMConfig): Promise<LLMResponse> {
        const modelId = request.modelOverride || config.modelId;

        // Map messages, only including name when defined
        const messages: OpenAIMessage[] = request.messages.map(msg => {
            const mapped: OpenAIMessage = {
                role: msg.role,
                content: msg.content,
            };
            if (msg.name) {
                mapped.name = msg.name;
            }
            return mapped;
        });

        const openAIRequest: OpenAIRequest = {
            model: modelId,
            messages,
        };

        // Determine if this is a GPT-5 family model (uses max_completion_tokens)
        const isGPT5Family = modelId.startsWith('gpt-5') || modelId.startsWith('chatgpt-5');

        // Conditionally add optional properties
        // Gate temperature/topP based on model - reasoning models may not support them
        const isReasoningModel = modelId.includes('o1') || modelId.includes('-pro');
        if (!isReasoningModel) {
            if (request.temperature !== undefined || config.parameters.temperature !== undefined) {
                openAIRequest.temperature = request.temperature ?? config.parameters.temperature;
            }
            if (config.parameters.topP !== undefined) {
                openAIRequest.top_p = config.parameters.topP;
            }
        }

        // Use max_completion_tokens for GPT-5 family (per provider-alignment.md)
        const maxTokens = request.maxTokens ?? config.parameters.maxTokens;
        if (maxTokens !== undefined) {
            if (isGPT5Family) {
                openAIRequest.max_completion_tokens = maxTokens;
            } else {
                openAIRequest.max_tokens = maxTokens;
            }
        }

        if (request.stopSequences && request.stopSequences.length > 0) {
            openAIRequest.stop = request.stopSequences;
        }

        // Add tools if provided
        if (request.tools && request.tools.length > 0) {
            openAIRequest.tools = request.tools.map(tool => ({
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            }));
            openAIRequest.tool_choice = 'auto';
        }

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: createHeaders(apiKey),
                body: JSON.stringify(openAIRequest),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`OpenAI error [${response.status}]: ${errorBody}`);
                throw new LLMError(
                    `OpenAI API error: ${response.statusText}`,
                    'openai',
                    response.status,
                    response.status >= 500 || response.status === 429,
                );
            }

            const data = (await response.json()) as OpenAIResponse;
            const choice = data.choices[0];

            if (!choice) {
                throw new LLMError('No response from OpenAI', 'openai');
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

            console.error(`OpenAI request failed:`, error);
            throw new LLMError(
                `OpenAI request failed: ${(error as Error).message}`,
                'openai',
                undefined,
                true,
            );
        }
    }

    async isAvailable(apiKey: string | undefined): Promise<boolean> {
        if (!apiKey) return false;

        try {
            const response = await fetch('https://api.openai.com/v1/models', {
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
            const response = await fetch('https://api.openai.com/v1/models', {
                method: 'GET',
                headers: createHeaders(apiKey),
            });

            if (!response.ok) {
                console.warn(`Failed to list OpenAI models: ${response.status}`);
                return [];
            }

            const data = (await response.json()) as { data?: Array<{ id: string }> };
            // Filter to only chat models
            const chatModels = data.data?.filter(m =>
                m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('chatgpt')
            ) ?? [];
            return chatModels.map(m => m.id);
        } catch (error) {
            console.warn(`Failed to list OpenAI models:`, error);
            return [];
        }
    }
}
