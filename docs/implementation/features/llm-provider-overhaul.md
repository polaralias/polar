# LLM Provider Overhaul

## Overview
Polar now supports a broader multi-provider LLM stack with unified routing, tier pinning, and richer model visibility in the Intelligence UI.

## Supported Providers
- OpenRouter
- OpenAI
- Anthropic
- Google Gemini
- MiniMax
- Mistral
- Amazon Bedrock
- Azure OpenAI
- Together AI
- Groq
- DeepSeek
- SiliconFlow
- Ollama
- LM Studio
- LocalAI
- vLLM
- TGI
- SGLang

## Credential Modes
- `apiKey`: cloud APIs that use bearer or provider key auth
- `json`: structured credentials for providers needing extra fields (Bedrock, Azure OpenAI)
- `baseUrl`: local/self-hosted endpoints where the credential field stores endpoint URL

## Model Catalog Visibility
The model catalog now includes per-model metadata used by UI and fallback behavior:
- `recommended`: highlighted default picks for day-to-day usage
- `agentic`: highlighted picks for tool-heavy and autonomous workflows
- `cheap`: explicit label for efficient/low-cost options

When dynamic model discovery is unavailable, Polar falls back to the static model registry for provider-specific model visibility.

## API Format Updates
- OpenAI integration uses the Responses API path (`/v1/responses`) for modern GPT-5/Codex workflows.
- Gemini integration selects API version by model family (`v1alpha` for Gemini 3, `v1beta` otherwise) and uses `x-goog-api-key` headers.
- OpenAI-compatible endpoints share a unified adapter, with MiniMax-specific token field handling (`max_completion_tokens`).
