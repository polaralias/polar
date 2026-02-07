/**
 * Model Registry
 * Static model catalog used for UI defaults and provider fallback listings.
 */

import type { LLMProvider, ModelTier } from './types.js';

export type ModelTag = 'recommended' | 'agentic' | 'reasoning' | 'cheap';

export interface ModelCapabilities {
    chat: boolean;
    tools: boolean;
    vision?: boolean;
    audio?: boolean;
    reasoning?: boolean;
}

export interface ReasoningConfig {
    type: 'effort' | 'budgetTokens' | 'thinkingLevel' | 'thinkingBudget' | 'none';
    default?: string | number;
    values?: string[];
}

export interface ModelInfo {
    id: string;
    provider: LLMProvider;
    displayName: string;
    tier: 'flagship' | 'balanced' | 'efficient';
    capabilities: ModelCapabilities;
    reasoning?: ReasoningConfig;
    supportedParameters: {
        temperature?: boolean;
        topP?: boolean;
        maxTokens?: boolean;
        stopSequences?: boolean;
    };
    contextWindow?: number;
    deprecation?: {
        deprecated: boolean;
        deprecatedAt?: string;
        replacementId?: string;
        retirementDate?: string;
    };
    tags?: ModelTag[];
    notes?: string;
}

function withTierTags(model: ModelInfo): ModelInfo {
    const tags = new Set(model.tags ?? []);
    if (model.tier === 'efficient') {
        tags.add('cheap');
    }
    if (model.capabilities.reasoning) {
        tags.add('reasoning');
    }
    return tags.size > 0 ? { ...model, tags: Array.from(tags) } : model;
}

