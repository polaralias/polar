/**
 * Provider Index
 * Factory for creating LLM provider adapters
 */

import type { LLMProviderAdapter } from './base.js';
import type { LLMProvider } from '../types.js';
import { OpenRouterProvider } from './openrouter.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';
import { AzureOpenAIProvider } from './azure-openai.js';
import { BedrockProvider } from './bedrock.js';
import { MistralProvider } from './mistral.js';
import { GeminiProvider } from './gemini.js';

// Singleton instances for all providers
const providers: Record<LLMProvider, LLMProviderAdapter> = {
    openrouter: new OpenRouterProvider(),
    anthropic: new AnthropicProvider(),
    ollama: new OllamaProvider(),
    openai: new OpenAIProvider(),
    'azure-openai': new AzureOpenAIProvider(),
    bedrock: new BedrockProvider(),
    mistral: new MistralProvider(),
    gemini: new GeminiProvider(),
};

/**
 * Get a provider adapter by name
 */
export function getProvider(provider: LLMProvider): LLMProviderAdapter {
    const adapter = providers[provider];
    if (!adapter) {
        throw new Error(`Unknown LLM provider: ${provider}`);
    }
    return adapter;
}

/**
 * Get all available providers
 */
export function getAllProviders(): LLMProviderAdapter[] {
    return Object.values(providers);
}

/**
 * Get provider names
 */
export function getProviderNames(): LLMProvider[] {
    return Object.keys(providers) as LLMProvider[];
}

/**
 * Check if a provider exists
 */
export function hasProvider(provider: string): provider is LLMProvider {
    return provider in providers;
}

export { type LLMProviderAdapter } from './base.js';
export { redactApiKey, createHeaders } from './base.js';
