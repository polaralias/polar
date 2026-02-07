/**
 * Google Gemini Provider Adapter
 * Uses Gemini model-dependent API versions and request shape.
 */

import type { LLMProviderAdapter } from './base.js';
import type { LLMConfig, LLMRequest, LLMResponse } from '../types.js';
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
        maxOutputTokens?: number;
        temperature?: number;
        topP?: number;
        stopSequences?: string[];
    };
    tools?: GeminiTool[];
}

interface GeminiFunctionCall {
    name: string;
    args: Record<string, unknown>;
}

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string;
                functionCall?: GeminiFunctionCall;
            }>;
        };
        finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
    }>;
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
    modelVersion?: string;
}

function isGemini3Model(model: string): boolean {
    return model.trim().toLowerCase().startsWith('gemini-3');
}

function apiVersionForModel(model: string): 'v1alpha' | 'v1beta' {
    return isGemini3Model(model) ? 'v1alpha' : 'v1beta';
}

function buildModelEndpoint(baseUrl: string, model: string): string {
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const apiVersion = apiVersionForModel(model);
    return `${normalizedBase}/${apiVersion}/models/${model}:generateContent`;
}

export class GeminiProvider implements LLMProviderAdapter {
    readonly name = 'gemini';
    private readonly baseEndpoint = LLM_PROVIDER_ENDPOINTS.gemini;

    async chat(request: LLMRequest, apiKey: string, config: LLMConfig): Promise<LLMResponse> {
        const modelId = request.modelOverride || config.modelId;
        const endpoint = buildModelEndpoint(this.baseEndpoint, modelId);

        let systemInstruction: GeminiRequest['systemInstruction'];
        const contents: GeminiContent[] = [];

        for (const message of request.messages) {
            if (message.role === 'system') {
                if (!systemInstruction) {
                    systemInstruction = { parts: [] };
                }
                systemInstruction.parts.push({ text: message.content });
                continue;
            }

            if (message.role === 'tool') {
                contents.push({
                    role: 'user',
                    parts: [{ text: `Tool result: ${message.content}` }],
                });
                continue;
            }

            contents.push({
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: message.content }],
            });
        }

        if (contents.length === 0) {
            contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
        }

        const payload: GeminiRequest = {
            contents,
        };

        if (systemInstruction) {
            payload.systemInstruction = systemInstruction;
        }

        const generationConfig: NonNullable<GeminiRequest['generationConfig']> = {};
        const maxTokens = request.maxTokens ?? config.parameters.maxTokens;
        if (maxTokens !== undefined) {
            generationConfig.maxOutputTokens = maxTokens;
        }

        const temperature = request.temperature ?? config.parameters.temperature;
        if (temperature !== undefined) {
            generationConfig.temperature = temperature;
        }

        if (config.parameters.topP !== undefined) {
            generationConfig.topP = config.parameters.topP;
        }

        if (request.stopSequences && request.stopSequences.length > 0) {
            generationConfig.stopSequences = request.stopSequences;
        }

        if (Object.keys(generationConfig).length > 0) {
            payload.generationConfig = generationConfig;
        }

        if (request.tools && request.tools.length > 0) {
            payload.tools = [{
                functionDeclarations: request.tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                })),
            }];
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new LLMError(
                    `Gemini API error: ${response.status} ${response.statusText} - ${errorBody}`,
                    'gemini',
                    response.status,
                    response.status >= 500 || response.status === 429,
                );
            }

            const data = (await response.json()) as GeminiResponse;
            const candidate = data.candidates?.[0];
            if (!candidate?.content?.parts) {
                throw new LLMError('No response from Gemini', 'gemini');
            }

            let textContent = '';
            const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

            for (const part of candidate.content.parts) {
                if (part.text) {
                    textContent += part.text;
                }
                if (part.functionCall) {
                    toolCalls.push({
                        id: `gemini-tool-${toolCalls.length + 1}`,
                        name: part.functionCall.name,
                        arguments: part.functionCall.args,
                    });
                }
            }

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
                finishReason: finishReasonMap[candidate.finishReason || 'STOP'] ?? 'stop',
                usage: data.usageMetadata
                    ? {
                        promptTokens: data.usageMetadata.promptTokenCount,
                        completionTokens: data.usageMetadata.candidatesTokenCount,
                        totalTokens: data.usageMetadata.totalTokenCount,
                    }
                    : undefined,
                model: data.modelVersion || modelId,
            };
        } catch (error) {
            if (error instanceof LLMError) {
                throw error;
            }
            throw new LLMError(
                `Gemini request failed: ${(error as Error).message}`,
                'gemini',
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
            const response = await fetch(`${this.baseEndpoint}/v1beta/models`, {
                method: 'GET',
                headers: { 'x-goog-api-key': apiKey },
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async listModels(apiKey: string): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseEndpoint}/v1beta/models`, {
                method: 'GET',
                headers: { 'x-goog-api-key': apiKey },
            });

            if (!response.ok) {
                return this.knownModels();
            }

            const data = (await response.json()) as { models?: Array<{ name: string }> };
            const discovered = (data.models ?? [])
                .map(model => model.name.replace(/^models\//, ''))
                .filter(model => model.startsWith('gemini-'));

            return discovered.length > 0 ? discovered : this.knownModels();
        } catch {
            return this.knownModels();
        }
    }

    private knownModels(): string[] {
        return [
            'gemini-3-pro-preview-09-2026',
            'gemini-3-flash-preview-09-2026',
            'gemini-2.5-pro',
            'gemini-2.5-flash',
        ];
    }
}
