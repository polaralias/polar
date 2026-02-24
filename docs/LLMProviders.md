# LLM provider doc extraction

Below is a practical, implementation-ready update that gives you:

1. **Exact doc URLs** (as a copyable mapping)
2. **OpenAI compatibility status**
3. **Recommended endpoint + body shape per provider**
4. **A fully fleshed example request body for each provider**
5. Notes on **reasoning / thinking / verbosity / top_p** support and where fields are provider or model specific

OpenAI itself now recommends using the **Responses API** for reasoning models, while noting Chat Completions is still supported. ([OpenAI Developers][1])

---

## Copyable provider config map (docs + endpoint strategy)

```yaml
providers:
  anthropic:
    docs:
      - https://docs.anthropic.com/en/api/messages
    recommended_endpoint: POST /v1/messages
    schema_family: anthropic_messages
    openai_compatible: false

  openai:
    docs:
      - https://platform.openai.com/docs/api-reference/responses
      - https://developers.openai.com/api/docs/guides/reasoning/
      - https://developers.openai.com/api/docs/guides/text/
    recommended_endpoint: POST /v1/responses
    schema_family: openai_responses
    openai_compatible: native

  google_gemini:
    docs:
      - https://ai.google.dev/api/generate-content
      - https://ai.google.dev/gemini-api/docs/thinking
    recommended_endpoint: POST /v1beta/models/{model}:generateContent
    schema_family: google_generate_content
    openai_compatible: false

  minimax:
    docs:
      - https://platform.minimax.io/docs/api-reference/text/text-openai-api
    recommended_endpoint: POST /v1/chat/completions
    schema_family: openai_chat_compatible
    openai_compatible: true

  openrouter:
    docs:
      - https://openrouter.ai/docs/api-reference/overview
      - https://openrouter.ai/docs/community/open-ai-sdk
    recommended_endpoint: POST /api/v1/chat/completions
    schema_family: openai_chat_plus_openrouter_extensions
    openai_compatible: true

  together:
    docs:
      - https://docs.together.ai/docs/openai-api-compatibility
    recommended_endpoint: POST /v1/chat/completions
    schema_family: openai_chat_compatible
    openai_compatible: true

  groq:
    docs:
      - https://console.groq.com/docs/openai
      - https://console.groq.com/docs/api-reference#tag/responses/operation/createResponse
    recommended_endpoint: POST /openai/v1/responses (reasoning-capable models), fallback /openai/v1/chat/completions
    schema_family: openai_compatible_plus_groq_limits
    openai_compatible: true

  deepseek:
    docs:
      - https://api-docs.deepseek.com/
      - https://api-docs.deepseek.com/api/create-chat-completion
    recommended_endpoint: POST /chat/completions
    schema_family: openai_chat_compatible
    openai_compatible: true

  siliconflow:
    docs:
      - https://docs.siliconflow.com/en/api-reference/chat-completions/chat-completions
    recommended_endpoint: POST /v1/chat/completions
    schema_family: openai_chat_compatible_plus_siliconflow_thinking
    openai_compatible: true

  ollama:
    docs:
      - https://docs.ollama.com/api/openai-compatibility
    recommended_endpoint: POST /v1/responses (if you want Responses semantics), fallback /v1/chat/completions
    schema_family: partial_openai_compat_responses_and_chat
    openai_compatible: true

  localai:
    docs:
      - https://localai.io/getting-started/
      - https://localai.io/advanced/model-configuration/
    recommended_endpoint: POST /v1/responses (or /v1/chat/completions)
    schema_family: openai_compatible_plus_localai_extensions
    openai_compatible: true

  vllm:
    docs:
      - https://docs.vllm.ai/en/stable/serving/openai_compatible_server/
    recommended_endpoint: POST /v1/responses (if your client stack is Responses-first), fallback /v1/chat/completions
    schema_family: openai_compatible_plus_vllm_extra_body
    openai_compatible: true

  tgi:
    docs:
      - https://huggingface.co/docs/text-generation-inference/en/messages_api
    recommended_endpoint: POST /v1/chat/completions
    schema_family: openai_chat_compatible_messages_api
    openai_compatible: true

  sglang:
    docs:
      - https://docs.sglang.ai
      - https://qwen.readthedocs.io/en/latest/deployment/sglang.html
    recommended_endpoint: POST /v1/chat/completions
    schema_family: openai_chat_compatible_plus_sglang_extra_body
    openai_compatible: true
```

The endpoint and compatibility choices above are based on each provider’s current docs, including OpenAI Responses guidance, Anthropic Messages, Gemini `generateContent`, TGI Messages API, Ollama’s OpenAI compatibility page (including `/v1/responses`), LocalAI’s support for `/v1/responses`, and vLLM’s OpenAI-compatible server docs listing supported APIs including `/v1/responses`. ([OpenAI Platform][2])

---

## Quick adapter rule I would implement

Use this routing logic in your provider layer:

* **OPENAI_RESPONSES**: `/v1/responses`
* **ANTHROPIC**: `/v1/messages`
* **GOOGLE_GEMINI**: `/v1beta/models/{model}:generateContent`
* **OPENAI_COMPATIBLE**:

  * Prefer `/v1/responses` only when the provider explicitly documents it (OpenAI, Groq, Ollama, LocalAI, vLLM)
  * Otherwise default to `/v1/chat/completions`

That approach avoids betting on undocumented `/responses` support and protects you from chat endpoint churn where a provider has already published a Responses endpoint. OpenAI and vLLM explicitly document `/v1/responses`, and Ollama/LocalAI do too. ([OpenAI Platform][2])

