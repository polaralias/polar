/**
 * LLM Brain - Types and Schemas
 * Core type definitions for the LLM integration layer
 * 
 * Supports:
 * - Multiple providers simultaneously
 * - Model tiers (cheap, fast, reasoning, specialized)
 * - Task-to-model pinning for sub-agents
 */

import { z } from 'zod';

// =============================================================================
// Provider Definitions
// =============================================================================

export const LLMProviderSchema = z.enum([
    'openrouter',
    'anthropic',
    'ollama',
    'openai',
    'azure-openai',
    'bedrock',
    'mistral',
    'gemini',
]);
export type LLMProvider = z.infer<typeof LLMProviderSchema>;

// Provider display names for UI
export const LLM_PROVIDER_NAMES: Record<LLMProvider, string> = {
    openrouter: 'OpenRouter',
    anthropic: 'Anthropic (Claude)',
    ollama: 'Ollama (Local)',
    openai: 'OpenAI',
    'azure-openai': 'Azure OpenAI',
    bedrock: 'Amazon Bedrock',
    mistral: 'Mistral AI',
    gemini: 'Google Gemini',
};

// =============================================================================
// Model Tiers - Used for Pinning
// =============================================================================

/**
 * Model tiers define performance/cost categories:
 * - cheap: Lowest cost, used for simple classification tasks (intent classifier, entity extraction)
 * - fast: Low latency, lightweight tasks (summarization, quick lookups)
 * - reasoning: High-quality reasoning for complex tasks (main agent, planning)
 * - writing: Content creation (emails, documents, LinkedIn posts, creative writing)
 * - specialized: Task-specific models (code generation, web search, etc.)
 */
export const ModelTierSchema = z.enum(['cheap', 'fast', 'reasoning', 'writing', 'specialized']);
export type ModelTier = z.infer<typeof ModelTierSchema>;

// Legacy model hint (for backwards compatibility)
export const ModelHintSchema = z.enum(['fast', 'reasoning']);
export type ModelHint = z.infer<typeof ModelHintSchema>;

// =============================================================================
// Provider Configuration (per-provider settings)
// =============================================================================

/**
 * Configuration for a single LLM provider
 */
