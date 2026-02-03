/**
 * Model Registry
 * Dynamic registry for provider models with metadata
 * 
 * Per provider-alignment.md:
 * - Maintains model cards with capabilities, reasoning support, deprecation info
 * - Supports runtime discovery where available
 * - Provides fallback known models for providers without discovery API
 */

import type { LLMProvider, ModelTier } from './types.js';

// =============================================================================
// Model Registry Types
// =============================================================================

export interface ModelCapabilities {
    chat: boolean;
    tools: boolean;
    vision?: boolean;
    audio?: boolean;
    reasoning?: boolean;
}

export interface ReasoningConfig {
    /** Type of reasoning control */
    type: 'effort' | 'budgetTokens' | 'thinkingLevel' | 'thinkingBudget' | 'none';
    /** Default value if not specified */
    default?: string | number;
    /** Supported values (for enum types) */
    values?: string[];
}

export interface ModelInfo {
    /** Model identifier */
    id: string;
    /** Provider this model belongs to */
    provider: LLMProvider;
    /** Display name for UI */
    displayName: string;
    /** Model tier (flagship, balanced, efficient) */
    tier: 'flagship' | 'balanced' | 'efficient';
    /** Capabilities */
    capabilities: ModelCapabilities;
    /** Reasoning configuration if supported */
    reasoning?: ReasoningConfig;
    /** Supported parameters */
    supportedParameters: {
        temperature?: boolean;
        topP?: boolean;
        maxTokens?: boolean;
        stopSequences?: boolean;
    };
    /** Context window size in tokens */
    contextWindow?: number;
    /** Deprecation info */
    deprecation?: {
        deprecated: boolean;
        deprecatedAt?: string;
        replacementId?: string;
        retirementDate?: string;
    };
    /** Provider-specific notes */
    notes?: string;
}

// =============================================================================
// Known Model Registry
// =============================================================================

/**
 * Registry of known models with full metadata
 * Updated per provider-alignment.md
 */