---

## Required schema by provider (minimum viable)

* **OpenAI Responses**: `model`, `input` (plus optional `instructions`, `reasoning`, `text`, tools, etc.) ([OpenAI Platform][2])
* **Anthropic Messages**: `model`, `max_tokens`, `messages` (plus optional `system`, `thinking`, `temperature`, `top_p`, `top_k`) ([Claude][3])
* **Gemini generateContent**: model is in URL, body typically includes `contents` and optional `generationConfig`, `systemInstruction`, `tools`, etc. ([Google AI for Developers][4])
* **OpenAI-compatible chat**: `model`, `messages` (plus optional sampling/tools/format fields, depending on provider/model) ([Hugging Face][5])
* **OpenAI-compatible responses**: `model`, `input` (subset varies by implementation) ([Ollama Documentation][6])

---

## Fully fledged example request per provider

Use these as canonical examples for your config UI and request builder.
If a field is not supported by the target model/provider, omit it instead of sending `null`.

---

### 1) OpenAI (native Responses, GPT-5 family, high reasoning + high verbosity)

OpenAI’s Responses API is the recommended path for reasoning models, and the docs/guides show `reasoning` and `verbosity` style controls in this family. ([OpenAI Developers][1])

**POST** `https://api.openai.com/v1/responses`

Headers:

* `Authorization: Bearer $OPENAI_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "gpt-5",
  "input": [
    {
      "role": "system",
      "content": [
        {
          "type": "input_text",
          "text": "You are a precise technical assistant. Return clear implementation guidance."
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Design a migration plan from chat completions to responses APIs across providers."
        }
      ]
    }
  ],
  "reasoning": {
    "effort": "high",
    "summary": "detailed"
  },
  "text": {
    "verbosity": "high"
  },
  "temperature": 0.2,
  "top_p": 0.95,
  "max_output_tokens": 4096,
  "tools": [],
  "store": false,
  "stream": false
}
```

---

### 2) Anthropic (native Messages, thinking enabled with budget)

Anthropic’s Messages API uses its own schema and supports `thinking`, `temperature`, `top_p`, and `top_k` in documented request fields. ([Claude][3])

**POST** `https://api.anthropic.com/v1/messages`

Headers:

* `x-api-key: $ANTHROPIC_API_KEY`
* `anthropic-version: 2023-06-01`
* `content-type: application/json`

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 4096,
  "system": "You are a precise technical assistant. Prefer robust migration-safe API advice.",
  "messages": [
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "thinking": {
    "type": "enabled",
    "budget_tokens": 2048
  },
  "temperature": 0.2,
  "top_p": 0.95,
  "top_k": 50,
  "metadata": {
    "use_case": "provider_api_migration"
  },
  "stream": false
}
```

---

### 3) Google Gemini (native `generateContent`, Pro reasoning-capable model, max thinking config)

Gemini uses `models/{model}:generateContent` with `contents` and optional config blocks such as `generationConfig` and documented thinking configuration (`thinkingConfig` / thinking-related settings). Exact thinking controls can vary by model and API version. ([Google AI for Developers][4])

**POST** `https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key=$GEMINI_API_KEY`

Headers:

* `Content-Type: application/json`

```json
{
  "systemInstruction": {
    "parts": [
      {
        "text": "You are a precise technical assistant. Return implementation-ready migration guidance."
      }
    ]
  },
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "Design a migration plan from chat completions to responses APIs across providers."
        }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0.2,
    "topP": 0.95,
    "topK": 40,
    "maxOutputTokens": 4096,
    "responseMimeType": "text/plain",
    "thinkingConfig": {
      "thinkingLevel": "HIGH"
    }
  },
  "safetySettings": []
}
```

If your selected Gemini model/version uses a different thinking knob (for example budget-style thinking), map your UI setting to that model’s documented field and omit unsupported keys. ([Google AI for Developers][4])

---

### 4) MiniMax (OpenAI-compatible chat)

MiniMax documents an OpenAI-compatible API path and examples using OpenAI-style chat completions. ([MiniMax API Docs][7])

**POST** `https://api.minimaxi.com/v1/chat/completions`

Headers:

* `Authorization: Bearer $MINIMAX_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "MiniMax-M1",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "presence_penalty": 0,
  "frequency_penalty": 0,
  "stream": false
}
```

---

### 5) OpenRouter (OpenAI-compatible chat with OpenRouter extensions)

OpenRouter provides an OpenAI-compatible schema and adds router/provider-specific extensions such as provider routing controls and transforms. ([OpenRouter][8])

**POST** `https://openrouter.ai/api/v1/chat/completions`

Headers:

* `Authorization: Bearer $OPENROUTER_API_KEY`
* `Content-Type: application/json`
* `HTTP-Referer: https://your-app.example`
* `X-Title: Your App Name`

```json
{
  "model": "openai/gpt-5",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "stream": false,
  "provider": {
    "allow_fallbacks": true
  },
  "transforms": [],
  "response_format": {
    "type": "text"
  }
}
```

If you are targeting OpenAI models through OpenRouter, you may be able to pass OpenAI-style reasoning controls, but support can vary by upstream model/provider path. Treat those as model-specific pass-throughs, not guaranteed router-level fields. ([OpenRouter][8])

---

### 6) Together AI (OpenAI-compatible chat)

Together documents OpenAI API compatibility and the same endpoint style for chat completions. ([Together.ai Docs][9])

**POST** `https://api.together.xyz/v1/chat/completions`