export const ProviderConfigSchema = z.object({
    /** Whether this provider is enabled */
    enabled: z.boolean().default(true),
    /** The provider type */
    provider: LLMProviderSchema,
    /** Default model for this provider */
    defaultModel: z.string().min(1),
    /** Model assignments by tier */
    tierModels: z.object({
        /** Cheapest model for simple tasks (e.g., gpt-4o-mini, claude-3-haiku) */
        cheap: z.string().optional(),
        /** Fast model for quick responses */
        fast: z.string().optional(),
        /** High-quality reasoning model */
        reasoning: z.string().optional(),
        /** Content creation model for emails, docs, posts */
        writing: z.string().optional(),
        /** Specialized models by task type */
        specialized: z.record(z.string()).optional(),
    }).optional(),
    /** Default parameters for this provider */
    parameters: z.object({
        temperature: z.number().min(0).max(2).default(0.7),
        maxTokens: z.number().int().positive().optional(),
        topP: z.number().min(0).max(1).optional(),
    }).optional(),
    /** Reasoning controls - provider-specific */
    reasoning: z.object({
        /** OpenAI: reasoning effort level */
        effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
        /** Anthropic: extended thinking budget in tokens */
        budgetTokens: z.number().int().positive().optional(),
        /** Gemini: thinking level (Gemini 3+) */
        thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
        /** Gemini: thinking budget in tokens (Gemini 2.5) */
        thinkingBudget: z.number().int().positive().optional(),
    }).optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// =============================================================================
// Main LLM Configuration
// =============================================================================

/**
 * Complete LLM configuration with multi-provider support
 */
export const LLMConfigSchema = z.object({
    /** Primary provider for general use */
    provider: LLMProviderSchema,
    /** Primary model ID */
    modelId: z.string().min(1),
    /** Default parameters */
    parameters: z.object({
        temperature: z.number().min(0).max(2).default(0.7),
        maxTokens: z.number().int().positive().optional(),
        topP: z.number().min(0).max(1).optional(),
    }),

    /**
     * Per-provider configurations
     * Allows configuring multiple providers with their own credentials and models
     */
    providers: z.record(LLMProviderSchema, ProviderConfigSchema).optional(),

    /**
     * Task routing - maps specific task types to providers
     * Allows using different providers for different purposes
     * e.g., { 'web_search': 'openai', 'code_generation': 'anthropic' }
     */
    taskRouting: z.record(z.string(), LLMProviderSchema).optional(),

    /**
     * Global tier models - used when per-provider tiers aren't specified
     * The key is the tier, value is "provider:model" format
     */
    tierModels: z.object({
        cheap: z.string().optional(),     // e.g., "openai:gpt-4o-mini"
        fast: z.string().optional(),      // e.g., "anthropic:claude-3-haiku"
        reasoning: z.string().optional(), // e.g., "anthropic:claude-3-5-sonnet"
        writing: z.string().optional(),   // e.g., "anthropic:claude-3-5-sonnet" (great for writing)
    }).optional(),

    // Legacy: Sub-agent model overrides (deprecated, use tierModels instead)
    subAgentModels: z.object({
        fast: z.string().optional(),
        reasoning: z.string().optional(),
    }).optional(),
});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_LLM_CONFIG: LLMConfig = {
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4.5',
    parameters: {
        temperature: 0.7,
        maxTokens: 4096,
    },
    tierModels: {
        // Default tier assignments using OpenRouter model format
        // Updated to align with provider-alignment.md
        cheap: 'openrouter:openai/gpt-5-nano',
        fast: 'openrouter:anthropic/claude-haiku-4.5',
        reasoning: 'openrouter:anthropic/claude-sonnet-4.5',
        writing: 'openrouter:anthropic/claude-sonnet-4.5', // Claude excels at writing
    },
    // Legacy support
    subAgentModels: {
        fast: 'openai/gpt-5-mini',
        reasoning: 'anthropic/claude-sonnet-4.5',
    },
};

// =============================================================================
// Message Types
// =============================================================================

export const LLMMessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type LLMMessageRole = z.infer<typeof LLMMessageRoleSchema>;

export const LLMMessageSchema = z.object({
    role: LLMMessageRoleSchema,
    content: z.string(),
    name: z.string().optional(), // For tool responses
});

export type LLMMessage = z.infer<typeof LLMMessageSchema>;

// =============================================================================
// Tool Definitions
// =============================================================================

export const LLMToolSchema = z.object({
    name: z.string().min(1),
    description: z.string(),
    parameters: z.record(z.unknown()),
});

export type LLMTool = z.infer<typeof LLMToolSchema>;

// =============================================================================
// Request/Response Types
// =============================================================================

export const LLMRequestSchema = z.object({
    messages: z.array(LLMMessageSchema),
    tools: z.array(LLMToolSchema).optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional(),
    stopSequences: z.array(z.string()).optional(),
    modelOverride: z.string().optional(), // Override the default model
});

export type LLMRequest = z.infer<typeof LLMRequestSchema>;

export const LLMToolCallSchema = z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.unknown()),
});

export type LLMToolCall = z.infer<typeof LLMToolCallSchema>;

