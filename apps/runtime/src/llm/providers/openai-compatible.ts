/**
 * Generic OpenAI-compatible provider adapter.
 * Covers cloud OpenAI-compatible APIs and local inference servers.
 */

import type { LLMProviderAdapter } from './base.js';
import type { LLMConfig, LLMProvider, LLMRequest, LLMResponse } from '../types.js';
import { LLMError } from '../types.js';

interface OpenAICompatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
}

interface OpenAICompatTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

interface OpenAICompatToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface OpenAICompatResponse {
    model: string;
    choices: Array<{
        message: {
            role: 'assistant';
            content: string | null;
            tool_calls?: OpenAICompatToolCall[];
        };
        finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

interface OllamaTagsResponse {
    models?: Array<{
        name: string;
    }>;
}

export interface OpenAICompatibleProviderOptions {
    name: LLMProvider;
    defaultBaseUrl: string;
    authType: 'none' | 'bearer';
    maxTokensParameter?: 'max_tokens' | 'max_completion_tokens';
    extraHeaders?: Record<string, string>;
}

function isReasoningFamilyModel(model: string): boolean {
    const lower = model.trim().toLowerCase();
    return (
        lower.startsWith('o1') ||
        lower.startsWith('o3') ||
        lower.startsWith('o4') ||
        lower.startsWith('gpt-5') ||
        lower.includes('gpt-5') ||
        lower.startsWith('computer-use') ||
        lower.includes('-o1') ||
        lower.includes('-o3') ||
        lower.includes('-o4') ||
        lower.includes('o1-') ||
        lower.includes('o3-') ||
        lower.includes('o4-')
    );
}

function supportsCustomTemperature(model: string): boolean {
    return !isReasoningFamilyModel(model);
}

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
}

export class OpenAICompatibleProvider implements LLMProviderAdapter {
    readonly name: LLMProvider;

    private readonly defaultBaseUrl: string;
    private readonly authType: 'none' | 'bearer';
    private readonly maxTokensParameter: 'max_tokens' | 'max_completion_tokens';
    private readonly extraHeaders: Record<string, string>;

    constructor(options: OpenAICompatibleProviderOptions) {
        this.name = options.name;
        this.defaultBaseUrl = options.defaultBaseUrl;
        this.authType = options.authType;
        this.maxTokensParameter = options.maxTokensParameter ?? 'max_tokens';
        this.extraHeaders = options.extraHeaders ?? {};
    }

    private resolveBaseUrl(credential: string | undefined): string {
        if (this.authType === 'none') {
            const candidate = credential?.trim();
            return normalizeBaseUrl(candidate && candidate.length > 0 ? candidate : this.defaultBaseUrl);
        }
        return normalizeBaseUrl(this.defaultBaseUrl);
    }

    private chatEndpoint(baseUrl: string): string {
        if (baseUrl.endsWith('/v1')) {
            return `${baseUrl}/chat/completions`;
        }
        return `${baseUrl}/v1/chat/completions`;
    }

    private modelsEndpoint(baseUrl: string): string {
        if (baseUrl.endsWith('/v1')) {
            return `${baseUrl}/models`;
        }
        return `${baseUrl}/v1/models`;
    }

    private headers(credential: string | undefined): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...this.extraHeaders,
        };

        if (this.authType === 'bearer' && credential) {
            headers.Authorization = `Bearer ${credential}`;
        }