Headers:

* `Authorization: Bearer $TOGETHER_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "top_k": 50,
  "max_tokens": 4096,
  "repetition_penalty": 1,
  "presence_penalty": 0,
  "frequency_penalty": 0,
  "stream": false
}
```

---

### 7) Groq (OpenAI-compatible, Responses available in docs)

Groq documents OpenAI compatibility and also has a documented Responses API operation in its API reference. Use Responses when you want a Responses-first integration, with fallback to chat completions for broader compatibility. ([GroqCloud][10])

**POST** `https://api.groq.com/openai/v1/responses`

Headers:

* `Authorization: Bearer $GROQ_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "openai/gpt-oss-120b",
  "input": "Design a migration plan from chat completions to responses APIs across providers.",
  "reasoning": {
    "effort": "high"
  },
  "temperature": 0.2,
  "top_p": 0.95,
  "max_output_tokens": 4096,
  "stream": false
}
```

If a Groq model does not support the specific Responses field set you send, fall back to `/openai/v1/chat/completions` and standard OpenAI chat fields. Groq’s compatibility docs also note unsupported features in some cases. ([GroqCloud][10])

---

### 8) DeepSeek (OpenAI-compatible chat)

DeepSeek documents OpenAI-compatible usage and a chat completions API. ([DeepSeek API Docs][11])

**POST** `https://api.deepseek.com/chat/completions`

Headers:

* `Authorization: Bearer $DEEPSEEK_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "deepseek-reasoner",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "stream": false,
  "response_format": {
    "type": "text"
  }
}
```

DeepSeek uses OpenAI-style chat schema, but do not assume OpenAI `reasoning` or `verbosity` objects are accepted unless DeepSeek documents them for the specific endpoint/model. ([DeepSeek API Docs][11])

---

### 9) SiliconFlow (OpenAI-compatible chat with thinking toggles)

SiliconFlow’s chat completions docs expose OpenAI-compatible chat plus thinking-related controls such as `enable_thinking` (and, for some models, thinking budget style options). ([SiliconFlow][12])

**POST** `https://api.siliconflow.com/v1/chat/completions`

Headers:

* `Authorization: Bearer $SILICONFLOW_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "Qwen/Qwen3-32B",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "enable_thinking": true,
  "stream": false
}
```

If your selected SiliconFlow model supports a thinking budget field, treat it as model-specific and expose it conditionally in your UI. ([SiliconFlow][12])

---

### 10) Ollama (OpenAI-compatible, `/v1/responses` supported, non-stateful only)

Ollama documents OpenAI compatibility and explicitly lists `/v1/responses` support (added in v0.13.3), with a **non-stateful** implementation and a documented subset of supported fields. ([Ollama Documentation][6])

**POST** `http://localhost:11434/v1/responses`

Headers:

* `Authorization: Bearer ollama`
* `Content-Type: application/json`

```json
{
  "model": "qwen3:latest",
  "input": "Design a migration plan from chat completions to responses APIs across providers.",
  "instructions": "You are a precise technical assistant.",
  "temperature": 0.2,
  "top_p": 0.95,
  "max_output_tokens": 4096,
  "tools": [],
  "stream": false,
  "truncation": "disabled"
}
```

Do not rely on `previous_response_id` or `conversation` with Ollama’s OpenAI-compatible `/v1/responses` path, as stateful Responses semantics are not supported there. ([Ollama Documentation][6])

---

### 11) LocalAI (OpenAI-compatible, supports chat + Anthropic Messages + `/v1/responses`)

LocalAI documents support for OpenAI-style chat/completions and `/v1/responses`, plus Anthropic-compatible `/v1/messages`. It also documents model YAML defaults for many OpenAI-style sampling parameters (`temperature`, `top_p`, `top_k`, penalties, etc.). ([LocalAI][13])

**POST** `http://localhost:8080/v1/responses`

Headers:

* `Content-Type: application/json`

```json
{
  "model": "gpt-4",
  "input": "Design a migration plan from chat completions to responses APIs across providers.",
  "max_output_tokens": 4096,
  "temperature": 0.2,
  "top_p": 0.95,
  "stream": false,
  "background": false
}
```

If you need `top_k` and other backend-specific controls consistently, use LocalAI model configuration defaults (`parameters`) and/or validate which fields are exposed by your selected backend/runtime. ([LocalAI][14])

---

### 12) vLLM (OpenAI-compatible, supports `/v1/responses`, use `extra_body` for non-OpenAI params)

vLLM’s OpenAI-compatible server docs explicitly list support for Chat Completions and Responses APIs and recommend `extra_body` for non-OpenAI parameters such as `top_k`. They also note that `generation_config.json` can override defaults unless disabled at launch. ([vLLM][15])

**POST** `http://localhost:8000/v1/chat/completions`

Headers:

* `Authorization: Bearer token-abc123`
* `Content-Type: application/json`

```json
{
  "model": "Qwen/Qwen3-8B",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "presence_penalty": 0,
  "frequency_penalty": 0,
  "stream": false,
  "top_k": 40,
  "chat_template_kwargs": {
    "enable_thinking": true
  }
}
```

For strict OpenAI client compatibility, pass vLLM-only fields via `extra_body` in the SDK layer, even though direct HTTP requests can merge them into JSON. ([vLLM][15])

---

### 13) TGI (Hugging Face Text Generation Inference, OpenAI Chat Completions compatible via Messages API)

