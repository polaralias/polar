/**
 * LLM Module Index
 * Central export point for all LLM functionality
 */

// Types - all type definitions
export * from './types.js';

// Configuration
export { loadLLMConfig, saveLLMConfig, updateLLMConfig, resetLLMConfig } from './configStore.js';

// Core service
export { LLMService, llmService, type LLMServiceOptions } from './service.js';

// Context management
export {
    compileMainAgentContext,
    compileWorkerContext,
    MAIN_AGENT_TOOLS,
    type PromptContext,
    type CompilePromptOptions,
} from './contextManager.js';

// Sub-agents
export {
    classifyIntent,
    summarizeConversation,
    extractEntities,
    analyzeSentiment,
    classifyTask,
    type ExtractedEntities,
    type SentimentAnalysis,
    type TaskClassification,
} from './subAgents.js';

// Providers
export {
    getProvider,
    getAllProviders,
    getProviderNames,
    hasProvider,
    type LLMProviderAdapter,
    redactApiKey,
    createHeaders,
} from './providers/index.js';