        return headers;
    }

    async chat(request: LLMRequest, credential: string, config: LLMConfig): Promise<LLMResponse> {
        const modelId = request.modelOverride || config.modelId;
        const baseUrl = this.resolveBaseUrl(credential);
        const endpoint = this.chatEndpoint(baseUrl);

        const messages: OpenAICompatMessage[] = request.messages.map(message => {
            const mapped: OpenAICompatMessage = {
                role: message.role,
                content: message.content,
            };
            if (message.name) {
                mapped.name = message.name;
            }
            return mapped;
        });

        const payload: Record<string, unknown> = {
            model: modelId,
            messages,
            stream: false,
        };

        const maxTokens = request.maxTokens ?? config.parameters.maxTokens;
        if (maxTokens !== undefined) {
            payload[this.maxTokensParameter] = maxTokens;
        }

        const requestedTemperature = request.temperature ?? config.parameters.temperature;
        if (requestedTemperature !== undefined && supportsCustomTemperature(modelId)) {
            payload.temperature = requestedTemperature;
        }

        if (config.parameters.topP !== undefined) {
            payload.top_p = config.parameters.topP;
        }

        if (request.stopSequences && request.stopSequences.length > 0) {
            payload.stop = request.stopSequences;
        }

        if (request.tools && request.tools.length > 0) {
            payload.tools = request.tools.map(tool => ({
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            })) as OpenAICompatTool[];
            payload.tool_choice = 'auto';
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: this.headers(credential),
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new LLMError(
                    `${this.name} API error: ${response.status} ${response.statusText} - ${errorBody}`,
                    this.name,
                    response.status,
                    response.status >= 500 || response.status === 429,
                );
            }

            const data = (await response.json()) as OpenAICompatResponse;
            const choice = data.choices?.[0];
            if (!choice) {
                throw new LLMError(`No response from ${this.name}`, this.name);
            }

            const toolCalls = choice.message.tool_calls?.map(toolCall => {
                let argumentsValue: Record<string, unknown> = {};
                try {
                    argumentsValue = JSON.parse(toolCall.function.arguments);
                } catch {
                    argumentsValue = {};
                }
                return {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: argumentsValue,
                };
            });

            const finishReasonMap: Record<string, LLMResponse['finishReason']> = {
                stop: 'stop',
                length: 'length',
                tool_calls: 'tool_calls',
                content_filter: 'content_filter',
            };

            return {
                content: choice.message.content,
                toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
                finishReason: finishReasonMap[choice.finish_reason] ?? 'stop',
                usage: data.usage
                    ? {
                        promptTokens: data.usage.prompt_tokens,
                        completionTokens: data.usage.completion_tokens,
                        totalTokens: data.usage.total_tokens,
                    }
                    : undefined,
                model: data.model || modelId,
            };
        } catch (error) {
            if (error instanceof LLMError) {
                throw error;
            }
            throw new LLMError(
                `${this.name} request failed: ${(error as Error).message}`,
                this.name,
                undefined,
                true,
            );
        }
    }

    async isAvailable(credential: string | undefined): Promise<boolean> {
        if (this.authType === 'bearer' && !credential) {
            return false;
        }

        const baseUrl = this.resolveBaseUrl(credential);
        const modelsEndpoint = this.modelsEndpoint(baseUrl);

        try {
            const response = await fetch(modelsEndpoint, {
                method: 'GET',
                headers: this.headers(credential),
            });
            if (response.ok) {
                return true;
            }
        } catch {
            // Ignore and try local fallback.
        }

        if (this.authType === 'none') {
            try {
                const response = await fetch(`${baseUrl.replace('/v1', '')}/api/tags`, {
                    method: 'GET',
                });
                return response.ok;
            } catch {
                return false;
            }
        }

        return false;
    }

    async listModels(credential: string): Promise<string[]> {
        const baseUrl = this.resolveBaseUrl(credential);
        const modelsEndpoint = this.modelsEndpoint(baseUrl);

        try {
            const response = await fetch(modelsEndpoint, {
                method: 'GET',
                headers: this.headers(credential),
            });

            if (response.ok) {
                const data = (await response.json()) as { data?: Array<{ id: string }> };
                return data.data?.map(model => model.id) ?? [];
            }
        } catch {
            // Ignore and try local fallback.
        }

        if (this.authType === 'none') {
            try {
                const response = await fetch(`${baseUrl.replace('/v1', '')}/api/tags`, {
                    method: 'GET',
                });

                if (response.ok) {
                    const data = (await response.json()) as OllamaTagsResponse;
                    return data.models?.map(model => model.name) ?? [];
                }
            } catch {
                return [];
            }
        }

        return [];
    }
}
