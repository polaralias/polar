/**
 * Google Gemini Provider Adapter
 * Direct access to Gemini models (Gemini 3 Pro, Flash, etc.)
 * 
 * Per provider-alignment.md:
 * - Uses thinkingLevel for Gemini 3+ models
 * - Token limit field: generationConfig.maxOutputTokens
 */

import type { LLMProviderAdapter } from './base.js';
import type { LLMRequest, LLMResponse, LLMConfig } from '../types.js';
import { LLMError, LLM_PROVIDER_ENDPOINTS } from '../types.js';

interface GeminiContent {
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
}

interface GeminiTool {
    functionDeclarations: Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    }>;
}

interface GeminiRequest {
    contents: GeminiContent[];
    systemInstruction?: { parts: Array<{ text: string }> };
    generationConfig?: {
        temperature?: number;
        topP?: number;
        maxOutputTokens?: number;
        stopSequences?: string[];
    };
    tools?: GeminiTool[];
    // Gemini 3+ thinking control (per provider-alignment.md)
    thinkingConfig?: {
        thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
        // thinkingBudget is mutually exclusive with thinkingLevel
        thinkingBudget?: number;
    };
}

interface GeminiFunctionCall {
    name: string;
    args: Record<string, unknown>;
}

interface GeminiResponse {
    candidates: Array<{
        content: {
            role: 'model';
            parts: Array<{
                text?: string;
                functionCall?: GeminiFunctionCall;
            }>;
        };
        finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
        index: number;
    }>;
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
    modelVersion?: string;
}

export class GeminiProvider implements LLMProviderAdapter {
    readonly name = 'gemini';
    private readonly baseEndpoint = LLM_PROVIDER_ENDPOINTS.gemini;

