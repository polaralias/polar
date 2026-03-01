import test from "node:test";
import assert from "node:assert/strict";
import { createNativeHttpAdapter } from "../packages/polar-adapter-native/src/index.mjs";

test("creates chat request correctly", async () => {
    let fetchArgs = null;
    const adapter = createNativeHttpAdapter({
        providerId: "openai_chat",
        endpointMode: "chat",
        baseUrl: "https://api.openai.com/v1/chat/completions",
        apiKey: "test-key",
        capabilities: { supportsNativeThinkingControl: true },
        fetcher: async (url, init) => {
            fetchArgs = { url, init };
            return {
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: "hello world" } }],
                    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
                })
            };
        }
    });

    const result = await adapter.generate({
        providerId: "openai_chat",
        model: "gpt-4",
        prompt: "test prompt",
        system: "you are a bot",
        temperature: 0.5,
        thinkingEnabled: true
    });

    assert.equal(result.text, "hello world");
    assert.equal(result.usage.totalTokens, 15);

    assert.equal(fetchArgs.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(fetchArgs.init.headers["Authorization"], "Bearer test-key");
    const body = JSON.parse(fetchArgs.init.body);
    assert.deepEqual(body.messages, [
        { role: "system", content: "you are a bot" },
        { role: "user", content: "test prompt" }
    ]);
    assert.equal(body.temperature, 0.5);
    // Since stateful responses is not true, thinking enabled becomes enable_thinking for sglang style backwards compat if enabled.
    assert.equal(body.enable_thinking, true);
});

test("creates anthropic request correctly", async () => {
    let fetchArgs = null;
    const adapter = createNativeHttpAdapter({
        providerId: "anthropic",
        endpointMode: "anthropic_messages",
        baseUrl: "https://api.anthropic.com/v1/messages",
        apiKey: "anthropic-key",
        fetcher: async (url, init) => {
            fetchArgs = { url, init };
            return {
                ok: true,
                json: async () => ({
                    content: [{ type: "text", text: "claude response" }],
                    usage: { input_tokens: 12, output_tokens: 8 }
                })
            };
        }
    });

    const result = await adapter.generate({
        providerId: "anthropic",
        model: "claude-3",
        prompt: "hi",
        system: "sys",
        maxOutputTokens: 1000,
        thinkingEnabled: true,
        thinkingBudget: 500
    });

    assert.equal(result.text, "claude response");
    assert.equal(result.usage.promptTokens, 12);

    assert.equal(fetchArgs.url, "https://api.anthropic.com/v1/messages");
    assert.equal(fetchArgs.init.headers["x-api-key"], "anthropic-key");
    assert.equal(fetchArgs.init.headers["anthropic-version"], "2024-10-22");

    const body = JSON.parse(fetchArgs.init.body);
    assert.equal(body.system, "sys");
    assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
    assert.equal(body.max_tokens, 1000);
    assert.deepEqual(body.thinking, { type: "enabled", budget_tokens: 500 });
});

test("creates gemini request correctly", async () => {
    let fetchArgs = null;
    const adapter = createNativeHttpAdapter({
        providerId: "gemini",
        endpointMode: "gemini_generate_content",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        apiKey: "gemini-key",
        fetcher: async (url, init) => {
            fetchArgs = { url, init };
            return {
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: "gemini response" }] } }]
                })
            };
        }
    });

    const result = await adapter.generate({
        providerId: "gemini",
        model: "gemini-1.5-pro",
        prompt: "hello",
        system: "sys gen",
        thinkingEnabled: true,
        thinkingLevel: "HIGH"
    });

    assert.equal(result.text, "gemini response");
    assert.equal(fetchArgs.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent");
    assert.equal(fetchArgs.init.headers["x-goog-api-key"], "gemini-key");

    const body = JSON.parse(fetchArgs.init.body);
    assert.deepEqual(body.systemInstruction, { parts: [{ text: "sys gen" }] });
    assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "hello" }] }]);
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: "HIGH" });
});

test("creates responses API request correctly", async () => {
    let fetchArgs = null;
    const adapter = createNativeHttpAdapter({
        providerId: "responses",
        endpointMode: "responses",
        baseUrl: "http://localhost:11434/v1/responses",
        capabilities: { supportsOpenAIReasoningObject: true, supportsOpenAIVerbosity: true },
        fetcher: async (url, init) => {
            fetchArgs = { url, init };
            return {
                ok: true,
                json: async () => ({
                    output: [
                        {
                            type: "message",
                            role: "assistant",
                            content: [{ type: "output_text", text: "responses result" }]
                        }
                    ],
                    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
                })
            };
        }
    });

    const result = await adapter.generate({
        providerId: "responses",
        model: "qwen2",
        prompt: "yo",
        system: "sys rep",
        reasoningEffort: "high",
        reasoningSummary: "detailed",
        verbosity: "low"
    });

    assert.equal(result.text, "responses result");
    const body = JSON.parse(fetchArgs.init.body);
    assert.deepEqual(body.input, [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "sys rep" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "yo" }] }
    ]);
    assert.deepEqual(body.reasoning, { effort: "high", summary: "detailed" });
    assert.deepEqual(body.text, { verbosity: "low" });
});

test("responses API maps assistant history content to output_text", async () => {
    let fetchArgs = null;
    const adapter = createNativeHttpAdapter({
        providerId: "responses",
        endpointMode: "responses",
        baseUrl: "http://localhost:11434/v1/responses",
        fetcher: async (url, init) => {
            fetchArgs = { url, init };
            return {
                ok: true,
                json: async () => ({
                    output: [
                        {
                            type: "message",
                            role: "assistant",
                            content: [{ type: "output_text", text: "ok" }]
                        }
                    ]
                })
            };
        }
    });

    await adapter.generate({
        providerId: "responses",
        model: "qwen2",
        prompt: "continue",
        messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "previous reply" }
        ]
    });

    const body = JSON.parse(fetchArgs.init.body);
    assert.deepEqual(body.input, [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "previous reply" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] }
    ]);
});
