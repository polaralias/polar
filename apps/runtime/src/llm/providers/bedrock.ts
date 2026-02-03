/**
 * Amazon Bedrock Provider Adapter
 * Access to Amazon Nova, Claude, Titan, and other Bedrock models
 * 
 * Note: This implementation uses the Bedrock Runtime Converse API
 * which provides a unified interface for all chat models.
 */

import type { LLMProviderAdapter } from './base.js';
import type { LLMRequest, LLMResponse, LLMConfig } from '../types.js';
import { LLMError, LLM_PROVIDER_ENDPOINTS } from '../types.js';
import crypto from 'node:crypto';

interface BedrockMessage {
    role: 'user' | 'assistant';
    content: Array<{ text: string }>;
}

interface BedrockTool {
    toolSpec: {
        name: string;
        description: string;
        inputSchema: {
            json: Record<string, unknown>;
        };
    };
}

interface BedrockRequest {
    modelId: string;
    messages: BedrockMessage[];
    system?: Array<{ text: string }>;
    inferenceConfig?: {
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        stopSequences?: string[];
    };
    toolConfig?: {
        tools: BedrockTool[];
    };
}

interface BedrockToolUse {
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
}

interface BedrockResponse {
    output: {
        message: {
            role: 'assistant';
            content: Array<{ text?: string; toolUse?: BedrockToolUse }>;
        };
    };
    stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
    };
}

/**
 * Bedrock credential format (stored as JSON):
 * {
 *   "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
 *   "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
 *   "region": "us-east-1",
 *   "sessionToken": "optional-session-token"
 * }
 */
interface BedrockCredential {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    sessionToken?: string;
}

export class BedrockProvider implements LLMProviderAdapter {
    readonly name = 'bedrock';
    private readonly service = 'bedrock-runtime';

    private parseCredential(credentialJson: string): BedrockCredential {
        try {
            return JSON.parse(credentialJson);
        } catch {
            throw new LLMError(
                'Invalid Bedrock credential format. Expected JSON with accessKeyId, secretAccessKey, and region.',
                'bedrock',
            );
        }
    }

    /**
     * AWS Signature Version 4 signing
     * This is a simplified implementation for the Bedrock Converse API
     */
    private async signRequest(
        method: string,
        url: URL,
        body: string,
        credential: BedrockCredential,
    ): Promise<Record<string, string>> {
        const now = new Date();
        const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
        const dateStamp = amzDate.slice(0, 8);

        const host = url.host;
        const canonicalUri = url.pathname;

        // Create canonical headers
        const signedHeaders = 'content-type;host;x-amz-date';
        let canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;

        // Add session token if present
        if (credential.sessionToken) {
            canonicalHeaders += `x-amz-security-token:${credential.sessionToken}\n`;
        }

        // Create payload hash
        const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

        // Create canonical request
        const canonicalRequest = [
            method,
            canonicalUri,
            '', // canonical query string (empty)
            canonicalHeaders,
            signedHeaders,
            payloadHash,
        ].join('\n');

        // Create string to sign
        const algorithm = 'AWS4-HMAC-SHA256';
        const credentialScope = `${dateStamp}/${credential.region}/${this.service}/aws4_request`;
        const stringToSign = [
            algorithm,
            amzDate,
            credentialScope,
            crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
        ].join('\n');

        // Calculate signature
        const getSignatureKey = (key: string, date: string, region: string, service: string) => {
            const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(date).digest();
            const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
            const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
            return crypto.createHmac('sha256', kService).update('aws4_request').digest();
        };

        const signingKey = getSignatureKey(
            credential.secretAccessKey,
            dateStamp,
            credential.region,
            this.service,
        );
        const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

        // Create authorization header
        const authorization = `${algorithm} Credential=${credential.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Amz-Date': amzDate,
            Authorization: authorization,
        };

        if (credential.sessionToken) {
            headers['X-Amz-Security-Token'] = credential.sessionToken;
        }

        return headers;
    }

    async chat(request: LLMRequest, credentialJson: string, config: LLMConfig): Promise<LLMResponse> {
        const credential = this.parseCredential(credentialJson);
        const modelId = request.modelOverride || config.modelId;

        const endpoint = `https://bedrock-runtime.${credential.region}.amazonaws.com/model/${modelId}/converse`;
        const url = new URL(endpoint);

        // Extract system messages and convert to Bedrock format
        let systemMessages: Array<{ text: string }> | undefined;
        const messages: BedrockMessage[] = [];

        for (const msg of request.messages) {
            if (msg.role === 'system') {
                if (!systemMessages) systemMessages = [];
                systemMessages.push({ text: msg.content });
            } else if (msg.role === 'user' || msg.role === 'assistant') {
                messages.push({
                    role: msg.role,
                    content: [{ text: msg.content }],
                });
            } else if (msg.role === 'tool') {
                // Tool results go as user messages in Bedrock
                messages.push({
                    role: 'user',
                    content: [{ text: `Tool result: ${msg.content}` }],
                });
            }
        }

        // Ensure messages alternate (Bedrock requirement)
        const normalizedMessages = this.normalizeMessages(messages);

        const bedrockRequest: BedrockRequest = {
            modelId,
            messages: normalizedMessages,
        };

        if (systemMessages && systemMessages.length > 0) {
            bedrockRequest.system = systemMessages;
        }

        // Add inference config
        const inferenceConfig: NonNullable<BedrockRequest['inferenceConfig']> = {};
        if (request.temperature !== undefined || config.parameters.temperature !== undefined) {
            inferenceConfig.temperature = request.temperature ?? config.parameters.temperature;
        }
        if (request.maxTokens !== undefined) {
            inferenceConfig.maxTokens = request.maxTokens;
        } else if (config.parameters.maxTokens !== undefined) {
            inferenceConfig.maxTokens = config.parameters.maxTokens;
        }
        if (config.parameters.topP !== undefined) {
            inferenceConfig.topP = config.parameters.topP;
        }
        if (request.stopSequences && request.stopSequences.length > 0) {
            inferenceConfig.stopSequences = request.stopSequences;
        }
        if (Object.keys(inferenceConfig).length > 0) {
            bedrockRequest.inferenceConfig = inferenceConfig;
        }

        // Add tools if provided
        if (request.tools && request.tools.length > 0) {
            bedrockRequest.toolConfig = {
                tools: request.tools.map(tool => ({
                    toolSpec: {
                        name: tool.name,
                        description: tool.description,
                        inputSchema: {
                            json: tool.parameters,
                        },
                    },
                })),
            };
        }

        const body = JSON.stringify(bedrockRequest);

        try {
            const headers = await this.signRequest('POST', url, body, credential);

            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body,
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`Bedrock error [${response.status}]: ${errorBody}`);
                throw new LLMError(
                    `Bedrock API error: ${response.statusText}`,
                    'bedrock',
                    response.status,
                    response.status >= 500 || response.status === 429,
                );
            }

