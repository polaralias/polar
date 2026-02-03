/**
 * LLM Service
 * Main orchestration layer for LLM interactions
 * 
 * Supports:
 * - Multiple providers simultaneously
 * - Model tier pinning (cheap, fast, reasoning, specialized)
 * - Task-based routing to different providers
 * - Credential management per provider
 */

import crypto from 'node:crypto';
import { getSecret } from '../secretsService.js';
import { appendAudit } from '../audit.js';
import { loadLLMConfig, saveLLMConfig } from './configStore.js';
import { getProvider, redactApiKey } from './providers/index.js';
import {
    LLMConfig,
    LLMRequest,
    LLMResponse,
    LLMError,
    LLMProvider,
    LLM_CREDENTIAL_KEYS,
    ModelHint,
    ModelTier,
} from './types.js';

// =============================================================================
// Types
// =============================================================================

export interface LLMServiceOptions {
    /** Override the model to use */
    modelOverride?: string;
    /** Override the provider to use */
    providerOverride?: LLMProvider;
    /** 
     * Use a specific model tier - FORCES the model selection
     * 'cheap' - use the cheapest model (for simple classification)
     * 'fast' - use a fast model (for quick tasks)
     * 'reasoning' - use a high-quality reasoning model
     */
    tier?: ModelTier;
    /** Legacy: Use a specific model hint for sub-agent routing */
    modelHint?: ModelHint;
    /** Task type for provider routing */
    taskType?: string;
    /** Session ID for audit logging */
    sessionId?: string;
    /** Agent ID for audit logging */
    agentId?: string;
}

interface ResolvedRoute {
    provider: LLMProvider;
    model: string;
    credential: string;
}

// =============================================================================
// LLM Service
// =============================================================================

/**
 * Main LLM Service class
 * Provides a unified interface for all LLM interactions
 */
export class LLMService {
    private static instance: LLMService | null = null;

    private constructor() { }

    static getInstance(): LLMService {
        if (!LLMService.instance) {
            LLMService.instance = new LLMService();
        }
        return LLMService.instance;
    }

    // =========================================================================
    // Credential Management
    // =========================================================================

    /**
     * Get the credential for a specific provider
     */
    private async getCredentialForProvider(provider: LLMProvider): Promise<string | undefined> {
        const key = LLM_CREDENTIAL_KEYS[provider];
        return getSecret(key);
    }

    /**
     * Get the credential for the current config's primary provider
     */
    private async getCredential(config: LLMConfig): Promise<string | undefined> {
        return this.getCredentialForProvider(config.provider);
    }

    // =========================================================================
    // Model Resolution (with Tier Pinning)
    // =========================================================================

    /**
     * Resolve the complete route (provider + model) based on options and config
     * 
     * Priority order:
     * 1. Explicit overrides (modelOverride, providerOverride)
     * 2. Tier pinning (forces specific model based on user's tier config)
     * 3. Task routing (maps task types to specific providers)
     * 4. Legacy modelHint
     * 5. Default model
     */
    private async resolveRoute(
        config: LLMConfig,
        options?: LLMServiceOptions,
    ): Promise<ResolvedRoute> {
        let provider = config.provider;
        let model = config.modelId;

        // 1. Explicit provider override
        if (options?.providerOverride) {
            provider = options.providerOverride;
        }

        // 2. Task-based routing
        if (options?.taskType && config.taskRouting) {
            const routedProvider = config.taskRouting[options.taskType];
            if (routedProvider) {
                provider = routedProvider;
                // Get default model for that provider
                const providerConfig = config.providers?.[provider];
                if (providerConfig?.defaultModel) {
                    model = providerConfig.defaultModel;
                }
            }
        }

        // 3. Tier pinning (MOST IMPORTANT for sub-agents)
        if (options?.tier) {
            const tierRoute = this.resolveTierModel(config, options.tier, provider);
            if (tierRoute) {
                provider = tierRoute.provider;
                model = tierRoute.model;
            }
        }

        // 4. Legacy model hint (fallback to tier)
        if (!options?.tier && options?.modelHint) {
            // Map legacy hints to tiers
            const tierMap: Record<ModelHint, ModelTier> = {
                fast: 'fast',
                reasoning: 'reasoning',
            };
            const tier = tierMap[options.modelHint];
            const tierRoute = this.resolveTierModel(config, tier, provider);
            if (tierRoute) {
                provider = tierRoute.provider;
                model = tierRoute.model;
            }
        }

        // 5. Explicit model override (always wins)
        if (options?.modelOverride) {
            model = options.modelOverride;
        }

        // Get credential for the resolved provider
        const credential = await this.getCredentialForProvider(provider);
        if (!credential) {
            throw new LLMError(
                `No API key configured for provider: ${provider}. Please set the key in Settings > Intelligence.`,
                provider,
            );
        }

        return { provider, model, credential };
    }

