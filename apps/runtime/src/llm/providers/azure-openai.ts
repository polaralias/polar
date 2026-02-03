/**
 * Azure OpenAI Provider Adapter
 * Access to OpenAI models via Azure's infrastructure
 */

import type { LLMProviderAdapter } from './base.js';
import type { LLMRequest, LLMResponse, LLMConfig } from '../types.js';
import { LLMError } from '../types.js';

interface AzureOpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
}

interface AzureOpenAITool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

interface AzureOpenAIRequest {
    messages: AzureOpenAIMessage[];
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stop?: string[];
    tools?: AzureOpenAITool[];
    tool_choice?: 'auto' | 'none';
}

interface AzureOpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface AzureOpenAIResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: 'assistant';
            content: string | null;
            tool_calls?: AzureOpenAIToolCall[];
        };
        finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * Azure OpenAI configuration is stored as JSON in the credential field:
 * {
 *   "endpoint": "https://your-resource.openai.azure.com",
 *   "apiKey": "your-api-key",
 *   "apiVersion": "2024-02-15-preview",
 *   "deploymentId": "your-deployment-name"
 * }
 */
interface AzureCredential {
    endpoint: string;
    apiKey: string;
    apiVersion: string;
    deploymentId?: string;
}

export class AzureOpenAIProvider implements LLMProviderAdapter {
    readonly name = 'azure-openai';
    private readonly defaultApiVersion = '2024-02-15-preview';

    private parseCredential(credentialJson: string): AzureCredential {
        try {
            return JSON.parse(credentialJson);
        } catch {
            throw new LLMError(
                'Invalid Azure OpenAI credential format. Expected JSON with endpoint, apiKey, and apiVersion.',
                'azure-openai',
            );
        }
    }

    async chat(request: LLMRequest, credentialJson: string, config: LLMConfig): Promise<LLMResponse> {
        const credential = this.parseCredential(credentialJson);
        const deploymentId = credential.deploymentId || config.modelId;
        const apiVersion = credential.apiVersion || this.defaultApiVersion;

        const endpoint = `${credential.endpoint}/openai/deployments/${deploymentId}/chat/completions?api-version=${apiVersion}`;

        // Map messages
        const messages: AzureOpenAIMessage[] = request.messages.map(msg => {
            const mapped: AzureOpenAIMessage = {
                role: msg.role,
                content: msg.content,
            };
            if (msg.name) {
                mapped.name = msg.name;
            }
            return mapped;
        });

        const azureRequest: AzureOpenAIRequest = {
            messages,
        };

        // Conditionally add optional properties
        if (request.temperature !== undefined || config.parameters.temperature !== undefined) {
            azureRequest.temperature = request.temperature ?? config.parameters.temperature;
        }
        if (request.maxTokens !== undefined) {
            azureRequest.max_tokens = request.maxTokens;
        } else if (config.parameters.maxTokens !== undefined) {
            azureRequest.max_tokens = config.parameters.maxTokens;
        }
        if (config.parameters.topP !== undefined) {
            azureRequest.top_p = config.parameters.topP;
        }
        if (request.stopSequences && request.stopSequences.length > 0) {
            azureRequest.stop = request.stopSequences;
        }

        // Add tools if provided
        if (request.tools && request.tools.length > 0) {
            azureRequest.tools = request.tools.map(tool => ({
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            }));
            azureRequest.tool_choice = 'auto';
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': credential.apiKey,
                },
                body: JSON.stringify(azureRequest),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`Azure OpenAI error [${response.status}]: ${errorBody}`);
                throw new LLMError(
                    `Azure OpenAI API error: ${response.statusText}`,
                    'azure-openai',
                    response.status,
                    response.status >= 500 || response.status === 429,
                );
            }

            const data = (await response.json()) as AzureOpenAIResponse;
            const choice = data.choices[0];

            if (!choice) {
                throw new LLMError('No response from Azure OpenAI', 'azure-openai');
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

            console.error(`Azure OpenAI request failed:`, error);
            throw new LLMError(
                `Azure OpenAI request failed: ${(error as Error).message}`,
                'azure-openai',
                undefined,
                true,
            );
        }
    }

    async isAvailable(credentialJson: string | undefined): Promise<boolean> {
        if (!credentialJson) return false;

        try {
            const credential = this.parseCredential(credentialJson);
            const apiVersion = credential.apiVersion || this.defaultApiVersion;
            const endpoint = `${credential.endpoint}/openai/models?api-version=${apiVersion}`;

            const response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'api-key': credential.apiKey,
                },
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async listModels(credentialJson: string): Promise<string[]> {
        try {
            const credential = this.parseCredential(credentialJson);
            const apiVersion = credential.apiVersion || this.defaultApiVersion;
            const endpoint = `${credential.endpoint}/openai/deployments?api-version=${apiVersion}`;

            const response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'api-key': credential.apiKey,
                },
            });

            if (!response.ok) {
                console.warn(`Failed to list Azure OpenAI deployments: ${response.status}`);
                return [];
            }

            const data = (await response.json()) as { data?: Array<{ id: string }> };
            return data.data?.map(m => m.id) ?? [];
        } catch (error) {
            console.warn(`Failed to list Azure OpenAI deployments:`, error);
            return [];
        }
    }
}
