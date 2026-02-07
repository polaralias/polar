/**
 * Provider Index
 * Factory for creating LLM provider adapters
 */

import type { LLMProviderAdapter } from './base.js';
import type { LLMProvider } from '../types.js';
import { LLM_PROVIDER_ENDPOINTS } from '../types.js';
import { OpenRouterProvider } from './openrouter.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';
import { AzureOpenAIProvider } from './azure-openai.js';
import { BedrockProvider } from './bedrock.js';
import { MistralProvider } from './mistral.js';
import { GeminiProvider } from './gemini.js';
import { MiniMaxProvider } from './minimax.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

// Singleton instances for all providers
const providers: Record<LLMProvider, LLMProviderAdapter> = {
    openrouter: new OpenRouterProvider(),
    openai: new OpenAIProvider(),
    anthropic: new AnthropicProvider(),
    gemini: new GeminiProvider(),
    minimax: new MiniMaxProvider(),
    mistral: new MistralProvider(),
    bedrock: new BedrockProvider(),
    'azure-openai': new AzureOpenAIProvider(),
    together: new OpenAICompatibleProvider({
        name: 'together',
        defaultBaseUrl: LLM_PROVIDER_ENDPOINTS.together,
        authType: 'bearer',
    }),
    groq: new OpenAICompatibleProvider({
        name: 'groq',
        defaultBaseUrl: LLM_PROVIDER_ENDPOINTS.groq,
        authType: 'bearer',
    }),
    deepseek: new OpenAICompatibleProvider({
        name: 'deepseek',
        defaultBaseUrl: LLM_PROVIDER_ENDPOINTS.deepseek,
        authType: 'bearer',
    }),
    siliconflow: new OpenAICompatibleProvider({
        name: 'siliconflow',
        defaultBaseUrl: LLM_PROVIDER_ENDPOINTS.siliconflow,
        authType: 'bearer',
    }),
    ollama: new OllamaProvider(),
    'lm-studio': new OpenAICompatibleProvider({
        name: 'lm-studio',
        defaultBaseUrl: LLM_PROVIDER_ENDPOINTS['lm-studio'],
        authType: 'none',
    }),
    localai: new OpenAICompatibleProvider({
        name: 'localai',
        defaultBaseUrl: LLM_PROVIDER_ENDPOINTS.localai,
        authType: 'none',
    }),
    vllm: new OpenAICompatibleProvider({
        name: 'vllm',
        defaultBaseUrl: LLM_PROVIDER_ENDPOINTS.vllm,
        authType: 'none',
    }),
    tgi: new OpenAICompatibleProvider({
        name: 'tgi',
        defaultBaseUrl: LLM_PROVIDER_ENDPOINTS.tgi,
        authType: 'none',
    }),
    sglang: new OpenAICompatibleProvider({
        name: 'sglang',
        defaultBaseUrl: LLM_PROVIDER_ENDPOINTS.sglang,
        authType: 'none',
    }),
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