    async chat(request: LLMRequest, apiKey: string, config: LLMConfig): Promise<LLMResponse> {
        const modelId = request.modelOverride || config.modelId;
        const endpoint = `${this.baseEndpoint}/${modelId}:generateContent?key=${apiKey}`;

        // Extract system message and convert to Gemini format
        let systemInstruction: GeminiRequest['systemInstruction'];
        const contents: GeminiContent[] = [];

        for (const msg of request.messages) {
            if (msg.role === 'system') {
                // Gemini uses systemInstruction
                if (!systemInstruction) {
                    systemInstruction = { parts: [] };
                }
                systemInstruction.parts.push({ text: msg.content });
            } else if (msg.role === 'user') {
                contents.push({
                    role: 'user',
                    parts: [{ text: msg.content }],
                });
            } else if (msg.role === 'assistant') {
                contents.push({
                    role: 'model',
                    parts: [{ text: msg.content }],
                });
            } else if (msg.role === 'tool') {
                // Tool responses as user messages
                contents.push({
                    role: 'user',
                    parts: [{ text: `Tool result: ${msg.content}` }],
                });
            }
        }

        // Ensure we have at least one message
        if (contents.length === 0) {
            contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
        }

        const geminiRequest: GeminiRequest = {
            contents,
        };

        if (systemInstruction) {
            geminiRequest.systemInstruction = systemInstruction;
        }

        // Build generation config
        const genConfig: NonNullable<GeminiRequest['generationConfig']> = {};

        if (request.temperature !== undefined || config.parameters.temperature !== undefined) {
            genConfig.temperature = request.temperature ?? config.parameters.temperature;
        }
        if (config.parameters.topP !== undefined) {
            genConfig.topP = config.parameters.topP;
        }
        if (request.maxTokens !== undefined) {
            genConfig.maxOutputTokens = request.maxTokens;
        } else if (config.parameters.maxTokens !== undefined) {
            genConfig.maxOutputTokens = config.parameters.maxTokens;
        }
        if (request.stopSequences && request.stopSequences.length > 0) {
            genConfig.stopSequences = request.stopSequences;
        }

        if (Object.keys(genConfig).length > 0) {
            geminiRequest.generationConfig = genConfig;
        }

        // Add tools if provided
        if (request.tools && request.tools.length > 0) {
            geminiRequest.tools = [{
                functionDeclarations: request.tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                })),
            }];
        }

        // For Gemini 3+, thinkingLevel defaults to 'high' if not provided
        // Only add if explicitly configured (per provider-alignment.md)
        const isGemini3 = modelId.includes('gemini-3');
        if (isGemini3) {
            // Default to medium for balanced cost/quality
            geminiRequest.thinkingConfig = {
                thinkingLevel: 'medium',
            };
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(geminiRequest),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`Gemini error [${response.status}]: ${errorBody}`);
                throw new LLMError(
                    `Gemini API error: ${response.statusText}`,
                    'gemini',
                    response.status,
                    response.status >= 500 || response.status === 429,
                );
            }

            const data = (await response.json()) as GeminiResponse;
            const candidate = data.candidates?.[0];

            if (!candidate) {
                throw new LLMError('No response from Gemini', 'gemini');
            }

            // Extract text and tool calls
            let textContent = '';
            const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
            let toolCallCounter = 0;

            for (const part of candidate.content.parts) {
                if (part.text) {
                    textContent += part.text;
                } else if (part.functionCall) {
                    toolCalls.push({
                        id: `gemini-tool-${++toolCallCounter}`,
                        name: part.functionCall.name,
                        arguments: part.functionCall.args,
                    });
                }
            }

            // Map finish reason
            const finishReasonMap: Record<string, LLMResponse['finishReason']> = {
                STOP: 'stop',
                MAX_TOKENS: 'length',
                SAFETY: 'content_filter',
                RECITATION: 'content_filter',
                OTHER: 'stop',
            };

            return {
                content: textContent || null,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                finishReason: finishReasonMap[candidate.finishReason] ?? 'stop',
                usage: data.usageMetadata ? {
                    promptTokens: data.usageMetadata.promptTokenCount,
                    completionTokens: data.usageMetadata.candidatesTokenCount,
                    totalTokens: data.usageMetadata.totalTokenCount,
                } : undefined,
                model: data.modelVersion || modelId,
            };
        } catch (error) {
            if (error instanceof LLMError) throw error;

            console.error(`Gemini request failed:`, error);
            throw new LLMError(
                `Gemini request failed: ${(error as Error).message}`,
                'gemini',
                undefined,
                true,
            );
        }
    }

    async isAvailable(apiKey: string | undefined): Promise<boolean> {
        if (!apiKey) return false;

        try {
            // Simple check - try to list models
            const response = await fetch(
                `${this.baseEndpoint}?key=${apiKey}`,
                { method: 'GET' },
            );
            return response.ok;
        } catch {
            return false;
        }
    }

    async listModels(apiKey: string): Promise<string[]> {
        try {
            const response = await fetch(
                `${this.baseEndpoint}?key=${apiKey}`,
                { method: 'GET' },
            );

            if (!response.ok) {
                console.warn(`Failed to list Gemini models: ${response.status}`);
                // Return known models as fallback
                return this.getKnownModels();
            }

            const data = (await response.json()) as {
                models?: Array<{ name: string; displayName: string }>
            };

            // Filter to generative models and extract short names
            return data.models
                ?.filter(m => m.name.includes('generateContent'))
                ?.map(m => m.name.replace('models/', '')) ?? this.getKnownModels();
        } catch (error) {
            console.warn(`Failed to list Gemini models:`, error);
            return this.getKnownModels();
        }
    }

    private getKnownModels(): string[] {
        // Known models per provider-alignment.md
        return [
            'gemini-3-pro-preview',
            'gemini-3-flash-preview',
            // Legacy models
            'gemini-1.5-pro',
            'gemini-1.5-flash',
            'gemini-1.5-flash-8b',
        ];
    }
}