TGI documents a Messages API that is fully compatible with the OpenAI Chat Completion API (available from TGI v1.4.0), using `/v1/chat/completions`. ([Hugging Face][5])

**POST** `http://localhost:8080/v1/chat/completions`

Headers:

* `Content-Type: application/json`
* `Authorization: Bearer -`

```json
{
  "model": "tgi",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "stream": false
}
```

Use a conservative OpenAI chat subset unless you have validated provider-specific features on your deployed TGI version/model stack. ([Hugging Face][5])

---

### 14) SGLang (OpenAI-compatible chat, extra fields for `top_k` and thinking controls)

The Qwen deployment guide shows SGLang serving an OpenAI-compatible API by default on `http://localhost:30000`, including `/v1/chat/completions`, and demonstrates extra-body style fields like `top_k` and `chat_template_kwargs.enable_thinking`. It also links to SGLang’s official docs. ([Qwen][16])

**POST** `http://localhost:30000/v1/chat/completions`

Headers:

* `Content-Type: application/json`
* `Authorization: Bearer EMPTY`

```json
{
  "model": "Qwen/Qwen3-8B",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "top_k": 40,
  "max_tokens": 4096,
  "presence_penalty": 0,
  "stream": false,
  "chat_template_kwargs": {
    "enable_thinking": true
  }
}
```

---

## What to expose in your unified config UI (safe cross-provider superset)

If you want one abstraction that survives endpoint changes, use this internal superset and map down per provider/model:

* `model`
* `endpoint_mode`: `responses | chat | anthropic_messages | gemini_generate_content`
* `system`
* `input/messages/contents`
* `max_output_tokens` (map to `max_tokens` where needed)
* `temperature`
* `top_p`
* `top_k` (provider/model-specific)
* `presence_penalty`
* `frequency_penalty`
* `seed` (where supported)
* `stream`
* `tools`
* `tool_choice`
* `response_format`
* `reasoning_effort` (OpenAI/Groq Responses style where supported)
* `reasoning_summary` (OpenAI-style Responses where supported)
* `verbosity` (OpenAI Responses text verbosity only)
* `thinking_enabled` (Anthropic/SiliconFlow/SGLang/vLLM/Qwen-style mappings)
* `thinking_budget` (Anthropic token budget / provider-specific)
* `thinking_level` (Gemini model/version-specific)
* `provider_extensions` (raw passthrough object, e.g. OpenRouter `provider`, vLLM `structured_outputs`, SGLang `chat_template_kwargs`)

This keeps your Kotlin config stable while you remap capabilities per provider. The need for provider-specific extras is explicitly documented for systems like vLLM (`extra_body`) and appears in SGLang/Qwen deployment examples. ([vLLM][15])

---

## Important implementation note for your enum set

Your current enum marks several local runtimes as `OPENAI_COMPATIBLE`. That is still fine, but I would add a capability matrix internally, for example:

* `supportsResponsesEndpoint`
* `supportsChatCompletionsEndpoint`
* `supportsNativeThinkingControl`
* `supportsOpenAIReasoningObject`
* `supportsOpenAIVerbosity`
* `supportsTopK`
* `requiresVersionHeader`
* `supportsStatefulResponses`

That prevents you from over-sending fields like OpenAI `text.verbosity` to DeepSeek/Together/TGI, or `reasoning` to providers that only expose thinking via model-specific extras. This is especially relevant for Ollama, which supports `/v1/responses` but only a documented subset and non-stateful behaviour. ([Ollama Documentation][6])

[1]: https://developers.openai.com/api/docs/guides/reasoning/?utm_source=chatgpt.com "Reasoning models | OpenAI API"
[2]: https://platform.openai.com/docs/api-reference/responses "Responses | OpenAI API Reference"
[3]: https://platform.claude.com/docs/en/api/python/messages/create "Create a Message - Claude API Reference"
[4]: https://ai.google.dev/api/generate-content "Generating content  |  Gemini API  |  Google AI for Developers"
[5]: https://huggingface.co/docs/text-generation-inference/en/messages_api "Messages API"
[6]: https://docs.ollama.com/api/openai-compatibility "OpenAI compatibility - Ollama"
[7]: https://platform.minimax.io/docs/api-reference/text-openai-api "Compatible OpenAI API - MiniMax API Docs"
[8]: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request "Create a chat completion | OpenRouter | Documentation"
[9]: https://docs.together.ai/docs/openai-api-compatibility "OpenAI Compatibility - Together.ai Docs"
[10]: https://console.groq.com/docs/openai "OpenAI Compatibility - GroqDocs"
[11]: https://api-docs.deepseek.com/ "Your First API Call | DeepSeek API Docs"
[12]: https://docs.siliconflow.com/en/api-reference/chat-completions/chat-completions "Chat completions - SiliconFlow"
[13]: https://localai.io/getting-started/index.print "Getting started :: LocalAI"
[14]: https://localai.io/advanced/model-configuration/ "Model Configuration :: LocalAI"
[15]: https://docs.vllm.ai/en/stable/serving/openai_compatible_server/ "OpenAI-Compatible Server - vLLM"
[16]: https://qwen.readthedocs.io/en/latest/deployment/sglang.html "SGLang - Qwen"


# Extra supporting context

Absolutely. This is the right time to lock this down because the ecosystem is fragmenting around:

* native **Responses-style** APIs (OpenAI, some local runtimes, increasingly others)
* legacy or still-primary **Chat Completions** compatibility layers
* provider-specific schemas (Anthropic, Gemini)

Below is a practical, implementation-ready update that gives you:

1. **Exact doc URLs** (as a copyable mapping)
2. **OpenAI compatibility status**
3. **Recommended endpoint + body shape per provider**
4. **A fully fleshed example request body for each provider**
5. Notes on **reasoning / thinking / verbosity / top_p** support and where fields are provider or model specific

OpenAI itself now recommends using the **Responses API** for reasoning models, while noting Chat Completions is still supported. ([OpenAI Developers][1])

---

## Copyable provider config map (docs + endpoint strategy)

```yaml
providers:
  anthropic:
    docs:
      - https://docs.anthropic.com/en/api/messages
    recommended_endpoint: POST /v1/messages
    schema_family: anthropic_messages
    openai_compatible: false

  openai:
    docs:
      - https://platform.openai.com/docs/api-reference/responses
      - https://developers.openai.com/api/docs/guides/reasoning/
      - https://developers.openai.com/api/docs/guides/text/
    recommended_endpoint: POST /v1/responses
    schema_family: openai_responses
    openai_compatible: native

  google_gemini:
    docs:
      - https://ai.google.dev/api/generate-content
      - https://ai.google.dev/gemini-api/docs/thinking
    recommended_endpoint: POST /v1beta/models/{model}:generateContent
    schema_family: google_generate_content
    openai_compatible: false

  minimax:
    docs:
      - https://platform.minimax.io/docs/api-reference/text/text-openai-api
    recommended_endpoint: POST /v1/chat/completions
    schema_family: openai_chat_compatible
    openai_compatible: true

  openrouter:
    docs:
      - https://openrouter.ai/docs/api-reference/overview
      - https://openrouter.ai/docs/community/open-ai-sdk
    recommended_endpoint: POST /api/v1/chat/completions
    schema_family: openai_chat_plus_openrouter_extensions
    openai_compatible: true

  together:
    docs:
      - https://docs.together.ai/docs/openai-api-compatibility
    recommended_endpoint: POST /v1/chat/completions
    schema_family: openai_chat_compatible
    openai_compatible: true

  groq:
    docs:
      - https://console.groq.com/docs/openai
      - https://console.groq.com/docs/api-reference#tag/responses/operation/createResponse
    recommended_endpoint: POST /openai/v1/responses (reasoning-capable models), fallback /openai/v1/chat/completions
    schema_family: openai_compatible_plus_groq_limits
    openai_compatible: true

  deepseek:
    docs:
      - https://api-docs.deepseek.com/
      - https://api-docs.deepseek.com/api/create-chat-completion
    recommended_endpoint: POST /chat/completions
    schema_family: openai_chat_compatible
    openai_compatible: true

  siliconflow:
    docs:
      - https://docs.siliconflow.com/en/api-reference/chat-completions/chat-completions
    recommended_endpoint: POST /v1/chat/completions
    schema_family: openai_chat_compatible_plus_siliconflow_thinking
    openai_compatible: true

  ollama:
    docs:
      - https://docs.ollama.com/api/openai-compatibility
    recommended_endpoint: POST /v1/responses (if you want Responses semantics), fallback /v1/chat/completions
    schema_family: partial_openai_compat_responses_and_chat
    openai_compatible: true

  localai:
    docs:
      - https://localai.io/getting-started/
      - https://localai.io/advanced/model-configuration/
    recommended_endpoint: POST /v1/responses (or /v1/chat/completions)
    schema_family: openai_compatible_plus_localai_extensions
    openai_compatible: true

  vllm:
    docs:
      - https://docs.vllm.ai/en/stable/serving/openai_compatible_server/
    recommended_endpoint: POST /v1/responses (if your client stack is Responses-first), fallback /v1/chat/completions
    schema_family: openai_compatible_plus_vllm_extra_body
    openai_compatible: true

  tgi:
    docs:
      - https://huggingface.co/docs/text-generation-inference/en/messages_api
    recommended_endpoint: POST /v1/chat/completions
    schema_family: openai_chat_compatible_messages_api
    openai_compatible: true

  sglang:
    docs:
      - https://docs.sglang.ai
      - https://qwen.readthedocs.io/en/latest/deployment/sglang.html
    recommended_endpoint: POST /v1/chat/completions
    schema_family: openai_chat_compatible_plus_sglang_extra_body
    openai_compatible: true
```

The endpoint and compatibility choices above are based on each provider’s current docs, including OpenAI Responses guidance, Anthropic Messages, Gemini `generateContent`, TGI Messages API, Ollama’s OpenAI compatibility page (including `/v1/responses`), LocalAI’s support for `/v1/responses`, and vLLM’s OpenAI-compatible server docs listing supported APIs including `/v1/responses`. ([OpenAI Platform][2])

---

## Quick adapter rule I would implement

Use this routing logic in your provider layer:

* **OPENAI_RESPONSES**: `/v1/responses`
* **ANTHROPIC**: `/v1/messages`
* **GOOGLE_GEMINI**: `/v1beta/models/{model}:generateContent`
* **OPENAI_COMPATIBLE**:

  * Prefer `/v1/responses` only when the provider explicitly documents it (OpenAI, Groq, Ollama, LocalAI, vLLM)
  * Otherwise default to `/v1/chat/completions`

That approach avoids betting on undocumented `/responses` support and protects you from chat endpoint churn where a provider has already published a Responses endpoint. OpenAI and vLLM explicitly document `/v1/responses`, and Ollama/LocalAI do too. ([OpenAI Platform][2])

---

## Required schema by provider (minimum viable)

