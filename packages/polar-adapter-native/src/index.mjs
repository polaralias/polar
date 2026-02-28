import { RuntimeExecutionError } from "../../polar-domain/src/index.mjs";

/**
 * Creates a native HTTP provider adapter implementing the routing strategies
 * and schemas explicitly documented in `docs/LLMProviders.md`.
 * 
 * Supported endpointModes:
 * - "responses": OpenAI Responses API API semantics
 * - "chat": OpenAI Chat Completions API semantics
 * - "anthropic_messages": Anthropic Messages API
 * - "gemini_generate_content": Google Gemini GenerateContent API
 * 
 * @param {{
 *   providerId: string,
 *   endpointMode: "responses" | "chat" | "anthropic_messages" | "gemini_generate_content",
 *   baseUrl: string,
 *   apiKey?: string | (() => Promise<string> | string),
 *   defaultHeaders?: Record<string, string>,
 *   capabilities?: import("../../polar-runtime-core/src/provider-gateway.mjs").ProviderCapabilities,
 *   fetcher?: typeof fetch,
 *   timeoutMs?: number
 * }} config
 */
export function createNativeHttpAdapter(config) {
    if (!config || typeof config !== "object") {
        throw new RuntimeExecutionError("Provider adapter config must be an object");
    }

    const {
        providerId,
        endpointMode,
        baseUrl,
        apiKey,
        defaultHeaders = {},
        capabilities = {},
        fetcher = globalThis.fetch,
        timeoutMs: defaultTimeoutMs = 60000,
    } = config;

    if (typeof providerId !== "string" || providerId.length === 0) {
        throw new RuntimeExecutionError("providerId must be a non-empty string");
    }

    /**
     * @param {{ model: string }} input 
     */
    function buildGenerativeEndpoint(input) {
        let url = baseUrl;
        if (endpointMode === "openai" || endpointMode === "chat" || endpointMode === "responses") {
            // url is typically fully qualified, e.g., https://api.openai.com/v1/chat/completions or https://api.openai.com/v1/responses
            return url;
        } else if (endpointMode === "anthropic_messages") {
            return url;
        } else if (endpointMode === "gemini_generate_content") {
            // baseUrl is e.g. https://generativelanguage.googleapis.com/v1beta
            return `${url}/models/${input.model}:generateContent`;
        }
        return url;
    }

    async function resolveApiKey() {
        if (typeof apiKey === "function") {
            return await apiKey();
        }
        return apiKey || "";
    }

    async function buildHeaders(input, isApi) {
        const headers = {
            "Content-Type": "application/json",
            ...defaultHeaders,
        };

        const key = await resolveApiKey();
        if (key) {
            if (endpointMode === "anthropic_messages") {
                headers["x-api-key"] = key;
                if (!headers["anthropic-version"]) {
                    // BUG-036 fix: updated to latest stable version; configurable via defaultHeaders
                    headers["anthropic-version"] = "2024-10-22";
                }
            } else if (endpointMode === "gemini_generate_content") {
                // usually via key param but can be via header "x-goog-api-key"
                headers["x-goog-api-key"] = key;
            } else {
                headers["Authorization"] = `Bearer ${key}`;
            }
        }

        return headers;
    }

    function formatMessagesOpenAIType(input) {
        if (input.messages && Array.isArray(input.messages)) {
            const msgs = input.messages.map(m => ({ role: m.role, content: m.content || m.text || "" }));
            if (input.system && !msgs.some(m => m.role === "system")) {
                msgs.unshift({ role: "system", content: input.system });
            }
            if (input.prompt) {
                msgs.push({ role: "user", content: input.prompt });
            }
            return msgs;
        }

        const messages = [];
        if (input.system) {
            messages.push({ role: "system", content: input.system });
        }
        if (input.prompt) {
            messages.push({ role: "user", content: input.prompt });
        }
        return messages;
    }

    function formatInputResponsesType(input) {
        const arr = [];
        const systemRole = (endpointMode === "responses" || endpointMode === "anthropic_messages") ? "developer" : "system"; // OpenAI Responses preferred role

        if (input.system) {
            arr.push({
                type: "message",
                role: "developer",
                content: [{ type: "input_text", text: input.system }],
            });
        }
        if (input.messages && Array.isArray(input.messages)) {
            for (const msg of input.messages) {
                if (msg.role === "system") continue;
                arr.push({
                    type: "message",
                    role: msg.role === "assistant" ? "assistant" : "user",
                    content: [{ type: "input_text", text: msg.content || msg.text || "" }]
                });
            }
        }
        if (input.prompt) {
            arr.push({
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: input.prompt }],
            });
        }
        return arr;
    }

    function buildRequestBody(input, isStream) {
        const body = {};

        if (endpointMode === "chat") {
            body.model = input.model;
            body.messages = formatMessagesOpenAIType(input);
            if (input.temperature !== undefined) body.temperature = input.temperature;
            if (input.topP !== undefined) body.top_p = input.topP;
            if (input.topK !== undefined) body.top_k = input.topK;
            if (input.maxOutputTokens !== undefined) body.max_tokens = input.maxOutputTokens;
            if (input.presencePenalty !== undefined) body.presence_penalty = input.presencePenalty;
            if (input.frequencyPenalty !== undefined) body.frequency_penalty = input.frequencyPenalty;
            if (input.seed !== undefined) body.seed = input.seed;
            if (input.responseFormat !== undefined) body.response_format = input.responseFormat;
            if (input.tools !== undefined) body.tools = input.tools;
            if (input.toolChoice !== undefined) body.tool_choice = input.toolChoice;
            if (input.thinkingEnabled && capabilities.supportsNativeThinkingControl) {
                // siliconflow / sglang style
                if (!capabilities.supportsStatefulResponses) {
                    body.enable_thinking = true;
                }
            }
            body.stream = isStream;

            if (input.providerExtensions) {
                Object.assign(body, input.providerExtensions);
            }
        }
        else if (endpointMode === "responses") {
            body.model = input.model;
            body.input = formatInputResponsesType(input);
            if (input.reasoningEffort && capabilities.supportsOpenAIReasoningObject) {
                body.reasoning = { effort: input.reasoningEffort };
                if (input.reasoningSummary) {
                    body.reasoning.summary = input.reasoningSummary;
                }
            }
            if (input.verbosity && capabilities.supportsOpenAIVerbosity) {
                body.text = { verbosity: input.verbosity };
            }
            if (input.temperature !== undefined) body.temperature = input.temperature;
            if (input.topP !== undefined) body.top_p = input.topP;
            if (input.maxOutputTokens !== undefined) body.max_output_tokens = input.maxOutputTokens;
            if (input.tools !== undefined) body.tools = input.tools;
            body.stream = isStream;
        }
        else if (endpointMode === "anthropic_messages") {
            body.model = input.model;
            body.max_tokens = input.maxOutputTokens || 4096;
            if (input.system) body.system = input.system;

            const msgs = [];
            if (input.messages && Array.isArray(input.messages)) {
                msgs.push(...input.messages
                    .filter(m => m.role !== "system")
                    .map(m => ({ role: m.role, content: m.content || m.text || "" })));
            }
            if (input.prompt) {
                msgs.push({ role: "user", content: input.prompt });
            }
            body.messages = msgs;
            if (input.temperature !== undefined) body.temperature = input.temperature;
            if (input.topP !== undefined) body.top_p = input.topP;
            if (input.topK !== undefined) body.top_k = input.topK;

            if (input.thinkingEnabled) {
                body.thinking = {
                    type: "enabled",
                    budget_tokens: input.thinkingBudget || 1024
                };
            }
            if (input.tools !== undefined) body.tools = input.tools;
            if (input.toolChoice !== undefined) body.tool_choice = input.toolChoice;
            body.stream = isStream;
        }
        else if (endpointMode === "gemini_generate_content") {
            if (input.system) {
                body.systemInstruction = { parts: [{ text: input.system }] };
            }
            const contents = [];
            if (input.messages && Array.isArray(input.messages)) {
                for (const msg of input.messages) {
                    if (msg.role !== 'system') {
                        contents.push({ role: msg.role === "assistant" ? "model" : "user", parts: [{ text: msg.content || msg.text || "" }] });
                    }
                }
            }
            if (input.prompt) {
                contents.push({ role: "user", parts: [{ text: input.prompt }] });
            }
            body.contents = contents;
            body.generationConfig = {};

            if (input.temperature !== undefined) body.generationConfig.temperature = input.temperature;
            if (input.topP !== undefined) body.generationConfig.topP = input.topP;
            if (input.topK !== undefined) body.generationConfig.topK = input.topK;
            if (input.maxOutputTokens !== undefined) body.generationConfig.maxOutputTokens = input.maxOutputTokens;

            if (input.thinkingEnabled && input.thinkingLevel) {
                body.generationConfig.thinkingConfig = { thinkingLevel: input.thinkingLevel };
            }
            if (input.responseFormat !== undefined && input.responseFormat.type === "json_object") {
                body.generationConfig.responseMimeType = "application/json";
            }
            if (input.tools !== undefined) body.tools = input.tools;

            // stream uses a different endpoint in Gemini, handled separately / or param
        }

        return body;
    }

    function parseGenerateResponse(responseBody) {
        if (endpointMode === "chat") {
            return responseBody.choices?.[0]?.message?.content || "";
        } else if (endpointMode === "responses") {
            // standard Responses syntax (as per 2024/2025 Beta specs)
            if (responseBody.output && Array.isArray(responseBody.output)) {
                for (const item of responseBody.output) {
                    const contentItems = item.content || item.message?.content;
                    if (contentItems && Array.isArray(contentItems)) {
                        const textItem = contentItems.find(c => c.type === "text" || c.type === "output_text" || (c.type === "message" && c.text));
                        if (textItem) return textItem.text || textItem.value || "";
                    }
                }
            }
            // Fallbacks for older responses or hybrid implementations (e.g. Groq/Ollama)
            return responseBody.text || responseBody.content || responseBody.message?.content || responseBody.completions?.[0]?.content || responseBody.completions?.[0]?.text || responseBody.choices?.[0]?.message?.content || "";
        } else if (endpointMode === "anthropic_messages") {
            const parts = responseBody.content || [];
            const textPart = parts.find(p => p.type === "text") || parts[0];
            return textPart ? textPart.text : "";
        } else if (endpointMode === "gemini_generate_content") {
            return responseBody.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
        return "";
    }

    function extractTokenCount(responseBody) {
        const usage = {};
        if (endpointMode === "chat" || endpointMode === "responses") {
            const rawUsage = responseBody.usage || {};
            if (rawUsage.prompt_tokens !== undefined) usage.promptTokens = rawUsage.prompt_tokens;
            if (rawUsage.completion_tokens !== undefined) usage.completionTokens = rawUsage.completion_tokens;
            if (rawUsage.total_tokens !== undefined) usage.totalTokens = rawUsage.total_tokens;
        } else if (endpointMode === "anthropic_messages") {
            const rawUsage = responseBody.usage || {};
            if (rawUsage.input_tokens !== undefined) usage.promptTokens = rawUsage.input_tokens;
            if (rawUsage.output_tokens !== undefined) usage.completionTokens = rawUsage.output_tokens;
        } else if (endpointMode === "gemini_generate_content") {
            const rawUsage = responseBody.usageMetadata || {};
            if (rawUsage.promptTokenCount !== undefined) usage.promptTokens = rawUsage.promptTokenCount;
            if (rawUsage.candidatesTokenCount !== undefined) usage.completionTokens = rawUsage.candidatesTokenCount;
            if (rawUsage.totalTokenCount !== undefined) usage.totalTokens = rawUsage.totalTokenCount;
        }
        return Object.keys(usage).length > 0 ? usage : undefined;
    }

    return Object.freeze({
        capabilities,

        async generate(input) {
            if (input.providerId !== providerId) {
                throw new RuntimeExecutionError("Provider id does not match adapter logic", { expected: providerId, received: input.providerId });
            }

            const url = buildGenerativeEndpoint(input);
            const headers = await buildHeaders(input, false);
            const bodyArgs = buildRequestBody(input, false);

            const AbortControllerImpl = globalThis.AbortController || require('abort-controller');
            const controller = new AbortControllerImpl();
            const timeoutMs = input.timeoutMs !== undefined ? input.timeoutMs : defaultTimeoutMs;
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const res = await fetcher(url, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(bodyArgs),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!res.ok) {
                    let errMessage = res.statusText;
                    try {
                        const json = await res.json();
                        errMessage = json.error?.message || JSON.stringify(json);
                    } catch { /* ignore */ }
                    throw new RuntimeExecutionError(`Native HTTP Provider failed: ${errMessage}`, {
                        providerId,
                        status: res.status
                    });
                }

                const json = await res.json();
                const text = parseGenerateResponse(json);
                const usage = extractTokenCount(json);

                if (!text || text.length === 0) {
                    throw new RuntimeExecutionError(`Native HTTP Provider returned an empty response`, { providerId, model: input.model });
                }

                return {
                    providerId: input.providerId,
                    model: input.model,
                    text,
                    usage: usage
                };
            } catch (err) {
                clearTimeout(timeoutId);
                if (err.name === 'AbortError') {
                    throw new RuntimeExecutionError(`Native HTTP Provider timed out after ${timeoutMs}ms`, { providerId, model: input.model });
                }
                throw err;
            }
        },

        async stream(input) {
            // Stream parsing requires SSE parsing which can be complex.
            // We will implement a naive implementation and reject if unsupported setup.
            if (input.providerId !== providerId) {
                throw new RuntimeExecutionError("Provider id does not match adapter logic", { expected: providerId, received: input.providerId });
            }

            let url = buildGenerativeEndpoint(input);
            if (endpointMode === "gemini_generate_content") {
                url = url.replace(":generateContent", ":streamGenerateContent?alt=sse");
            }

            const headers = await buildHeaders(input, true);
            const bodyArgs = buildRequestBody(input, true);

            const AbortControllerImpl = globalThis.AbortController || require('abort-controller');
            const controller = new AbortControllerImpl();
            const timeoutMs = input.timeoutMs !== undefined ? input.timeoutMs : defaultTimeoutMs;
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const res = await fetcher(url, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(bodyArgs),
                    signal: controller.signal
                });

                if (!res.ok) {
                    clearTimeout(timeoutId);
                    let errMessage = res.statusText;
                    try {
                        const json = await res.json();
                        errMessage = json.error?.message || JSON.stringify(json);
                    } catch { /* ignore */ }
                    throw new RuntimeExecutionError(`Native HTTP Provider stream failed: ${errMessage}`, { providerId, status: res.status });
                }

                if (!res.body) {
                    clearTimeout(timeoutId);
                    throw new RuntimeExecutionError("Native HTTP Provider stream body is empty", { providerId });
                }

                const chunks = [];
                const decoder = new TextDecoder();
                let lineBuffer = "";

                function extractDelta(parsed) {
                    if (endpointMode === "chat") {
                        return parsed.choices?.[0]?.delta?.content || "";
                    } else if (endpointMode === "anthropic_messages") {
                        if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                            return parsed.delta.text;
                        }
                        return "";
                    } else if (endpointMode === "gemini_generate_content") {
                        return parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
                    } else if (endpointMode === "responses") {
                        if (parsed.type === "response.output_text.delta") {
                            return parsed.delta || "";
                        }
                        if (parsed.choices?.[0]?.delta?.content) {
                            return parsed.choices[0].delta.content;
                        }
                        return "";
                    }
                    return "";
                }

                function processSSELines(rawChunk) {
                    lineBuffer += rawChunk;
                    const lines = lineBuffer.split("\n");
                    lineBuffer = lines.pop() || "";
                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            const data = line.slice(6).trim();
                            if (data === "[DONE]") continue;
                            if (!data) continue;
                            try {
                                const parsed = JSON.parse(data);
                                const delta = extractDelta(parsed);
                                if (delta) chunks.push(delta);
                            } catch { /* incomplete JSON in this line, skip */ }
                        }
                    }
                }

                if (res.body[Symbol.asyncIterator]) {
                    for await (const chunk of res.body) {
                        processSSELines(decoder.decode(chunk, { stream: true }));
                    }
                } else {
                    const reader = res.body.getReader();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        processSSELines(decoder.decode(value, { stream: true }));
                    }
                }

                clearTimeout(timeoutId);

                if (lineBuffer.trim()) {
                    processSSELines("\n");
                }

                if (chunks.length === 0) {
                    throw new RuntimeExecutionError(`Native HTTP Stream Provider returned no chunks`, { providerId });
                }

                return {
                    providerId: input.providerId,
                    model: input.model,
                    chunks,
                };
            } catch (err) {
                clearTimeout(timeoutId);
                if (err.name === 'AbortError') {
                    throw new RuntimeExecutionError(`Native HTTP Provider stream timed out after ${timeoutMs}ms`, { providerId, model: input.model });
                }
                throw err;
            }
        },

        async embed(input) {
            if (input.providerId !== providerId) {
                throw new RuntimeExecutionError("Provider id does not match adapter logic", { expected: providerId, received: input.providerId });
            }

            let url = baseUrl;
            if (endpointMode === "openai" || endpointMode === "chat") {
                // OpenAI Embeddings API is /v1/embeddings typically. If baseUrl is /v1/chat/completions, replace it.
                url = url.replace("/chat/completions", "/embeddings");
            } else if (endpointMode === "responses") {
                // BUG-015 fix: Responses API doesn't have its own embedding endpoint,
                // redirect to the standard /v1/embeddings endpoint
                url = url.replace("/v1/responses", "/v1/embeddings");
            } else if (endpointMode === "gemini_generate_content") {
                url = `${baseUrl}/models/${input.model}:embedContent`;
            } else if (endpointMode === "anthropic_messages") {
                throw new RuntimeExecutionError("Anthropic Messages API does not support embeddings natively. Use a different provider for embedding.", { endpointMode });
            } else {
                throw new RuntimeExecutionError("Embedding is not implemented for this endpointMode on native HTTP provider", { endpointMode });
            }

            const headers = await buildHeaders(input, false);
            const bodyArgs = {};

            if (endpointMode === "chat" || endpointMode === "openai") {
                bodyArgs.model = input.model;
                bodyArgs.input = input.text;
            } else if (endpointMode === "gemini_generate_content") {
                bodyArgs.content = { parts: [{ text: input.text }] };
            }

            const AbortControllerImpl = globalThis.AbortController || require('abort-controller');
            const controller = new AbortControllerImpl();
            const timeoutMs = input.timeoutMs !== undefined ? input.timeoutMs : defaultTimeoutMs;
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const res = await fetcher(url, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(bodyArgs),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!res.ok) {
                    throw new RuntimeExecutionError("Native HTTP Provider embedding failed", { providerId, status: res.status });
                }

                const json = await res.json();
                let vector = [];
                if (endpointMode === "chat" || endpointMode === "openai" || endpointMode === "responses") {
                    vector = json.data?.[0]?.embedding || [];
                } else if (endpointMode === "gemini_generate_content") {
                    vector = json.embedding?.values || [];
                }

                if (vector.length === 0) {
                    throw new RuntimeExecutionError("Embedder returned an invalid vector", { providerId, model: input.model });
                }

                return {
                    providerId: input.providerId,
                    model: input.model,
                    vector: [...vector]
                };
            } catch (err) {
                clearTimeout(timeoutId);
                if (err.name === 'AbortError') {
                    throw new RuntimeExecutionError(`Native HTTP Provider embedding timed out after ${timeoutMs}ms`, { providerId, model: input.model });
                }
                throw err;
            }
        },

        async listModels() {
            let url = baseUrl;
            try {
                // Attempt standard discovery
                if (endpointMode === "gemini_generate_content") {
                    url = new URL("/v1beta/models", baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`).href;
                } else if (!baseUrl.endsWith("/models")) {
                    url = new URL("/v1/models", baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`).href;
                }
                const headers = await buildHeaders({}, false);
                const AbortControllerImpl = globalThis.AbortController || require('abort-controller');
                const controller = new AbortControllerImpl();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const res = await fetcher(url, { method: "GET", headers, signal: controller.signal });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const json = await res.json();
                    if (json.data && Array.isArray(json.data)) {
                        return { providerId, models: json.data.map(m => m.id || m.name) };
                    } else if (json.models && Array.isArray(json.models)) {
                        return { providerId, models: json.models.map(m => m.name || m.id) };
                    }
                }
            } catch (err) {
                // Ignore fetch errors, fallback to static based on documentation
            }

            // Fallback based on docs/LLMProviders.md curated lists
            const staticMap = {
                anthropic: ["claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
                openai: ["gpt-5", "gpt-5.2", "gpt-5 mini", "gpt-4o", "gpt-4o-mini", "o1", "o1-mini", "o3-mini"],
                google_gemini: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
                minimax: ["MiniMax-M2.5", "MiniMax-M2.5-highspeed"],
                groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"],
                deepseek: ["deepseek-chat", "deepseek-reasoner"]
            };

            const models = staticMap[providerId] || ["default"];
            return { providerId, models };
        }
    });
}