            const data = (await response.json()) as BedrockResponse;

            // Extract text content and tool calls
            let textContent = '';
            const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

            for (const block of data.output.message.content) {
                if (block.text) {
                    textContent += block.text;
                } else if (block.toolUse) {
                    toolCalls.push({
                        id: block.toolUse.toolUseId,
                        name: block.toolUse.name,
                        arguments: block.toolUse.input,
                    });
                }
            }

            // Map stop reason
            const finishReasonMap: Record<string, LLMResponse['finishReason']> = {
                end_turn: 'stop',
                max_tokens: 'length',
                stop_sequence: 'stop',
                tool_use: 'tool_calls',
            };

            return {
                content: textContent || null,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                finishReason: finishReasonMap[data.stopReason] ?? 'stop',
                usage: {
                    promptTokens: data.usage.inputTokens,
                    completionTokens: data.usage.outputTokens,
                    totalTokens: data.usage.totalTokens,
                },
                model: modelId,
            };
        } catch (error) {
            if (error instanceof LLMError) throw error;

            console.error(`Bedrock request failed:`, error);
            throw new LLMError(
                `Bedrock request failed: ${(error as Error).message}`,
                'bedrock',
                undefined,
                true,
            );
        }
    }

    async isAvailable(credentialJson: string | undefined): Promise<boolean> {
        if (!credentialJson) return false;

        try {
            const credential = this.parseCredential(credentialJson);
            // Simple validation of credential format
            return !!(credential.accessKeyId && credential.secretAccessKey && credential.region);
        } catch {
            return false;
        }
    }

    async listModels(_credentialJson: string): Promise<string[]> {
        // Return commonly available Bedrock models
        // In production, you'd call the Bedrock ListFoundationModels API
        return [
            // Amazon Nova models
            'amazon.nova-pro-v1:0',
            'amazon.nova-lite-v1:0',
            'amazon.nova-micro-v1:0',
            // Claude models on Bedrock
            'anthropic.claude-3-5-sonnet-20241022-v2:0',
            'anthropic.claude-3-5-haiku-20241022-v1:0',
            'anthropic.claude-3-opus-20240229-v1:0',
            'anthropic.claude-3-sonnet-20240229-v1:0',
            'anthropic.claude-3-haiku-20240307-v1:0',
            // Amazon Titan
            'amazon.titan-text-premier-v1:0',
            'amazon.titan-text-express-v1',
            'amazon.titan-text-lite-v1',
            // Meta Llama  
            'meta.llama3-2-90b-instruct-v1:0',
            'meta.llama3-2-11b-instruct-v1:0',
            'meta.llama3-2-3b-instruct-v1:0',
            'meta.llama3-2-1b-instruct-v1:0',
            // Mistral
            'mistral.mistral-large-2407-v1:0',
            'mistral.mistral-small-2402-v1:0',
        ];
    }

    /**
     * Normalize message order to ensure alternating user/assistant pattern
     */
    private normalizeMessages(messages: BedrockMessage[]): BedrockMessage[] {
        if (messages.length === 0) {
            return [{ role: 'user', content: [{ text: 'Hello' }] }];
        }

        const result: BedrockMessage[] = [];
        let lastRole: 'user' | 'assistant' | null = null;

        for (const msg of messages) {
            if (msg.role === lastRole) {
                // Merge consecutive same-role messages
                const prev = result[result.length - 1];
                if (prev) {
                    prev.content.push(...msg.content);
                }
            } else {
                result.push({ ...msg, content: [...msg.content] });
                lastRole = msg.role;
            }
        }

        // Ensure first message is from user
        const first = result[0];
        if (first && first.role !== 'user') {
            result.unshift({ role: 'user', content: [{ text: 'Continue.' }] });
        }

        return result;
    }
}