* **OpenAI Responses**: `model`, `input` (plus optional `instructions`, `reasoning`, `text`, tools, etc.) ([OpenAI Platform][2])
* **Anthropic Messages**: `model`, `max_tokens`, `messages` (plus optional `system`, `thinking`, `temperature`, `top_p`, `top_k`) ([Claude][3])
* **Gemini generateContent**: model is in URL, body typically includes `contents` and optional `generationConfig`, `systemInstruction`, `tools`, etc. ([Google AI for Developers][4])
* **OpenAI-compatible chat**: `model`, `messages` (plus optional sampling/tools/format fields, depending on provider/model) ([Hugging Face][5])
* **OpenAI-compatible responses**: `model`, `input` (subset varies by implementation) ([Ollama Documentation][6])

---

## Fully fledged example request per provider

Use these as canonical examples for your config UI and request builder.
If a field is not supported by the target model/provider, omit it instead of sending `null`.

---

### 1) OpenAI (native Responses, GPT-5 family, high reasoning + high verbosity)

OpenAI’s Responses API is the recommended path for reasoning models, and the docs/guides show `reasoning` and `verbosity` style controls in this family. ([OpenAI Developers][1])

**POST** `https://api.openai.com/v1/responses`

Headers:

* `Authorization: Bearer $OPENAI_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "gpt-5",
  "input": [
    {
      "role": "system",
      "content": [
        {
          "type": "input_text",
          "text": "You are a precise technical assistant. Return clear implementation guidance."
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Design a migration plan from chat completions to responses APIs across providers."
        }
      ]
    }
  ],
  "reasoning": {
    "effort": "high",
    "summary": "detailed"
  },
  "text": {
    "verbosity": "high"
  },
  "temperature": 0.2,
  "top_p": 0.95,
  "max_output_tokens": 4096,
  "tools": [],
  "store": false,
  "stream": false
}
```

---

### 2) Anthropic (native Messages, thinking enabled with budget)

Anthropic’s Messages API uses its own schema and supports `thinking`, `temperature`, `top_p`, and `top_k` in documented request fields. ([Claude][3])

**POST** `https://api.anthropic.com/v1/messages`

Headers:

* `x-api-key: $ANTHROPIC_API_KEY`
* `anthropic-version: 2023-06-01`
* `content-type: application/json`

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 4096,
  "system": "You are a precise technical assistant. Prefer robust migration-safe API advice.",
  "messages": [
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "thinking": {
    "type": "enabled",
    "budget_tokens": 2048
  },
  "temperature": 0.2,
  "top_p": 0.95,
  "top_k": 50,
  "metadata": {
    "use_case": "provider_api_migration"
  },
  "stream": false
}
```

---

### 3) Google Gemini (native `generateContent`, Pro reasoning-capable model, max thinking config)

Gemini uses `models/{model}:generateContent` with `contents` and optional config blocks such as `generationConfig` and documented thinking configuration (`thinkingConfig` / thinking-related settings). Exact thinking controls can vary by model and API version. ([Google AI for Developers][4])

**POST** `https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key=$GEMINI_API_KEY`

Headers:

* `Content-Type: application/json`

```json
{
  "systemInstruction": {
    "parts": [
      {
        "text": "You are a precise technical assistant. Return implementation-ready migration guidance."
      }
    ]
  },
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "Design a migration plan from chat completions to responses APIs across providers."
        }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0.2,
    "topP": 0.95,
    "topK": 40,
    "maxOutputTokens": 4096,
    "responseMimeType": "text/plain",
    "thinkingConfig": {
      "thinkingLevel": "HIGH"
    }
  },
  "safetySettings": []
}
```

If your selected Gemini model/version uses a different thinking knob (for example budget-style thinking), map your UI setting to that model’s documented field and omit unsupported keys. ([Google AI for Developers][4])

---

### 4) MiniMax (OpenAI-compatible chat)

MiniMax documents an OpenAI-compatible API path and examples using OpenAI-style chat completions. ([MiniMax API Docs][7])

**POST** `https://api.minimaxi.com/v1/chat/completions`

Headers:

* `Authorization: Bearer $MINIMAX_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "MiniMax-M1",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "presence_penalty": 0,
  "frequency_penalty": 0,
  "stream": false
}
```

---

### 5) OpenRouter (OpenAI-compatible chat with OpenRouter extensions)

OpenRouter provides an OpenAI-compatible schema and adds router/provider-specific extensions such as provider routing controls and transforms. ([OpenRouter][8])

**POST** `https://openrouter.ai/api/v1/chat/completions`

Headers:

* `Authorization: Bearer $OPENROUTER_API_KEY`
* `Content-Type: application/json`
* `HTTP-Referer: https://your-app.example`
* `X-Title: Your App Name`

```json
{
  "model": "openai/gpt-5",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "stream": false,
  "provider": {
    "allow_fallbacks": true
  },
  "transforms": [],
  "response_format": {
    "type": "text"
  }
}
```

If you are targeting OpenAI models through OpenRouter, you may be able to pass OpenAI-style reasoning controls, but support can vary by upstream model/provider path. Treat those as model-specific pass-throughs, not guaranteed router-level fields. ([OpenRouter][8])

---

### 6) Together AI (OpenAI-compatible chat)

Together documents OpenAI API compatibility and the same endpoint style for chat completions. ([Together.ai Docs][9])

**POST** `https://api.together.xyz/v1/chat/completions`

Headers:

* `Authorization: Bearer $TOGETHER_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "top_k": 50,
  "max_tokens": 4096,
  "repetition_penalty": 1,
  "presence_penalty": 0,
  "frequency_penalty": 0,
  "stream": false
}
```

