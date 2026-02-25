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
 *   fetcher?: typeof fetch
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
                    headers["anthropic-version"] = "2023-06-01";
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
        const messages = [];
        if (input.system) {
            messages.push({ role: "system", content: input.system });
        }
        messages.push({ role: "user", content: input.prompt });
        return messages;
    }

    function formatInputResponsesType(input) {
        const arr = [];
        if (input.system) {
            arr.push({
                role: "system",
                content: [{ type: "input_text", text: input.system }],
            });
        }
        arr.push({
            role: "user",
            content: [{ type: "input_text", text: input.prompt }],
        });
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
            body.stream = isStream;
        }
        else if (endpointMode === "anthropic_messages") {
            body.model = input.model;
            body.max_tokens = input.maxOutputTokens || 4096;
            if (input.system) body.system = input.system;
            body.messages = [{ role: "user", content: input.prompt }];
            if (input.temperature !== undefined) body.temperature = input.temperature;
            if (input.topP !== undefined) body.top_p = input.topP;
            if (input.topK !== undefined) body.top_k = input.topK;

            if (input.thinkingEnabled) {
                body.thinking = {
                    type: "enabled",
                    budget_tokens: input.thinkingBudget || 1024
                };
            }
            body.stream = isStream;
        }
        else if (endpointMode === "gemini_generate_content") {
            if (input.system) {
                body.systemInstruction = { parts: [{ text: input.system }] };
            }
            body.contents = [{ role: "user", parts: [{ text: input.prompt }] }];
            body.generationConfig = {};

            if (input.temperature !== undefined) body.generationConfig.temperature = input.temperature;
            if (input.topP !== undefined) body.generationConfig.topP = input.topP;
            if (input.topK !== undefined) body.generationConfig.topK = input.topK;
            if (input.maxOutputTokens !== undefined) body.generationConfig.maxOutputTokens = input.maxOutputTokens;

            if (input.thinkingEnabled && input.thinkingLevel) {
                body.generationConfig.thinkingConfig = { thinkingLevel: input.thinkingLevel };
            }

            // stream uses a different endpoint in Gemini, handled separately / or param
        }

        return body;
    }

    function parseGenerateResponse(responseBody) {
        if (endpointMode === "chat") {
            return responseBody.choices?.[0]?.message?.content || "";
        } else if (endpointMode === "responses") {
            // standard Responses syntax
            // might be different based on OpenAI updates, but mostly responses format is an object mapping
            return responseBody.completions?.[0]?.content || responseBody.choices?.[0]?.message?.content || ""; // Fallbacks
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
        if (endpointMode === "chat" || endpointMode === "responses") {
            return {
                promptTokens: responseBody.usage?.prompt_tokens,
                completionTokens: responseBody.usage?.completion_tokens,
                totalTokens: responseBody.usage?.total_tokens
            };
        } else if (endpointMode === "anthropic_messages") {
            return {
                promptTokens: responseBody.usage?.input_tokens,
                completionTokens: responseBody.usage?.output_tokens,
            };
        } else if (endpointMode === "gemini_generate_content") {
            return {
                promptTokens: responseBody.usageMetadata?.promptTokenCount,
                completionTokens: responseBody.usageMetadata?.candidatesTokenCount,
                totalTokens: responseBody.usageMetadata?.totalTokenCount
            };
        }
        return undefined;
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

            const res = await fetcher(url, {
                method: "POST",
                headers,
                body: JSON.stringify(bodyArgs),
            });

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
                usageTelemetry: usage
            };
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

            const res = await fetcher(url, {
                method: "POST",
                headers,
                body: JSON.stringify(bodyArgs),
            });

            if (!res.ok) {
                let errMessage = res.statusText;
                try {
                    const json = await res.json();
                    errMessage = json.error?.message || JSON.stringify(json);
                } catch { /* ignore */ }
                throw new RuntimeExecutionError(`Native HTTP Provider stream failed: ${errMessage}`, { providerId, status: res.status });
            }

            if (!res.body) {
                throw new RuntimeExecutionError("Native HTTP Provider stream body is empty", { providerId });
            }

            // Use a basic line parsing logic for SSE. (This assumes modern environments, e.g. Node 18+ Web Streams)
            const chunks = [];
            const decoder = new TextDecoder();

            if (res.body[Symbol.asyncIterator]) {
                for await (const chunk of res.body) {
                    const str = decoder.decode(chunk, { stream: true });
                    const lines = str.split("\n");
                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            const data = line.slice(6).trim();
                            if (data === "[DONE]") continue;
                            if (!data) continue;
                            try {
                                const parsed = JSON.parse(data);
                                let delta = "";
                                if (endpointMode === "chat") {
                                    delta = parsed.choices?.[0]?.delta?.content || "";
                                } else if (endpointMode === "anthropic_messages") {
                                    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                                        delta = parsed.delta.text;
                                    }
                                } else if (endpointMode === "gemini_generate_content") {
                                    delta = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
                                } else if (endpointMode === "responses") {
                                    delta = parsed.choices?.[0]?.delta?.content || "";
                                }
                                if (delta) chunks.push(delta);
                            } catch { /* ignore bad json */ }
                        }
                    }
                }
            } else {
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const str = decoder.decode(value, { stream: true });
                    const lines = str.split("\n");
                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            const data = line.slice(6).trim();
                            if (data === "[DONE]") continue;
                            if (!data) continue;
                            try {
                                const parsed = JSON.parse(data);
                                let delta = "";
                                if (endpointMode === "chat") {
                                    delta = parsed.choices?.[0]?.delta?.content || "";
                                } else if (endpointMode === "anthropic_messages") {
                                    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                                        delta = parsed.delta.text;
                                    }
                                } else if (endpointMode === "gemini_generate_content") {
                                    delta = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
                                } else if (endpointMode === "responses") {
                                    delta = parsed.choices?.[0]?.delta?.content || "";
                                }
                                if (delta) chunks.push(delta);
                            } catch { /* ignore bad json */ }
                        }
                    }
                }
            }

            if (chunks.length === 0) {
                throw new RuntimeExecutionError(`Native HTTP Stream Provider returned no chunks`, { providerId });
            }

            return {
                providerId: input.providerId,
                model: input.model,
                chunks,
            };
        },

        async embed(input) {
            if (input.providerId !== providerId) {
                throw new RuntimeExecutionError("Provider id does not match adapter logic", { expected: providerId, received: input.providerId });
            }

            let url = baseUrl;
            if (endpointMode === "openai" || endpointMode === "chat") {
                // OpenAI Embeddings API is /v1/embeddings typically. If baseUrl is /v1/chat/completions, replace it.
                url = url.replace("/chat/completions", "/embeddings");
                // fallthrough
            } else if (endpointMode === "gemini_generate_content") {
                url = `${baseUrl}/models/${input.model}:embedContent`;
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

            const res = await fetcher(url, {
                method: "POST",
                headers,
                body: JSON.stringify(bodyArgs),
            });

            if (!res.ok) {
                throw new RuntimeExecutionError("Native HTTP Provider embedding failed", { providerId, status: res.status });
            }

            const json = await res.json();
            let vector = [];
            if (endpointMode === "chat" || endpointMode === "openai") {
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
        }
    });
}