export const MODEL_REGISTRY: ModelInfo[] = [
    // ==========================================================================
    // OpenAI GPT-5 Family
    // ==========================================================================
    {
        id: 'gpt-5.2',
        provider: 'openai',
        displayName: 'GPT-5.2',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        reasoning: { type: 'effort', default: 'medium', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        contextWindow: 128000,
        notes: 'Flagship model for coding and agentic tasks',
    },
    {
        id: 'gpt-5.2-pro',
        provider: 'openai',
        displayName: 'GPT-5.2 Pro',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        reasoning: { type: 'effort', default: 'high', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
        supportedParameters: { temperature: false, topP: false, maxTokens: true, stopSequences: true },
        contextWindow: 128000,
        notes: 'Pro reasoning variant - sampling controls restricted',
    },
    {
        id: 'gpt-5.1',
        provider: 'openai',
        displayName: 'GPT-5.1',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        reasoning: { type: 'effort', default: 'medium' },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        contextWindow: 128000,
    },
    {
        id: 'gpt-5-mini',
        provider: 'openai',
        displayName: 'GPT-5 Mini',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, vision: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        contextWindow: 128000,
    },
    {
        id: 'gpt-5-nano',
        provider: 'openai',
        displayName: 'GPT-5 Nano',
        tier: 'efficient',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        contextWindow: 16000,
        notes: 'Lowest cost option',
    },

    // ==========================================================================
    // Anthropic Claude 4.5 Family
    // ==========================================================================
    {
        id: 'claude-opus-4.5',
        provider: 'anthropic',
        displayName: 'Claude Opus 4.5',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        reasoning: { type: 'budgetTokens', default: 10000 },
        supportedParameters: { temperature: true, topP: false, maxTokens: true, stopSequences: true },
        contextWindow: 200000,
        notes: 'Highest capability Claude model',
    },
    {
        id: 'claude-sonnet-4.5',
        provider: 'anthropic',
        displayName: 'Claude Sonnet 4.5',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, vision: true, reasoning: true },
        reasoning: { type: 'budgetTokens', default: 5000 },
        supportedParameters: { temperature: true, topP: false, maxTokens: true, stopSequences: true },
        contextWindow: 200000,
        notes: 'Balanced model, strong for agents/coding',
    },
    {
        id: 'claude-haiku-4.5',
        provider: 'anthropic',
        displayName: 'Claude Haiku 4.5',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, vision: true },
        supportedParameters: { temperature: true, topP: false, maxTokens: true, stopSequences: true },
        contextWindow: 200000,
        notes: 'Fastest/cost-efficient',
    },

    // ==========================================================================
    // Google Gemini 3 Family
    // ==========================================================================
    {
        id: 'gemini-3-pro-preview',
        provider: 'gemini',
        displayName: 'Gemini 3 Pro (Preview)',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true, audio: true, reasoning: true },
        reasoning: { type: 'thinkingLevel', default: 'high', values: ['minimal', 'low', 'medium', 'high'] },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        contextWindow: 1000000,
        notes: 'Preview suffix may change when GA',
    },
    {
        id: 'gemini-3-flash-preview',
        provider: 'gemini',
        displayName: 'Gemini 3 Flash (Preview)',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, vision: true },
        reasoning: { type: 'thinkingLevel', default: 'medium', values: ['minimal', 'low', 'medium', 'high'] },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        contextWindow: 1000000,
        notes: 'Fast and efficient',
    },

    // ==========================================================================
    // Mistral Magistral Series (Reasoning)
    // ==========================================================================
    {
        id: 'magistral-medium-2506',
        provider: 'mistral',
        displayName: 'Magistral Medium',
        tier: 'balanced',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        notes: 'Reasoning-focused, has retirement timeline',
    },
    {
        id: 'magistral-small-2506',
        provider: 'mistral',
        displayName: 'Magistral Small',
        tier: 'efficient',
        capabilities: { chat: true, tools: true, reasoning: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        notes: 'Compact reasoning model',
    },
    {
        id: 'mistral-large-latest',
        provider: 'mistral',
        displayName: 'Mistral Large',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    },

    // ==========================================================================
    // Amazon Bedrock
    // ==========================================================================
    {
        id: 'amazon.nova-pro-v1:0',
        provider: 'bedrock',
        displayName: 'Amazon Nova Pro',
        tier: 'flagship',
        capabilities: { chat: true, tools: true, vision: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        notes: 'Region-dependent availability',
    },
    {
        id: 'amazon.nova-lite-v1:0',
        provider: 'bedrock',
        displayName: 'Amazon Nova Lite',
        tier: 'efficient',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
    },
    {
        id: 'amazon.nova-micro-v1:0',
        provider: 'bedrock',
        displayName: 'Amazon Nova Micro',
        tier: 'efficient',
        capabilities: { chat: true, tools: true },
        supportedParameters: { temperature: true, topP: true, maxTokens: true, stopSequences: true },
        notes: 'Lowest cost Bedrock option',
    },
];

// =============================================================================
// Registry Functions
// =============================================================================

/**
 * Get model info by ID
 */
export function getModelInfo(modelId: string): ModelInfo | undefined {
    return MODEL_REGISTRY.find(m => m.id === modelId);
}

/**
 * Get models for a specific provider
 */
export function getModelsForProvider(provider: LLMProvider): ModelInfo[] {
    return MODEL_REGISTRY.filter(m => m.provider === provider);
}

/**
 * Get models by tier
 */
export function getModelsByTier(tier: ModelInfo['tier']): ModelInfo[] {
    return MODEL_REGISTRY.filter(m => m.tier === tier);
}

/**
 * Get models with reasoning support
 */
export function getReasoningModels(): ModelInfo[] {
    return MODEL_REGISTRY.filter(m => m.capabilities.reasoning);
}

/**
 * Check if a model supports a specific parameter
 */
export function modelSupportsParameter(
    modelId: string,
    param: keyof ModelInfo['supportedParameters'],
): boolean {
    const model = getModelInfo(modelId);
    return model?.supportedParameters[param] ?? true; // Default to allowing if unknown
}

/**
 * Check if a model is deprecated
 */
export function isModelDeprecated(modelId: string): boolean {
    const model = getModelInfo(modelId);
    return model?.deprecation?.deprecated ?? false;
}

/**
 * Get replacement for a deprecated model
 */
export function getReplacementModel(modelId: string): string | undefined {
    const model = getModelInfo(modelId);
    return model?.deprecation?.replacementId;
}

/**
 * Map our tier names to registry tiers
 */
export function getTierMappedModels(provider: LLMProvider, tier: ModelTier): ModelInfo[] {
    const providerModels = getModelsForProvider(provider);

    // Map our tier to registry tier
    const tierMap: Record<ModelTier, ModelInfo['tier'][]> = {
        cheap: ['efficient'],
        fast: ['efficient', 'balanced'],
        reasoning: ['flagship', 'balanced'],
        writing: ['flagship', 'balanced'],
        specialized: ['flagship'],
    };

    const targetTiers = tierMap[tier] || ['balanced'];
    return providerModels.filter(m => targetTiers.includes(m.tier));
}