export const LLMResponseSchema = z.object({
    content: z.string().nullable(),
    toolCalls: z.array(LLMToolCallSchema).optional(),
    finishReason: z.enum(['stop', 'length', 'tool_calls', 'content_filter', 'error']),
    usage: z.object({
        promptTokens: z.number(),
        completionTokens: z.number(),
        totalTokens: z.number(),
    }).optional(),
    model: z.string().optional(),
    provider: LLMProviderSchema.optional(), // Which provider handled this request
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// =============================================================================
// Sub-Agent Request Types
// =============================================================================

export const IntentClassifierRequestSchema = z.object({
    agent_id: z.literal('intent_classifier_v1'),
    payload: z.object({
        proposal_context: z.string(),
        user_message: z.string(),
    }),
    model_hint: ModelHintSchema,
});

export type IntentClassifierRequest = z.infer<typeof IntentClassifierRequestSchema>;

export const IntentClassifierResponseSchema = z.object({
    approved: z.boolean(),
    confidence: z.number().min(0).max(1),
});

export type IntentClassifierResponse = z.infer<typeof IntentClassifierResponseSchema>;

export const SummarizerRequestSchema = z.object({
    agent_id: z.literal('summarizer_v1'),
    payload: z.object({
        messages: z.array(LLMMessageSchema),
    }),
    model_hint: ModelHintSchema,
});

export type SummarizerRequest = z.infer<typeof SummarizerRequestSchema>;

export const SummarizerResponseSchema = z.object({
    summary: z.string(),
    keyFacts: z.array(z.string()).optional(),
    tokensSaved: z.number().optional(),
});

export type SummarizerResponse = z.infer<typeof SummarizerResponseSchema>;

// =============================================================================
// Error Type
// =============================================================================

export class LLMError extends Error {
    constructor(
        message: string,
        public readonly provider: LLMProvider | string,
        public readonly statusCode?: number,
        public readonly retryable: boolean = false,
    ) {
        super(message);
        this.name = 'LLMError';
    }
}

// =============================================================================
// Provider Configuration Constants
// =============================================================================

/**
 * Credential keys for each provider
 * These are the keys used in the secrets store
 */
export const LLM_CREDENTIAL_KEYS: Record<LLMProvider, string> = {
    openrouter: 'LLM_OPENROUTER_API_KEY',
    anthropic: 'LLM_ANTHROPIC_API_KEY',
    ollama: 'LLM_OLLAMA_BASE_URL', // Ollama uses base URL, not API key
    openai: 'LLM_OPENAI_API_KEY',
    'azure-openai': 'LLM_AZURE_OPENAI_CONFIG', // JSON with endpoint, key, apiVersion
    bedrock: 'LLM_BEDROCK_CONFIG', // JSON with AWS credentials
    mistral: 'LLM_MISTRAL_API_KEY',
    gemini: 'LLM_GEMINI_API_KEY',
};

/**
 * Default API endpoints for each provider
 */
export const LLM_PROVIDER_ENDPOINTS: Record<LLMProvider, string> = {
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    anthropic: 'https://api.anthropic.com/v1/messages',
    ollama: 'http://localhost:11434/api/chat',
    openai: 'https://api.openai.com/v1/chat/completions',
    'azure-openai': '', // Dynamic based on config
    bedrock: '', // Dynamic based on region
    mistral: 'https://api.mistral.ai/v1/chat/completions',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
};

/**
 * Suggested models per tier for each provider
 * Used in UI for helping users configure their model tiers
 */
export const SUGGESTED_TIER_MODELS: Record<LLMProvider, Partial<Record<ModelTier, string[]>>> = {
    openrouter: {
        cheap: ['openai/gpt-5-nano', 'google/gemini-3-flash-preview'],
        fast: ['anthropic/claude-haiku-4.5', 'openai/gpt-5-mini'],
        reasoning: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5.2', 'anthropic/claude-opus-4.5'],
        writing: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5.2', 'google/gemini-3-pro-preview'],
    },
    openai: {
        // GPT-5 family per provider-alignment.md
        cheap: ['gpt-5-nano'],
        fast: ['gpt-5-mini'],
        reasoning: ['gpt-5.2', 'gpt-5.2-pro', 'gpt-5.1'],
        writing: ['gpt-5.2', 'gpt-5.1'],
    },
    anthropic: {
        // Claude 4.5 family per provider-alignment.md
        cheap: ['claude-haiku-4.5'],
        fast: ['claude-haiku-4.5'],
        reasoning: ['claude-sonnet-4.5', 'claude-opus-4.5'],
        writing: ['claude-sonnet-4.5', 'claude-opus-4.5'], // Claude excels at writing
    },
    gemini: {
        // Gemini 3 family per provider-alignment.md
        cheap: ['gemini-3-flash-preview'],
        fast: ['gemini-3-flash-preview'],
        reasoning: ['gemini-3-pro-preview'],
        writing: ['gemini-3-pro-preview'],
    },
    mistral: {
        // Magistral series for reasoning per provider-alignment.md
        cheap: ['open-mistral-7b', 'open-mixtral-8x7b'],
        fast: ['mistral-small-latest'],
        reasoning: ['magistral-medium-2506', 'magistral-small-2506', 'mistral-large-latest'],
        writing: ['mistral-large-latest'],
    },
    bedrock: {
        cheap: ['amazon.nova-micro-v1:0', 'amazon.nova-lite-v1:0'],
        fast: ['amazon.nova-lite-v1:0', 'anthropic.claude-3-haiku-20240307-v1:0'],
        reasoning: ['amazon.nova-pro-v1:0', 'anthropic.claude-3-5-sonnet-20241022-v2:0'],
        writing: ['anthropic.claude-3-5-sonnet-20241022-v2:0', 'amazon.nova-pro-v1:0'],
    },
    'azure-openai': {
        // Azure uses deployment names, so these are suggestions
        cheap: ['gpt-5-nano'],
        fast: ['gpt-5-mini'],
        reasoning: ['gpt-5.2', 'gpt-5.1'],
        writing: ['gpt-5.2'],
    },
    ollama: {
        cheap: ['llama3.2:1b', 'phi3:mini'],
        fast: ['llama3.2:3b', 'mistral:7b'],
        reasoning: ['llama3.2:90b', 'mixtral:8x7b'],
        writing: ['llama3.2:90b', 'mixtral:8x7b'],
    },
};