---

### 7) Groq (OpenAI-compatible, Responses available in docs)

Groq documents OpenAI compatibility and also has a documented Responses API operation in its API reference. Use Responses when you want a Responses-first integration, with fallback to chat completions for broader compatibility. ([GroqCloud][10])

**POST** `https://api.groq.com/openai/v1/responses`

Headers:

* `Authorization: Bearer $GROQ_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "openai/gpt-oss-120b",
  "input": "Design a migration plan from chat completions to responses APIs across providers.",
  "reasoning": {
    "effort": "high"
  },
  "temperature": 0.2,
  "top_p": 0.95,
  "max_output_tokens": 4096,
  "stream": false
}
```

If a Groq model does not support the specific Responses field set you send, fall back to `/openai/v1/chat/completions` and standard OpenAI chat fields. Groq’s compatibility docs also note unsupported features in some cases. ([GroqCloud][10])

---

### 8) DeepSeek (OpenAI-compatible chat)

DeepSeek documents OpenAI-compatible usage and a chat completions API. ([DeepSeek API Docs][11])

**POST** `https://api.deepseek.com/chat/completions`

Headers:

* `Authorization: Bearer $DEEPSEEK_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "deepseek-reasoner",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "stream": false,
  "response_format": {
    "type": "text"
  }
}
```

DeepSeek uses OpenAI-style chat schema, but do not assume OpenAI `reasoning` or `verbosity` objects are accepted unless DeepSeek documents them for the specific endpoint/model. ([DeepSeek API Docs][11])

---

### 9) SiliconFlow (OpenAI-compatible chat with thinking toggles)

SiliconFlow’s chat completions docs expose OpenAI-compatible chat plus thinking-related controls such as `enable_thinking` (and, for some models, thinking budget style options). ([SiliconFlow][12])

**POST** `https://api.siliconflow.com/v1/chat/completions`

Headers:

* `Authorization: Bearer $SILICONFLOW_API_KEY`
* `Content-Type: application/json`

```json
{
  "model": "Qwen/Qwen3-32B",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "enable_thinking": true,
  "stream": false
}
```

If your selected SiliconFlow model supports a thinking budget field, treat it as model-specific and expose it conditionally in your UI. ([SiliconFlow][12])

---

### 10) Ollama (OpenAI-compatible, `/v1/responses` supported, non-stateful only)

Ollama documents OpenAI compatibility and explicitly lists `/v1/responses` support (added in v0.13.3), with a **non-stateful** implementation and a documented subset of supported fields. ([Ollama Documentation][6])

**POST** `http://localhost:11434/v1/responses`

Headers:

* `Authorization: Bearer ollama`
* `Content-Type: application/json`

```json
{
  "model": "qwen3:latest",
  "input": "Design a migration plan from chat completions to responses APIs across providers.",
  "instructions": "You are a precise technical assistant.",
  "temperature": 0.2,
  "top_p": 0.95,
  "max_output_tokens": 4096,
  "tools": [],
  "stream": false,
  "truncation": "disabled"
}
```

Do not rely on `previous_response_id` or `conversation` with Ollama’s OpenAI-compatible `/v1/responses` path, as stateful Responses semantics are not supported there. ([Ollama Documentation][6])

---

### 11) LocalAI (OpenAI-compatible, supports chat + Anthropic Messages + `/v1/responses`)

LocalAI documents support for OpenAI-style chat/completions and `/v1/responses`, plus Anthropic-compatible `/v1/messages`. It also documents model YAML defaults for many OpenAI-style sampling parameters (`temperature`, `top_p`, `top_k`, penalties, etc.). ([LocalAI][13])

**POST** `http://localhost:8080/v1/responses`

Headers:

* `Content-Type: application/json`

```json
{
  "model": "gpt-4",
  "input": "Design a migration plan from chat completions to responses APIs across providers.",
  "max_output_tokens": 4096,
  "temperature": 0.2,
  "top_p": 0.95,
  "stream": false,
  "background": false
}
```

If you need `top_k` and other backend-specific controls consistently, use LocalAI model configuration defaults (`parameters`) and/or validate which fields are exposed by your selected backend/runtime. ([LocalAI][14])

---

### 12) vLLM (OpenAI-compatible, supports `/v1/responses`, use `extra_body` for non-OpenAI params)

vLLM’s OpenAI-compatible server docs explicitly list support for Chat Completions and Responses APIs and recommend `extra_body` for non-OpenAI parameters such as `top_k`. They also note that `generation_config.json` can override defaults unless disabled at launch. ([vLLM][15])

**POST** `http://localhost:8000/v1/chat/completions`

Headers:

* `Authorization: Bearer token-abc123`
* `Content-Type: application/json`

```json
{
  "model": "Qwen/Qwen3-8B",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "presence_penalty": 0,
  "frequency_penalty": 0,
  "stream": false,
  "top_k": 40,
  "chat_template_kwargs": {
    "enable_thinking": true
  }
}
```

For strict OpenAI client compatibility, pass vLLM-only fields via `extra_body` in the SDK layer, even though direct HTTP requests can merge them into JSON. ([vLLM][15])

---

### 13) TGI (Hugging Face Text Generation Inference, OpenAI Chat Completions compatible via Messages API)

TGI documents a Messages API that is fully compatible with the OpenAI Chat Completion API (available from TGI v1.4.0), using `/v1/chat/completions`. ([Hugging Face][5])

**POST** `http://localhost:8080/v1/chat/completions`

