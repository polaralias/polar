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

export const LLM_PROVIDERS = [
    'openrouter',
    'openai',
    'anthropic',
    'gemini',
    'minimax',
    'mistral',
    'bedrock',
    'azure-openai',
    'together',
    'groq',
    'deepseek',
    'siliconflow',
    'ollama',
    'lm-studio',
    'localai',
    'vllm',
    'tgi',
    'sglang',
] as const;

export const LLMProviderSchema = z.enum(LLM_PROVIDERS);
export type LLMProvider = z.infer<typeof LLMProviderSchema>;

// Provider display names for UI
export const LLM_PROVIDER_NAMES: Record<LLMProvider, string> = {
    openrouter: 'OpenRouter',
    openai: 'OpenAI',
    anthropic: 'Anthropic (Claude)',
    gemini: 'Google Gemini',
    minimax: 'MiniMax',
    mistral: 'Mistral AI',
    bedrock: 'Amazon Bedrock',
    'azure-openai': 'Azure OpenAI',
    together: 'Together AI',
    groq: 'Groq',
    deepseek: 'DeepSeek',
    siliconflow: 'SiliconFlow',
    ollama: 'Ollama',
    'lm-studio': 'LM Studio',
    localai: 'LocalAI',
    vllm: 'vLLM',
    tgi: 'Text Generation Inference',
    sglang: 'SGLang',
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
    modelId: 'anthropic/claude-sonnet-4-5',
    parameters: {
        temperature: 0.7,
        maxTokens: 4096,
    },
    tierModels: {
        // Default tier assignments using OpenRouter model format
        cheap: 'openrouter:openai/gpt-5-nano',
        fast: 'openrouter:anthropic/claude-haiku-4-5',
        reasoning: 'openrouter:openai/gpt-5.2',
        writing: 'openrouter:anthropic/claude-sonnet-4-5',
    },
    // Legacy compatibility
    subAgentModels: {
        fast: 'gpt-5-mini',
        reasoning: 'gpt-5.2',
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
export const LLM_PROVIDER_CREDENTIAL_TYPE: Record<LLMProvider, 'apiKey' | 'baseUrl' | 'json'> = {
    openrouter: 'apiKey',
    openai: 'apiKey',
    anthropic: 'apiKey',
    gemini: 'apiKey',
    minimax: 'apiKey',
    mistral: 'apiKey',
    bedrock: 'json',
    'azure-openai': 'json',
    together: 'apiKey',
    groq: 'apiKey',
    deepseek: 'apiKey',
    siliconflow: 'apiKey',
    ollama: 'baseUrl',
    'lm-studio': 'baseUrl',
    localai: 'baseUrl',
    vllm: 'baseUrl',
    tgi: 'baseUrl',
    sglang: 'baseUrl',
};

export const LLM_PROVIDER_REQUIRES_CREDENTIAL: Record<LLMProvider, boolean> = {
    openrouter: true,
    openai: true,
    anthropic: true,
    gemini: true,
    minimax: true,
    mistral: true,
    bedrock: true,
    'azure-openai': true,
    together: true,
    groq: true,
    deepseek: true,
    siliconflow: true,
    ollama: false,
    'lm-studio': false,
    localai: false,
    vllm: false,
    tgi: false,
    sglang: false,
};

export const LLM_CREDENTIAL_KEYS: Record<LLMProvider, string> = {
    openrouter: 'LLM_OPENROUTER_API_KEY',
    openai: 'LLM_OPENAI_API_KEY',
    anthropic: 'LLM_ANTHROPIC_API_KEY',
    gemini: 'LLM_GEMINI_API_KEY',
    minimax: 'LLM_MINIMAX_API_KEY',
    mistral: 'LLM_MISTRAL_API_KEY',
    bedrock: 'LLM_BEDROCK_CONFIG',
    'azure-openai': 'LLM_AZURE_OPENAI_CONFIG',
    together: 'LLM_TOGETHER_API_KEY',
    groq: 'LLM_GROQ_API_KEY',
    deepseek: 'LLM_DEEPSEEK_API_KEY',
    siliconflow: 'LLM_SILICONFLOW_API_KEY',
    ollama: 'LLM_OLLAMA_BASE_URL',
    'lm-studio': 'LLM_LM_STUDIO_BASE_URL',
    localai: 'LLM_LOCALAI_BASE_URL',
    vllm: 'LLM_VLLM_BASE_URL',
    tgi: 'LLM_TGI_BASE_URL',
    sglang: 'LLM_SGLANG_BASE_URL',
};

/**
 * Default API endpoints for each provider
 */
export const LLM_PROVIDER_ENDPOINTS: Record<LLMProvider, string> = {
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    openai: 'https://api.openai.com',
    anthropic: 'https://api.anthropic.com/v1/messages',
    gemini: 'https://generativelanguage.googleapis.com',
    minimax: 'https://api.minimaxi.com/v1',
    mistral: 'https://api.mistral.ai/v1/chat/completions',
    bedrock: '',
    'azure-openai': '',
    together: 'https://api.together.xyz/v1',
    groq: 'https://api.groq.com/openai/v1',
    deepseek: 'https://api.deepseek.com',
    siliconflow: 'https://api.siliconflow.com/v1',
    ollama: 'http://localhost:11434',
    'lm-studio': 'http://localhost:1234',
    localai: 'http://localhost:8080',
    vllm: 'http://localhost:8000',
    tgi: 'http://localhost:8080',
    sglang: 'http://localhost:30000',
};

/**
 * Suggested models per tier for each provider
 * Used in UI for helping users configure their model tiers
 */
export const SUGGESTED_TIER_MODELS: Record<LLMProvider, Partial<Record<ModelTier, string[]>>> = {
    openrouter: {
        cheap: ['openai/gpt-5-nano', 'anthropic/claude-haiku-4-5', 'google/gemini-3-flash-preview-09-2026'],
        fast: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-4-5'],
        reasoning: ['openai/gpt-5.2', 'anthropic/claude-opus-4-6', 'google/gemini-3-pro-preview-09-2026'],
        writing: ['anthropic/claude-sonnet-4-5', 'anthropic/claude-opus-4-6'],
    },
    openai: {
        cheap: ['gpt-5-nano'],
        fast: ['gpt-5-mini'],
        reasoning: ['gpt-5.2', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max'],
        writing: ['gpt-5.2', 'gpt-5.1'],
    },
    anthropic: {
        cheap: ['claude-haiku-4-5'],
        fast: ['claude-sonnet-4-5'],
        reasoning: ['claude-opus-4-6', 'claude-sonnet-4-5'],
        writing: ['claude-sonnet-4-5', 'claude-opus-4-6'],
    },
    gemini: {
        cheap: ['gemini-3-flash-preview-09-2026', 'gemini-2.5-flash'],
        fast: ['gemini-3-flash-preview-09-2026'],
        reasoning: ['gemini-3-pro-preview-09-2026', 'gemini-2.5-pro'],
        writing: ['gemini-3-pro-preview-09-2026'],
    },
    minimax: {
        cheap: ['M2'],
        fast: ['M2'],
        reasoning: ['M2-Pro', 'M2'],
        writing: ['M2-Pro'],
    },
    mistral: {
        cheap: ['mistral-small-latest'],
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
        cheap: ['gpt-5-nano'],
        fast: ['gpt-5-mini'],
        reasoning: ['gpt-5.2', 'gpt-5.1'],
        writing: ['gpt-5.2'],
    },
    together: {
        cheap: ['Qwen/Qwen2.5-72B-Instruct-Turbo'],
        fast: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
        reasoning: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
        writing: ['Qwen/Qwen2.5-72B-Instruct-Turbo'],
    },
    groq: {
        cheap: ['mixtral-8x7b-32768'],
        fast: ['llama-3.3-70b-versatile'],
        reasoning: ['openai/gpt-oss-120b'],
        writing: ['openai/gpt-oss-120b'],
    },
    deepseek: {
        cheap: ['deepseek-chat'],
        fast: ['deepseek-chat'],
        reasoning: ['deepseek-reasoner'],
        writing: ['deepseek-chat'],
    },
    siliconflow: {
        cheap: ['Qwen/Qwen2.5-72B-Instruct'],
        fast: ['Qwen/Qwen2.5-72B-Instruct'],
        reasoning: ['deepseek-ai/DeepSeek-V3'],
        writing: ['deepseek-ai/DeepSeek-V3'],
    },
    ollama: {
        cheap: ['phi3:latest', 'llama3.3:latest'],
        fast: ['qwen2.5:latest', 'mistral:latest'],
        reasoning: ['qwen2.5:32b', 'deepseek-r1:latest'],
        writing: ['llama3.3:70b', 'codellama:latest'],
    },
    'lm-studio': {
        cheap: ['phi3:latest'],
        fast: ['qwen2.5:latest'],
        reasoning: ['qwen2.5:32b'],
        writing: ['llama3.3:latest'],
    },
    localai: {
        cheap: ['phi3:latest'],
        fast: ['mistral:latest'],
        reasoning: ['deepseek-r1:latest'],
        writing: ['codellama:latest'],
    },
    vllm: {
        cheap: ['meta-llama/Llama-3.2-3B-Instruct'],
        fast: ['meta-llama/Llama-3.3-70B-Instruct'],
        reasoning: ['deepseek-ai/DeepSeek-V3'],
        writing: ['Qwen/Qwen2.5-72B-Instruct'],
    },
    tgi: {
        cheap: ['microsoft/Phi-3-mini-4k-instruct'],
        fast: ['mistralai/Mistral-7B-Instruct-v0.3'],
        reasoning: ['Qwen/Qwen2.5-72B-Instruct'],
        writing: ['Qwen/Qwen2.5-72B-Instruct'],
    },
    sglang: {
        cheap: ['microsoft/Phi-3-mini-4k-instruct'],
        fast: ['meta-llama/Llama-3.2-8B-Instruct'],
        reasoning: ['deepseek-ai/DeepSeek-R1'],
        writing: ['Qwen/Qwen2.5-72B-Instruct'],
    },
};
