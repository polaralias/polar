/**
 * Base LLM Provider Interface
 * Abstract interface that all providers must implement
 */

import type { LLMRequest, LLMResponse, LLMConfig } from '../types.js';

export interface LLMProviderAdapter {
    /** Provider identifier */
    readonly name: string;

    /**
     * Send a chat completion request to the LLM
     * @param request The LLM request
     * @param apiKey The API key or credentials
     * @param config The LLM configuration
     * @returns The LLM response
     */
    chat(request: LLMRequest, apiKey: string, config: LLMConfig): Promise<LLMResponse>;

    /**
     * Check if the provider is available/configured
     * @param apiKey The API key or credentials
     * @returns true if the provider can be used
     */
    isAvailable(apiKey: string | undefined): Promise<boolean>;

    /**
     * List available models from this provider
     * @param apiKey The API key or credentials
     * @returns Array of model IDs
     */
    listModels?(apiKey: string): Promise<string[]>;
}

/**
 * Redact API key from logs - replaces all but the last 4 characters
 */
export function redactApiKey(key: string | undefined): string {
    if (!key || key.length < 8) return '***';
    return `***${key.slice(-4)}`;
}

/**
 * Common headers for LLM API requests
 */
export function createHeaders(apiKey: string, additionalHeaders?: Record<string, string>): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...additionalHeaders,
    };
}