Headers:

* `Content-Type: application/json`
* `Authorization: Bearer -`

```json
{
  "model": "tgi",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "max_tokens": 4096,
  "stream": false
}
```

Use a conservative OpenAI chat subset unless you have validated provider-specific features on your deployed TGI version/model stack. ([Hugging Face][5])

---

### 14) SGLang (OpenAI-compatible chat, extra fields for `top_k` and thinking controls)

The Qwen deployment guide shows SGLang serving an OpenAI-compatible API by default on `http://localhost:30000`, including `/v1/chat/completions`, and demonstrates extra-body style fields like `top_k` and `chat_template_kwargs.enable_thinking`. It also links to SGLang’s official docs. ([Qwen][16])

**POST** `http://localhost:30000/v1/chat/completions`

Headers:

* `Content-Type: application/json`
* `Authorization: Bearer EMPTY`

```json
{
  "model": "Qwen/Qwen3-8B",
  "messages": [
    {
      "role": "system",
      "content": "You are a precise technical assistant."
    },
    {
      "role": "user",
      "content": "Design a migration plan from chat completions to responses APIs across providers."
    }
  ],
  "temperature": 0.2,
  "top_p": 0.95,
  "top_k": 40,
  "max_tokens": 4096,
  "presence_penalty": 0,
  "stream": false,
  "chat_template_kwargs": {
    "enable_thinking": true
  }
}
```

---

## What to expose in your unified config UI (safe cross-provider superset)

If you want one abstraction that survives endpoint changes, use this internal superset and map down per provider/model:

* `model`
* `endpoint_mode`: `responses | chat | anthropic_messages | gemini_generate_content`
* `system`
* `input/messages/contents`
* `max_output_tokens` (map to `max_tokens` where needed)
* `temperature`
* `top_p`
* `top_k` (provider/model-specific)
* `presence_penalty`
* `frequency_penalty`
* `seed` (where supported)
* `stream`
* `tools`
* `tool_choice`
* `response_format`
* `reasoning_effort` (OpenAI/Groq Responses style where supported)
* `reasoning_summary` (OpenAI-style Responses where supported)
* `verbosity` (OpenAI Responses text verbosity only)
* `thinking_enabled` (Anthropic/SiliconFlow/SGLang/vLLM/Qwen-style mappings)
* `thinking_budget` (Anthropic token budget / provider-specific)
* `thinking_level` (Gemini model/version-specific)
* `provider_extensions` (raw passthrough object, e.g. OpenRouter `provider`, vLLM `structured_outputs`, SGLang `chat_template_kwargs`)

This keeps your Kotlin config stable while you remap capabilities per provider. The need for provider-specific extras is explicitly documented for systems like vLLM (`extra_body`) and appears in SGLang/Qwen deployment examples. ([vLLM][15])

---

## Important implementation note for your enum set

Your current enum marks several local runtimes as `OPENAI_COMPATIBLE`. That is still fine, but I would add a capability matrix internally, for example:

* `supportsResponsesEndpoint`
* `supportsChatCompletionsEndpoint`
* `supportsNativeThinkingControl`
* `supportsOpenAIReasoningObject`
* `supportsOpenAIVerbosity`
* `supportsTopK`
* `requiresVersionHeader`
* `supportsStatefulResponses`

That prevents you from over-sending fields like OpenAI `text.verbosity` to DeepSeek/Together/TGI, or `reasoning` to providers that only expose thinking via model-specific extras. This is especially relevant for Ollama, which supports `/v1/responses` but only a documented subset and non-stateful behaviour. ([Ollama Documentation][6])

---

If you want, next I can turn this into a **Kotlin data model + mapper layer** (sealed request builders per `LlmApiFormat` plus provider capability flags) and include exact serialisation examples for `kotlinx.serialization` or Jackson.

[1]: https://developers.openai.com/api/docs/guides/reasoning/?utm_source=chatgpt.com "Reasoning models | OpenAI API"
[2]: https://platform.openai.com/docs/api-reference/responses "Responses | OpenAI API Reference"
[3]: https://platform.claude.com/docs/en/api/python/messages/create "Create a Message - Claude API Reference"
[4]: https://ai.google.dev/api/generate-content "Generating content  |  Gemini API  |  Google AI for Developers"
[5]: https://huggingface.co/docs/text-generation-inference/en/messages_api "Messages API"
[6]: https://docs.ollama.com/api/openai-compatibility "OpenAI compatibility - Ollama"
[7]: https://platform.minimax.io/docs/api-reference/text-openai-api "Compatible OpenAI API - MiniMax API Docs"
[8]: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request "Create a chat completion | OpenRouter | Documentation"
[9]: https://docs.together.ai/docs/openai-api-compatibility "OpenAI Compatibility - Together.ai Docs"
[10]: https://console.groq.com/docs/openai "OpenAI Compatibility - GroqDocs"
[11]: https://api-docs.deepseek.com/ "Your First API Call | DeepSeek API Docs"
[12]: https://docs.siliconflow.com/en/api-reference/chat-completions/chat-completions "Chat completions - SiliconFlow"
[13]: https://localai.io/getting-started/index.print "Getting started :: LocalAI"
[14]: https://localai.io/advanced/model-configuration/ "Model Configuration :: LocalAI"
[15]: https://docs.vllm.ai/en/stable/serving/openai_compatible_server/ "OpenAI-Compatible Server - vLLM"
[16]: https://qwen.readthedocs.io/en/latest/deployment/sglang.html "SGLang - Qwen"
