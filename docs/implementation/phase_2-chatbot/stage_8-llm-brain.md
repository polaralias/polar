# Phase 2 - Stage 8: LLM Brain & Configuration

## Goal
Establish the "Core Compass" of the agent: the Large Language Model integration layer. This stage handles secure connection to providers, but more importantly, it defines the **Main Agent's Personality and Constraints**.

## 1. LLM Provider Abstraction
Implement a vendor-agnostic `LLMService` that decouples the application logic from specific model providers.

### Supported Providers
1.  **OpenRouter** - Aggregator for accessing Claude 3.5 Sonnet, GPT-4o, Llama 3, etc.
2.  **Anthropic** - Direct Claude API
3.  **OpenAI** - Direct GPT-4o, GPT-4o-mini, o1 API
4.  **Mistral** - Mistral Large, Small, Codestral
5.  **Amazon Bedrock** - Nova, Claude on Bedrock, Titan, Llama
6.  **Azure OpenAI** - Azure-hosted OpenAI models
7.  **Ollama** - Local inference support

### Multi-Provider Support
The system supports **multiple providers simultaneously**:
- Different tasks can route to different providers
- e.g., Use Gemini for web search (Google integration) but Claude for email rewrites

### Configuration Schema
```typescript
interface LLMConfig {
  provider: 'openrouter' | 'anthropic' | 'openai' | 'mistral' | 'bedrock' | 'azure-openai' | 'ollama';
  modelId: string;
  parameters: {
    temperature: number;
    maxTokens?: number;
    topP?: number;
  };
  
  // Per-provider configurations for multi-provider setups
  providers?: Record<LLMProvider, ProviderConfig>;
  
  // Task routing - maps task types to specific providers
  taskRouting?: Record<string, LLMProvider>;
  
  // Model tier assignments
  tierModels?: {
    cheap?: string;     // e.g., "openai:gpt-4o-mini"
    fast?: string;      // e.g., "anthropic:claude-3-haiku"
    reasoning?: string; // e.g., "anthropic:claude-3-5-sonnet"
  };
}
```

## 2. Model Tier System

The system uses **model tiers** to match task complexity with appropriate models.

### Tier Definitions
| Tier | Purpose | Example Models |
|------|---------|----------------|
| `cheap` | Simplest tasks, lowest cost | gpt-4o-mini, claude-3-haiku, nova-micro |
| `fast` | Low latency tasks | gpt-4o-mini, claude-3-5-haiku |
| `writing` | Content creation (emails, docs, posts) | claude-3-5-sonnet, gpt-4o |
| `reasoning` | Complex reasoning & planning | claude-3-5-sonnet, gpt-4o, o1-mini |
| `specialized` | Task-specific | codestral (code), gemini (search) |

### Two Types of Tier Selection

#### A. Pre-Defined Sub-Agents (Hard-Pinned)
Internal utility functions with **fixed tier assignments** that **cannot be overridden**:

| Sub-Agent | Tier | Rationale |
|-----------|------|-----------|
| Intent Classifier | `cheap` | Simple yes/no classification |
| Conversation Summarizer | `cheap` | Text compression doesn't need reasoning |
| Entity Extractor | `cheap` | Pattern matching task |
| Sentiment Analyzer | `cheap` | Tone detection |
| Task Classifier | `cheap` | Routing decisions |

These always use the user's configured model for the `cheap` tier.

#### B. Dynamically Spawned Workers (Orchestrator Recommended)
When the orchestrator spawns a worker via `worker.spawn`, it **recommends** a tier based on its assessment of the task:

```typescript
// The orchestrator assesses and includes modelTier in the spawn request
worker.spawn({
  goal: "Analyze the quarterly report and summarize key findings",
  capabilities: ["fs.read"],
  modelTier: "reasoning"  // Orchestrator recommends reasoning for analysis tasks
})

worker.spawn({
  goal: "Read file and return contents",
  capabilities: ["fs.read"],
  modelTier: "cheap"  // Simple lookup = cheap tier
})
```

The worker then uses the recommended tier. This allows the orchestrator to optimize costs while maintaining quality for complex tasks.

## 3. Secure Credential Management
API Keys must never be stored in plain text.
*   **Storage**: Encrypted `Secrets` vault.
*   **Runtime**: Decrypted *only* at request time.
*   **Redaction**: Keys stripped from logs.

## 4. Dynamic Prompt Architecture (The Planner)
The `ContextManager` assembles the final prompt. For the **Main Agent**, this prompt is strictly engineered to enforce its role as a **Planner/Router**.

### Prompt Stack Order
1.  **System Invariants (The Constitution)**:
    *   **Identity**: "You are Polar, a secure AI assistant."
    *   **Role**: "You are a **Planner**. You CANNOT directly access files, calendars, or the internet. You must use the `worker.spawn` tool to delegate these tasks to specialized workers."
    *   **Protocol**: "Analyze the user's request, determine the necessary capabilities (e.g., `calendar.read`), and spawn a worker with JUST those capabilities."
2.  **Global Personalization (Stage 9)**:
    *   User's custom instructions.