export const MODEL_REGISTRY: ModelInfo[] = [
    // Anthropic
    withTierTags({
        id: 'claude-opus-4-6',
        provider: 'anthropic',
        displayName: 'Claude Opus 4.6',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        reasoning: { type: 'budgetTokens', default: 10000 },
        supportedParameters: { temperature: true, topP: false, maxTokens: true, stopSequences: true },
        contextWindow: 200000,
        tags: ['recommended', 'agentic'],
    }),
    withTierTags({
        id: 'claude-sonnet-4-5',
        provider: 'anthropic',
        displayName: 'Claude Sonnet 4.5',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        reasoning: { type: 'budgetTokens', default: 5000 },
        supportedParameters: { temperature: true, topP: false, maxTokens: true, stopSequences: true },
        contextWindow: 200000,
        tags: ['recommended'],
    }),
    withTierTags({
        id: 'claude-haiku-4-5',
        provider: 'anthropic',
        displayName: 'Claude Haiku 4.5',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, vision: true },
        supportedParameters: { temperature: true, topP: false, maxTokens: true, stopSequences: true },
        contextWindow: 200000,
    }),

    // Anthropic legacy aliases kept for compatibility
    withTierTags({
        id: 'claude-opus-4.5',
        provider: 'anthropic',
        displayName: 'Claude Opus 4.5',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        supportedParameters: { temperature: true, topP: false, maxTokens: true, stopSequences: true },
        deprecation: { deprecated: true, replacementId: 'claude-opus-4-6' },
    }),
    withTierTags({
        id: 'claude-sonnet-4.5',
        provider: 'anthropic',
        displayName: 'Claude Sonnet 4.5 (Legacy ID)',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        supportedParameters: { temperature: true, topP: false, maxTokens: true, stopSequences: true },
        deprecation: { deprecated: true, replacementId: 'claude-sonnet-4-5' },
    }),
    withTierTags({
        id: 'claude-haiku-4.5',
        provider: 'anthropic',
        displayName: 'Claude Haiku 4.5 (Legacy ID)',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, vision: true },
        supportedParameters: { temperature: true, topP: false, maxTokens: true, stopSequences: true },
        deprecation: { deprecated: true, replacementId: 'claude-haiku-4-5' },
    }),

    // OpenAI
    withTierTags({
        id: 'gpt-5.2',
        provider: 'openai',
        displayName: 'GPT-5.2',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        reasoning: { type: 'effort', default: 'medium', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
        contextWindow: 128000,
        tags: ['recommended'],
    }),
    withTierTags({
        id: 'gpt-5-mini',
        provider: 'openai',
        displayName: 'GPT-5 Mini',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, vision: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
        contextWindow: 128000,
        tags: ['recommended'],
    }),
    withTierTags({
        id: 'gpt-5-nano',
        provider: 'openai',
        displayName: 'GPT-5 Nano',
        tier: 'efficient',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
        contextWindow: 32000,
        tags: ['recommended'],
    }),
    withTierTags({
        id: 'gpt-5.3-codex',
        provider: 'openai',
        displayName: 'GPT-5.3 Codex',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
        tags: ['agentic'],
    }),
    withTierTags({
        id: 'gpt-5.2-codex',
        provider: 'openai',
        displayName: 'GPT-5.2 Codex',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
        tags: ['agentic'],
    }),
    withTierTags({
        id: 'gpt-5.1',
        provider: 'openai',
        displayName: 'GPT-5.1',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
        contextWindow: 128000,
        tags: ['recommended'],
    }),
    withTierTags({
        id: 'gpt-5.1-codex',
        provider: 'openai',
        displayName: 'GPT-5.1 Codex',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
        tags: ['agentic'],
    }),
    withTierTags({
        id: 'gpt-5.1-codex-mini',
        provider: 'openai',
        displayName: 'GPT-5.1 Codex Mini',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
        tags: ['agentic'],
    }),
    withTierTags({
        id: 'gpt-5.1-codex-max',
        provider: 'openai',
        displayName: 'GPT-5.1 Codex Max',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
        tags: ['agentic'],
    }),
    withTierTags({
        id: 'computer-use-preview',
        provider: 'openai',
        displayName: 'Computer Use Preview',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
        tags: ['agentic'],
    }),
    withTierTags({
        id: 'gpt-5.2-pro',
        provider: 'openai',
        displayName: 'GPT-5.2 Pro',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
    }),

    // Gemini
    withTierTags({
        id: 'gemini-3-pro-preview-09-2026',
        provider: 'gemini',
        displayName: 'Gemini 3 Pro',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true, audio: true, reasoning: true },
        reasoning: { type: 'thinkingLevel', default: 'high', values: ['minimal', 'low', 'medium', 'high'] },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        contextWindow: 1000000,
        tags: ['recommended', 'agentic'],
    }),
    withTierTags({
        id: 'gemini-3-flash-preview-09-2026',
        provider: 'gemini',
        displayName: 'Gemini 3 Flash',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        reasoning: { type: 'thinkingLevel', default: 'medium', values: ['minimal', 'low', 'medium', 'high'] },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        contextWindow: 1000000,
        tags: ['recommended'],
    }),
    withTierTags({
        id: 'gemini-2.5-pro',
        provider: 'gemini',
        displayName: 'Gemini 2.5 Pro',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        contextWindow: 1000000,
    }),
    withTierTags({
        id: 'gemini-2.5-flash',
        provider: 'gemini',
        displayName: 'Gemini 2.5 Flash',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, vision: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        contextWindow: 1000000,
    }),

    // MiniMax
    withTierTags({
        id: 'M2',
        provider: 'minimax',
        displayName: 'MiniMax M2',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'M2-Pro',
        provider: 'minimax',
        displayName: 'MiniMax M2 Pro',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),

    // Mistral
    withTierTags({
        id: 'mistral-large-latest',
        provider: 'mistral',
        displayName: 'Mistral Large',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'mistral-small-latest',
        provider: 'mistral',
        displayName: 'Mistral Small',
        tier: 'efficient',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'codestral-latest',
        provider: 'mistral',
        displayName: 'Codestral',
        tier: 'balanced',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'magistral-medium-2506',
        provider: 'mistral',
        displayName: 'Magistral Medium',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'magistral-small-2506',
        provider: 'mistral',
        displayName: 'Magistral Small',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),

    // Bedrock
    withTierTags({
        id: 'amazon.nova-pro-v1:0',
        provider: 'bedrock',
        displayName: 'Amazon Nova Pro',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'amazon.nova-lite-v1:0',
        provider: 'bedrock',
        displayName: 'Amazon Nova Lite',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, vision: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'amazon.nova-micro-v1:0',
        provider: 'bedrock',
        displayName: 'Amazon Nova Micro',
        tier: 'efficient',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        provider: 'bedrock',
        displayName: 'Claude 3.5 Sonnet (Bedrock)',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),

    // Ollama local defaults
    withTierTags({
        id: 'llama3.3:latest',
        provider: 'ollama',
        displayName: 'Llama 3.3 8B',
        tier: 'efficient',
        capabilities: { chat: true, tools: false },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'llama3.3:70b',
        provider: 'ollama',
        displayName: 'Llama 3.3 70B',
        tier: 'flagship',
        capabilities: { chat: true, tools: false, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'qwen2.5:latest',
        provider: 'ollama',
        displayName: 'Qwen 2.5 7B',
        tier: 'efficient',
        capabilities: { chat: true, tools: false },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'qwen2.5:32b',
        provider: 'ollama',
        displayName: 'Qwen 2.5 32B',
        tier: 'balanced',
        capabilities: { chat: true, tools: false, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'deepseek-r1:latest',
        provider: 'ollama',
        displayName: 'DeepSeek R1',
        tier: 'balanced',
        capabilities: { chat: true, tools: false, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'codellama:latest',
        provider: 'ollama',
        displayName: 'Code Llama',
        tier: 'balanced',
        capabilities: { chat: true, tools: false },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'mistral:latest',
        provider: 'ollama',
        displayName: 'Mistral 7B',
        tier: 'efficient',
        capabilities: { chat: true, tools: false },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'phi3:latest',
        provider: 'ollama',
        displayName: 'Phi-3',
        tier: 'efficient',
        capabilities: { chat: true, tools: false },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),

    // Aggregation APIs
    withTierTags({
        id: 'anthropic/claude-sonnet-4-5',
        provider: 'openrouter',
        displayName: 'Claude Sonnet 4.5 (OpenRouter)',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        tags: ['recommended'],
    }),
    withTierTags({
        id: 'openai/gpt-5.2',
        provider: 'openrouter',
        displayName: 'GPT-5.2 (OpenRouter)',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'meta-llama/llama-3.3-70b-instruct',
        provider: 'openrouter',
        displayName: 'Llama 3.3 70B (OpenRouter)',
        tier: 'balanced',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'deepseek/deepseek-r1',
        provider: 'openrouter',
        displayName: 'DeepSeek R1 (OpenRouter)',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),

    withTierTags({
        id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        provider: 'together',
        displayName: 'Llama 3.3 70B Turbo (Together)',
        tier: 'balanced',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'Qwen/Qwen2.5-72B-Instruct-Turbo',
        provider: 'together',
        displayName: 'Qwen 2.5 72B Turbo (Together)',
        tier: 'balanced',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),

    withTierTags({
        id: 'openai/gpt-oss-120b',
        provider: 'groq',
        displayName: 'GPT-OSS 120B (Groq)',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'llama-3.3-70b-versatile',
        provider: 'groq',
        displayName: 'Llama 3.3 70B (Groq)',
        tier: 'balanced',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'mixtral-8x7b-32768',
        provider: 'groq',
        displayName: 'Mixtral 8x7B (Groq)',
        tier: 'efficient',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),

    withTierTags({
        id: 'deepseek-chat',
        provider: 'deepseek',
        displayName: 'DeepSeek Chat',
        tier: 'efficient',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'deepseek-reasoner',
        provider: 'deepseek',
        displayName: 'DeepSeek Reasoner',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
    }),

    withTierTags({
        id: 'Qwen/Qwen2.5-72B-Instruct',
        provider: 'siliconflow',
        displayName: 'Qwen 2.5 72B (SiliconFlow)',
        tier: 'balanced',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
    withTierTags({
        id: 'deepseek-ai/DeepSeek-V3',
        provider: 'siliconflow',
        displayName: 'DeepSeek V3 (SiliconFlow)',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    }),
];

export function getModelInfo(modelId: string): ModelInfo | undefined {
    return MODEL_REGISTRY.find(model => model.id === modelId);
}

export function getModelsForProvider(provider: LLMProvider): ModelInfo[] {
    return MODEL_REGISTRY.filter(model => model.provider === provider);
}

export function getModelsByTier(tier: ModelInfo['tier']): ModelInfo[] {
    return MODEL_REGISTRY.filter(model => model.tier === tier);
}

export function getReasoningModels(): ModelInfo[] {
    return MODEL_REGISTRY.filter(model => model.capabilities.reasoning);
}

export function getRecommendedModels(provider?: LLMProvider): ModelInfo[] {
    return MODEL_REGISTRY.filter(model =>
        model.tags?.includes('recommended') && (!provider || model.provider === provider),
    );
}

export function getAgenticModels(provider?: LLMProvider): ModelInfo[] {
    return MODEL_REGISTRY.filter(model =>
        model.tags?.includes('agentic') && (!provider || model.provider === provider),
    );
}

export function modelSupportsParameter(
    modelId: string,
    param: keyof ModelInfo['supportedParameters'],
): boolean {
    const model = getModelInfo(modelId);
    return model?.supportedParameters[param] ?? true;
}

export function isModelDeprecated(modelId: string): boolean {
    const model = getModelInfo(modelId);
    return model?.deprecation?.deprecated ?? false;
}

export function getReplacementModel(modelId: string): string | undefined {
    const model = getModelInfo(modelId);
    return model?.deprecation?.replacementId;
}

export function getTierMappedModels(provider: LLMProvider, tier: ModelTier): ModelInfo[] {
    const providerModels = getModelsForProvider(provider);

    const tierMap: Record<ModelTier, ModelInfo['tier'][]> = {
        cheap: ['efficient'],
        fast: ['efficient', 'balanced'],
        reasoning: ['flagship', 'balanced'],
        writing: ['flagship', 'balanced'],
        specialized: ['flagship'],
    };

    const targetTiers = tierMap[tier] || ['balanced'];
    return providerModels.filter(model => targetTiers.includes(model.tier));
}
