# Phase 2 - Stage 8: LLM Brain & Configuration

## Goal
Establish the "Core Compass" of the agent: the Large Language Model integration layer. This stage handles secure connection to providers, but more importantly, it defines the **Main Agent's Personality and Constraints**.

## 1. LLM Provider Abstraction
Implement a vendor-agnostic `LLMService` that decouples the application logic from specific model providers.

### Supported Providers (Initial)
1.  **OpenRouter** (Aggregator for accessing Claude 3.5 Sonnet, GPT-4o, Llama 3).
2.  **Anthropic** (Direct API).
3.  **Ollama** (Local inference support).

### Configuration Schema
Store configuration in the `SystemStore`.
```typescript
interface LLMConfig {
  provider: 'openrouter' | 'anthropic' | 'ollama';
  modelId: string;
  parameters: {
    temperature: number;
    maxTokens?: number;
  };
}
```

## 2. Secure Credential Management
API Keys must never be stored in plain text.
*   **Storage**: Encrypted `Secrets` vault.
*   **Runtime**: Decrypted *only* at request time.
*   **Redaction**: Keys stripped from logs.

## 3. Dynamic Prompt Architecture (The Planner)
The `ContextManager` assembles the final prompt. For the **Main Agent**, this prompt is strictly engineered to enforce its role as a **Planner/Router**.

### Prompt Stack Order
1.  **System Invariants (The Constitution)**:
    *   **Identity**: "You are Polar, a secure AI assistant."
    *   **Role**: "You are a **Planner**. You CANNOT directly access files, calendars, or the internet. You must use the `worker.spawn` tool to delegate these tasks to specialized workers."
    *   **Protocol**: "Analyze the user's request, determine the necessary capabilities (e.g., `calendar.read`), and spawn a worker with JUST those capabilities. Do not ask for permissions you don't need."
2.  **Global Personalization (Stage 9)**:
    *   User's custom instructions.
3.  **Available Tools**:
    *   **Main Agent**: Only sees `worker.spawn`, `read_policy`, `audit_log`.
    *   **Workers**: See the specific MCP tools granted by their token.
4.  **Conversation History**:
    *   Recent turns.

### Token Management
*   Strategy: Rolling window.

## 5. Specialized Sub-Agents & Schemas
To optimize for cost, latency, and security, we employ specialized sub-agents with limited context scopes. These run on lighter models (e.g., GPT-4o-mini, Gemini 1.5 Flash).

### A. Intent Classifier (Proactive Actions)
Used to validate if a user's ambiguous reply (e.g., "yep", "sure") grants permission for a pending proactive action.

**Worker Request Schema**:
```typescript
interface IntentClassifierRequest {
  agent_id: "intent_classifier_v1";
  payload: {
    proposal_context: string; // e.g. "Draft email to Alex about Dinner"
    user_message: string;     // e.g. "Do it"
  };
  // Strictly explicitly configured model for speed/cost
  model_hint: "fast" | "reasoning"; 
}
```

**System Prompt (Simplified)**:
> You are an intent classifier. You have NO tools.
> Context: The user was asked to approve: "${proposal_context}".
> User Reply: "${user_message}".
> Task: output JSON `{ "approved": boolean, "confidence": number }`.
> If ambiguous, valid = false.

### B. Conversation Summarizer
Compresses older conversation turns to maintain context window efficiency without losing key facts.

**Worker Request Schema**:
```typescript
interface SummarizerRequest {
  agent_id: "summarizer_v1";
  payload: {
    messages: Message[]; // Array of last N messages to compress
  };
  model_hint: "fast";
}
```

## 6. UI/UX for Model Selection
*   **Settings > Intelligence**:
    *   Provider/Model selection.
    *   API Key input.

## Acceptance Criteria
- [ ] `LLMService` supports multiple providers.
- [ ] System Prompt explicitly instructs the model to act as a Router/Planner.
- [ ] Main Agent has NO access to generic execution tools in its prompt context.
- [ ] API keys are encrypted and redacted.
