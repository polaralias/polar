/**
 * OpenAI Provider Adapter
 * Uses the Responses API for GPT-5 and modern OpenAI models.
 */

import type { LLMProviderAdapter } from './base.js';
import { createHeaders } from './base.js';
import type { LLMConfig, LLMRequest, LLMResponse } from '../types.js';
import { LLMError, LLM_PROVIDER_ENDPOINTS } from '../types.js';

interface OpenAIResponsesInput {
    role: 'user' | 'assistant';
    content: string;
}

interface OpenAIResponsesTool {
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

interface OpenAIResponsesRequest {
    model: string;
    input: OpenAIResponsesInput[];
    instructions?: string;
    max_output_tokens?: number;
    temperature?: number;
    top_p?: number;
    stop?: string[];
    tools?: OpenAIResponsesTool[];
}

interface OpenAIOutputTextItem {
    type: 'output_text';
    text: string;
}

interface OpenAIFunctionCallItem {
    type: 'function_call';
    call_id?: string;
    name: string;
    arguments?: string;
}

interface OpenAIMessageOutputItem {
    type: 'message';
    content?: Array<OpenAIOutputTextItem | { type: string; text?: string }>;
}

type OpenAIOutputItem = OpenAIMessageOutputItem | OpenAIFunctionCallItem | { type: string };

interface OpenAIResponsesResponse {
    model?: string;
    output?: OpenAIOutputItem[];
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
    };
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

export class OpenAIProvider implements LLMProviderAdapter {
    readonly name = 'openai';
    private readonly baseEndpoint = LLM_PROVIDER_ENDPOINTS.openai;

    private endpoint(path: '/v1/responses' | '/v1/models'): string {
        const base = this.baseEndpoint.replace(/\/+$/, '');
        return `${base}${path}`;
    }

    async chat(request: LLMRequest, apiKey: string, config: LLMConfig): Promise<LLMResponse> {
        const modelId = request.modelOverride || config.modelId;

        let instructions: string | undefined;
        const input: OpenAIResponsesInput[] = [];

        for (const message of request.messages) {
            if (message.role === 'system') {
                instructions = instructions
                    ? `${instructions}\n\n${message.content}`
                    : message.content;
                continue;
            }

            if (message.role === 'tool') {
                input.push({
                    role: 'user',
                    content: `Tool result: ${message.content}`,
                });
                continue;
            }

            input.push({
                role: message.role === 'assistant' ? 'assistant' : 'user',
                content: message.content,
            });
        }

        if (input.length === 0) {
            input.push({ role: 'user', content: 'Hello' });
        }

        const payload: OpenAIResponsesRequest = {
            model: modelId,
            input,
        };

        if (instructions) {
            payload.instructions = instructions;
        }

        const maxTokens = request.maxTokens ?? config.parameters.maxTokens;
        if (maxTokens !== undefined) {
            payload.max_output_tokens = maxTokens;
        }

        const temperature = request.temperature ?? config.parameters.temperature;
        if (temperature !== undefined && supportsCustomTemperature(modelId)) {
            payload.temperature = temperature;
        }

        if (config.parameters.topP !== undefined) {
            payload.top_p = config.parameters.topP;
        }

        if (request.stopSequences && request.stopSequences.length > 0) {
            payload.stop = request.stopSequences;
        }

        if (request.tools && request.tools.length > 0) {
            payload.tools = request.tools.map(tool => ({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            }));
        }

        try {
            const response = await fetch(this.endpoint('/v1/responses'), {
                method: 'POST',
                headers: createHeaders(apiKey),
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new LLMError(
                    `OpenAI API error: ${response.status} ${response.statusText} - ${errorBody}`,
                    'openai',
                    response.status,
                    response.status >= 500 || response.status === 429,
                );
            }

            const data = (await response.json()) as OpenAIResponsesResponse;

            let textContent = '';
            const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

            for (const outputItem of data.output ?? []) {
                if (outputItem.type === 'message' && 'content' in outputItem) {
                    for (const contentItem of outputItem.content ?? []) {
                        if (contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
                            textContent += contentItem.text;
                        }
                    }
                    continue;
                }

                if (outputItem.type === 'function_call' && 'name' in outputItem) {
                    let parsedArgs: Record<string, unknown> = {};
                    const serializedArgs = 'arguments' in outputItem ? outputItem.arguments : undefined;
                    if (serializedArgs) {
                        try {
                            parsedArgs = JSON.parse(serializedArgs);
                        } catch {
                            parsedArgs = {};
                        }
                    }
                    toolCalls.push({
                        id: ('call_id' in outputItem ? outputItem.call_id : undefined) || `openai-tool-${toolCalls.length + 1}`,
                        name: outputItem.name,
                        arguments: parsedArgs,
                    });
                }
            }

            return {
                content: textContent || null,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
                usage: data.usage
                    ? {
                        promptTokens: data.usage.input_tokens ?? 0,
                        completionTokens: data.usage.output_tokens ?? 0,
                        totalTokens: data.usage.total_tokens
                            ?? ((data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0)),
                    }
                    : undefined,
                model: data.model || modelId,
            };
        } catch (error) {
            if (error instanceof LLMError) {
                throw error;
            }

            throw new LLMError(
                `OpenAI request failed: ${(error as Error).message}`,
                'openai',
                undefined,
                true,
            );
        }
    }

    async isAvailable(apiKey: string | undefined): Promise<boolean> {
        if (!apiKey) {
            return false;
        }

        try {
            const response = await fetch(this.endpoint('/v1/models'), {
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
            const response = await fetch(this.endpoint('/v1/models'), {
                method: 'GET',
                headers: createHeaders(apiKey),
            });

            if (!response.ok) {
                return [];
            }

            const data = (await response.json()) as { data?: Array<{ id: string }> };
            return (data.data ?? [])
                .map(model => model.id)
                .filter(id =>
                    id.startsWith('gpt-')
                    || id.startsWith('o1')
                    || id.startsWith('o3')
                    || id.startsWith('o4')
                    || id.startsWith('chatgpt')
                    || id.startsWith('computer-use'),
                );
        } catch {
            return [];
        }
    }
}
