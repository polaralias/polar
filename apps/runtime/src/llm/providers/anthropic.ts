/**
 * Anthropic Provider Adapter
 * Direct access to Claude models via the Anthropic API
 */

import type { LLMProviderAdapter } from './base.js';
import { redactApiKey } from './base.js';
import type { LLMRequest, LLMResponse, LLMConfig, LLMMessage } from '../types.js';
import { LLMError, LLM_PROVIDER_ENDPOINTS } from '../types.js';

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | Array<{ type: 'text'; text: string }>;
}

interface AnthropicTool {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
}

interface AnthropicRequest {
    model: string;
    messages: AnthropicMessage[];
    system?: string;
    max_tokens: number;
    temperature?: number;
    // NOTE: top_p deliberately omitted - Anthropic rejects unknown fields (per provider-alignment.md)
    stop_sequences?: string[];
    tools?: AnthropicTool[];
    thinking?: { type: 'enabled'; budget_tokens: number }; // Extended thinking support
}

interface AnthropicToolUse {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
}

interface AnthropicContentBlock {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
}

interface AnthropicResponse {
    id: string;
    type: 'message';
    role: 'assistant';
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
    stop_sequence?: string;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}

export class AnthropicProvider implements LLMProviderAdapter {
    readonly name = 'anthropic';
    private readonly endpoint = LLM_PROVIDER_ENDPOINTS.anthropic;
    private readonly apiVersion = '2023-06-01';

    async chat(request: LLMRequest, apiKey: string, config: LLMConfig): Promise<LLMResponse> {
        const modelId = request.modelOverride || config.modelId;

        // Extract system message and convert messages for Anthropic format
        let systemPrompt: string | undefined;
        const messages: AnthropicMessage[] = [];

        for (const msg of request.messages) {
            if (msg.role === 'system') {
                // Anthropic prefers system prompt as separate field
                systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
            } else if (msg.role === 'user' || msg.role === 'assistant') {
                messages.push({
                    role: msg.role,
                    content: msg.content,
                });
            } else if (msg.role === 'tool') {
                // Tool responses are handled as user messages in Anthropic's format
                messages.push({
                    role: 'user',
                    content: [{ type: 'text', text: `Tool result: ${msg.content}` }],
                });
            }
        }

        // Ensure messages alternate between user and assistant
        // Anthropic requires this pattern
        const normalizedMessages = this.normalizeMessageOrder(messages);

        const anthropicRequest: AnthropicRequest = {
            model: modelId,
            messages: normalizedMessages,
            max_tokens: request.maxTokens ?? config.parameters.maxTokens ?? 4096,
        };

        // Only add optional properties when defined
        if (systemPrompt) {
            anthropicRequest.system = systemPrompt;
        }
        if (request.temperature !== undefined || config.parameters.temperature !== undefined) {
            anthropicRequest.temperature = request.temperature ?? config.parameters.temperature;
        }
        // NOTE: top_p deliberately NOT sent - Anthropic rejects unknown fields (per provider-alignment.md)
        if (request.stopSequences && request.stopSequences.length > 0) {
            anthropicRequest.stop_sequences = request.stopSequences;
        }

        // Add tools if provided
        if (request.tools && request.tools.length > 0) {
            anthropicRequest.tools = request.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
            }));
        }

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': this.apiVersion,
                },
                body: JSON.stringify(anthropicRequest),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`Anthropic error [${response.status}]: ${errorBody}`);
                throw new LLMError(
                    `Anthropic API error: ${response.statusText}`,
                    'anthropic',
                    response.status,
                    response.status >= 500 || response.status === 429,
                );
            }

            const data = (await response.json()) as AnthropicResponse;

            // Extract text content and tool calls
            let textContent = '';
            const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

            for (const block of data.content) {
                if (block.type === 'text' && block.text) {
                    textContent += block.text;
                } else if (block.type === 'tool_use' && block.id && block.name) {
                    toolCalls.push({
                        id: block.id,
                        name: block.name,
                        arguments: block.input || {},
                    });
                }
            }

            // Map Anthropic's stop_reason to our format
            const finishReasonMap: Record<string, LLMResponse['finishReason']> = {
                end_turn: 'stop',
                max_tokens: 'length',
                stop_sequence: 'stop',
                tool_use: 'tool_calls',
            };

            return {
                content: textContent || null,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                finishReason: finishReasonMap[data.stop_reason] ?? 'stop',
                usage: {
                    promptTokens: data.usage.input_tokens,
                    completionTokens: data.usage.output_tokens,
                    totalTokens: data.usage.input_tokens + data.usage.output_tokens,
                },
                model: data.model,
            };
        } catch (error) {
            if (error instanceof LLMError) throw error;

            console.error(`Anthropic request failed:`, error);
            throw new LLMError(
                `Anthropic request failed: ${(error as Error).message}`,
                'anthropic',
                undefined,
                true,
            );
        }
    }

    async isAvailable(apiKey: string | undefined): Promise<boolean> {
        if (!apiKey) return false;

        try {
            // Anthropic doesn't have a simple health check endpoint
            // We'll just verify the key format
            return apiKey.startsWith('sk-ant-') && apiKey.length > 20;
        } catch {
            return false;
        }
    }

    async listModels(_apiKey: string): Promise<string[]> {
        // Anthropic doesn't have a models endpoint, return known models
        // Updated to Claude 4.5 family per provider-alignment.md
        return [
            'claude-opus-4.5',
            'claude-sonnet-4.5',
            'claude-haiku-4.5',
            // Legacy models still supported
            'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229',
        ];
    }

    /**
     * Normalize message order to ensure alternating user/assistant pattern
     * Anthropic requires messages to strictly alternate
     */
    private normalizeMessageOrder(messages: AnthropicMessage[]): AnthropicMessage[] {
        if (messages.length === 0) {
            return [{ role: 'user', content: 'Hello' }];
        }

        const result: AnthropicMessage[] = [];
        let lastRole: 'user' | 'assistant' | null = null;

        for (const msg of messages) {
            if (msg.role === lastRole) {
                // Same role twice - merge with previous or add filler
                const prev = result[result.length - 1];
                if (prev && prev.role === msg.role) {
                    const prevContent = typeof prev.content === 'string' ? prev.content : prev.content.map(c => c.text).join('\n');
                    const currContent = typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text).join('\n');
                    result[result.length - 1] = {
                        role: msg.role,
                        content: `${prevContent}\n\n${currContent}`,
                    };
                }
            } else {
                result.push(msg);
                lastRole = msg.role;
            }
        }

        // Ensure first message is from user
        const first = result[0];
        if (first && first.role !== 'user') {
            result.unshift({ role: 'user', content: 'Continue.' });
        }

        return result;
    }
}