3.  **Available Tools**:
    *   **Main Agent**: Only sees `worker.spawn`, `memory.query`, `memory.propose`, `policy.check`.
    *   **Workers**: See the specific MCP tools granted by their token.
4.  **Conversation History**:
    *   Recent turns with rolling window truncation.

## 5. Specialized Sub-Agents
To optimize for cost, latency, and security, we employ specialized sub-agents with limited context scopes.

### A. Intent Classifier
Validates if a user's ambiguous reply grants permission for a pending action.
- **Tier**: `cheap`
- **Temperature**: 0.1 (consistent classification)

### B. Conversation Summarizer
Compresses older conversation turns to maintain context efficiency.
- **Tier**: `cheap`
- **Temperature**: 0.3

### C. Entity Extractor
Extracts structured entities (dates, people, locations) from messages.
- **Tier**: `cheap`

### D. Sentiment Analyzer
Analyzes emotional tone and urgency of messages.
- **Tier**: `cheap`

### E. Task Classifier
Classifies user intent for task-based provider routing.
- **Tier**: `cheap`

## 6. UI/UX for Model Selection
*   **Settings > Intelligence**:
    *   Provider/Model selection
    *   API Key input for each provider
    *   Model tier configuration (cheap, fast, reasoning)
    *   Task routing rules

## Acceptance Criteria
- [x] `LLMService` supports multiple providers (OpenRouter, Anthropic, OpenAI, Mistral, Bedrock, Azure, Ollama).
- [x] System Prompt explicitly instructs the model to act as a Router/Planner.
- [x] Main Agent has NO access to generic execution tools in its prompt context.
- [x] API keys are encrypted and redacted.
- [x] Intent Classifier sub-agent implemented with tier pinning.
- [x] Conversation Summarizer sub-agent implemented with tier pinning.
- [x] Entity Extractor, Sentiment Analyzer, Task Classifier sub-agents added.
- [x] Model tier pinning system (cheap, fast, reasoning, specialized).
- [x] Multi-provider support with task-based routing.
- [x] REST API endpoints for LLM configuration management.
- [ ] UI Integration (Settings > Intelligence page).

## Implementation Summary

### Files Created/Modified
- `apps/runtime/src/llm/types.ts` - Enhanced types with multi-provider, tier support
- `apps/runtime/src/llm/providers/base.ts` - Abstract provider interface
- `apps/runtime/src/llm/providers/openrouter.ts` - OpenRouter provider adapter
- `apps/runtime/src/llm/providers/anthropic.ts` - Anthropic provider adapter  
- `apps/runtime/src/llm/providers/ollama.ts` - Ollama provider adapter
- `apps/runtime/src/llm/providers/openai.ts` - **NEW** OpenAI provider adapter
- `apps/runtime/src/llm/providers/azure-openai.ts` - **NEW** Azure OpenAI adapter
- `apps/runtime/src/llm/providers/bedrock.ts` - **NEW** Amazon Bedrock adapter
- `apps/runtime/src/llm/providers/mistral.ts` - **NEW** Mistral AI adapter
- `apps/runtime/src/llm/providers/index.ts` - Updated provider factory
- `apps/runtime/src/llm/configStore.ts` - LLM configuration persistence
- `apps/runtime/src/llm/service.ts` - Enhanced with tier pinning & multi-provider routing
- `apps/runtime/src/llm/contextManager.ts` - Prompt assembly with Planner architecture
- `apps/runtime/src/llm/subAgents.ts` - All sub-agents with tier pinning
- `apps/runtime/src/llm/index.ts` - Barrel exports

### API Endpoints Added
- `GET /llm/config` - Get current LLM configuration (includes all provider credentials status)
- `POST /llm/config` - Update LLM configuration (providers, tiers, routing)
- `GET /llm/status` - Check if LLM is configured
- `GET /llm/models` - List available models for current/specified provider
- `POST /llm/chat` - Send chat completion with main agent context
- `POST /llm/credentials` - Set API keys securely
- `DELETE /llm/credentials/:provider` - Remove API keys
- `POST /llm/classify-intent` - Classify user intent (cheap tier)
- `POST /llm/summarize` - Summarize conversation (cheap tier)

### Key Service Methods
```typescript
// Standard chat
await llmService.chat(request, options);

// Force a specific tier (sub-agents use this)
await llmService.chatWithTier(request, 'cheap', options);

// Route based on task type
await llmService.chatForTask(request, 'web_search', options);

// Check all provider statuses
await llmService.getProviderStatuses();

// List models for a specific provider
await llmService.listModelsForProvider('openai');
```

## Deferred from Phase 1 (Maturity)
- **Secret Rotation**: Implement a mechanism for hot-reloading keys and secrets without requiring a system restart.
- **Namespaced Secrets**: Transition to a namespaced secrets store where credentials are keyed to specific connectors and skill IDs.
- **Provider Failover**: Automatic failover to secondary providers if primary is unavailable.
- **Cost Tracking**: Track and report LLM costs per provider/tier/session.