    /**
     * Resolve the model for a specific tier
     * 
     * Priority:
     * 1. Per-provider tier models
     * 2. Global tier models (format: "provider:model")
     * 3. Legacy subAgentModels
     */
    private resolveTierModel(
        config: LLMConfig,
        tier: ModelTier,
        currentProvider: LLMProvider,
    ): { provider: LLMProvider; model: string } | null {
        // Check per-provider tier configuration
        const providerConfig = config.providers?.[currentProvider];
        if (providerConfig?.tierModels?.[tier]) {
            return {
                provider: currentProvider,
                model: providerConfig.tierModels[tier] as string,
            };
        }

        // Check global tier models (format: "provider:model")
        const globalTierModel = config.tierModels?.[tier as 'cheap' | 'fast' | 'reasoning'];
        if (globalTierModel) {
            const [tierProvider, tierModel] = this.parseTierModelString(globalTierModel);
            return {
                provider: tierProvider || currentProvider,
                model: tierModel,
            };
        }

        // Legacy subAgentModels support
        if (tier === 'fast' || tier === 'reasoning') {
            const legacyModel = config.subAgentModels?.[tier];
            if (legacyModel) {
                return {
                    provider: currentProvider,
                    model: legacyModel,
                };
            }
        }

        return null;
    }

    /**
     * Parse a tier model string in format "provider:model" or just "model"
     */
    private parseTierModelString(tierString: string): [LLMProvider | null, string] {
        const colonIndex = tierString.indexOf(':');
        if (colonIndex === -1) {
            return [null, tierString];
        }
        const provider = tierString.substring(0, colonIndex) as LLMProvider;
        const model = tierString.substring(colonIndex + 1);
        return [provider, model];
    }

    // =========================================================================
    // Chat 
    // =========================================================================

    /**
     * Send a chat completion request
     */
    async chat(request: LLMRequest, options?: LLMServiceOptions): Promise<LLMResponse> {
        const config = await loadLLMConfig();
        const route = await this.resolveRoute(config, options);

        const provider = getProvider(route.provider);

        // Log the request (without sensitive data)
        console.log(
            `[LLM] ${route.provider}/${route.model} - ${request.messages.length} messages, ` +
            `tools: ${request.tools?.length ?? 0}, tier: ${options?.tier || 'default'}, ` +
            `key: ${redactApiKey(route.credential)}`,
        );

        const startTime = Date.now();

        try {
            const response = await provider.chat(
                { ...request, modelOverride: route.model },
                route.credential,
                { ...config, provider: route.provider, modelId: route.model },
            );

            const durationMs = Date.now() - startTime;

            // Audit successful call
            await appendAudit({
                id: crypto.randomUUID(),
                time: new Date().toISOString(),
                subject: options?.agentId || 'llm-service',
                action: 'llm.chat',
                decision: 'allow',
                resource: { type: 'system', component: 'llm' },
                sessionId: options?.sessionId,
                agentId: options?.agentId,
                metadata: {
                    provider: route.provider,
                    model: route.model,
                    tier: options?.tier,
                    taskType: options?.taskType,
                    messageCount: request.messages.length,
                    toolCount: request.tools?.length ?? 0,
                    finishReason: response.finishReason,
                    promptTokens: response.usage?.promptTokens,
                    completionTokens: response.usage?.completionTokens,
                    durationMs,
                },
            });

            return {
                ...response,
                provider: route.provider,
            };
        } catch (error) {
            const durationMs = Date.now() - startTime;

            // Audit failed call
            await appendAudit({
                id: crypto.randomUUID(),
                time: new Date().toISOString(),
                subject: options?.agentId || 'llm-service',
                action: 'llm.chat',
                decision: 'deny',
                reason: (error as Error).message,
                resource: { type: 'system', component: 'llm' },
                sessionId: options?.sessionId,
                agentId: options?.agentId,
                metadata: {
                    provider: route.provider,
                    model: route.model,
                    tier: options?.tier,
                    messageCount: request.messages.length,
                    durationMs,
                    error: (error as Error).message,
                },
            });

            throw error;
        }
    }

    /**
     * Send a chat request with forced tier pinning
     * This is the preferred method for sub-agents
     */
    async chatWithTier(
        request: LLMRequest,
        tier: ModelTier,
        options?: Omit<LLMServiceOptions, 'tier'>,
    ): Promise<LLMResponse> {
        return this.chat(request, { ...options, tier });
    }

    /**
     * Send a chat request for a specific task type
     * Provider will be determined by task routing configuration
     */
    async chatForTask(
        request: LLMRequest,
        taskType: string,
        options?: Omit<LLMServiceOptions, 'taskType'>,
    ): Promise<LLMResponse> {
        return this.chat(request, { ...options, taskType });
    }

    // =========================================================================
    // Configuration & Status
    // =========================================================================

    /**
     * Check if the current configuration is valid and provider is available
     */
    async isConfigured(): Promise<{ configured: boolean; provider: string; model: string; error?: string }> {
        const config = await loadLLMConfig();
        const credential = await this.getCredential(config);

        if (!credential) {
            return {
                configured: false,
                provider: config.provider,
                model: config.modelId,
                error: `No API key set for ${config.provider}`,
            };
        }

        const provider = getProvider(config.provider);
        const available = await provider.isAvailable(credential);

        if (available) {
            return {
                configured: true,
                provider: config.provider,
                model: config.modelId,
            };
        }

        return {
            configured: false,
            provider: config.provider,
            model: config.modelId,
            error: `Provider ${config.provider} is not available`,
        };
    }

    /**
     * Check the status of all configured providers
     */
    async getProviderStatuses(): Promise<Record<LLMProvider, { available: boolean; hasCredential: boolean }>> {
        const config = await loadLLMConfig();
        const providers = Object.keys(LLM_CREDENTIAL_KEYS) as LLMProvider[];
        const statuses: Record<string, { available: boolean; hasCredential: boolean }> = {};

        for (const providerName of providers) {
            const credential = await this.getCredentialForProvider(providerName);
            let available = false;

            if (credential) {
                try {
                    const provider = getProvider(providerName);
                    available = await provider.isAvailable(credential);
                } catch {
                    available = false;
                }
            }

            statuses[providerName] = {
                hasCredential: !!credential,
                available,
            };
        }

        return statuses as Record<LLMProvider, { available: boolean; hasCredential: boolean }>;
    }

    /**
     * List available models for a specific provider
     */
    async listModelsForProvider(providerName: LLMProvider): Promise<string[]> {
        const credential = await this.getCredentialForProvider(providerName);

        if (!credential) {
            return [];
        }

        const provider = getProvider(providerName);
        if (provider.listModels) {
            return provider.listModels(credential);
        }

        return [];
    }

    /**
     * List available models for a specific provider or the current default
     */
    async listModels(providerName?: string): Promise<Array<{ id: string; name: string }>> {
        const config = await loadLLMConfig();
        const targetProvider = (providerName || config.provider) as LLMProvider;

        const credential = await this.getCredentialForProvider(targetProvider);

        if (!credential) {
            return [];
        }

        const provider = getProvider(targetProvider);
        if (provider.listModels) {
            const modelIds = await provider.listModels(credential);
            return modelIds.map(id => ({ id, name: id }));
        }

        return [];
    }

    /**
     * Get current configuration (without sensitive data)
     */
    async getConfig(): Promise<LLMConfig & { hasCredential: boolean; providerCredentials: Record<LLMProvider, boolean> }> {
        const config = await loadLLMConfig();

        // Check credentials for all providers
        const providers = Object.keys(LLM_CREDENTIAL_KEYS) as LLMProvider[];
        const providerCredentials: Record<string, boolean> = {};

        for (const providerName of providers) {
            const credential = await this.getCredentialForProvider(providerName);
            providerCredentials[providerName] = !!credential;
        }

        return {
            ...config,
            hasCredential: providerCredentials[config.provider] ?? false,
            providerCredentials: providerCredentials as Record<LLMProvider, boolean>,
        };
    }

    /**
     * Update configuration
     * Accepts partial updates including nested objects
     */
    async updateConfig(updates: {
        provider?: LLMConfig['provider'];
        modelId?: string;
        parameters?: Partial<LLMConfig['parameters']>;
        providers?: LLMConfig['providers'];
        taskRouting?: LLMConfig['taskRouting'];
        tierModels?: Partial<NonNullable<LLMConfig['tierModels']>>;
        subAgentModels?: LLMConfig['subAgentModels'];
    }): Promise<LLMConfig> {
        const current = await loadLLMConfig();

        const updated: LLMConfig = {
            ...current,
            provider: updates.provider ?? current.provider,
            modelId: updates.modelId ?? current.modelId,
            parameters: {
                ...current.parameters,
                ...(updates.parameters || {}),
            },
        };

        // Merge providers if updated
        if (updates.providers) {
            updated.providers = {
                ...current.providers,
                ...updates.providers,
            };
        }

        // Merge task routing if updated
        if (updates.taskRouting) {
            updated.taskRouting = {
                ...current.taskRouting,
                ...updates.taskRouting,
            };
        }

        // Merge tier models if updated
        if (updates.tierModels) {
            updated.tierModels = {
                ...current.tierModels,
                ...updates.tierModels,
            };
        }

        // Merge legacy sub-agent models
        if (updates.subAgentModels) {
            updated.subAgentModels = {
                ...current.subAgentModels,
                ...updates.subAgentModels,
            };
        }

        await saveLLMConfig(updated);
        return updated;
    }
}

// Export singleton instance
export const llmService = LLMService.getInstance();
