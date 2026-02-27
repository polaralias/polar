import test from "node:test";
import assert from "node:assert/strict";
import { createTelegramIngressAdapter } from "../packages/polar-adapter-channels/src/index.mjs";
import { createNativeHttpAdapter } from "../packages/polar-adapter-native/src/index.mjs";
import { createCryptoVault } from "../packages/polar-runtime-core/src/crypto-vault.mjs";
import {
    createMemoryExtractionMiddleware,
    createMemoryRecallMiddleware,
    createToolSynthesisMiddleware,
    createBudgetMiddleware,
} from "../packages/polar-runtime-core/src/index.mjs";

// ========================================================================
// BUG-001: Responses API stream parsing (response.output_text.delta)
// ========================================================================
test("BUG-001: Responses API stream correctly parses response.output_text.delta events", async () => {
    const adapter = createNativeHttpAdapter({
        providerId: "openai",
        endpointMode: "responses",
        baseUrl: "https://api.openai.com/v1/responses",
        apiKey: "test-key",
        fetcher: async () => {
            // Simulate SSE stream with Responses API format
            const events = [
                'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
                'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
                'data: {"type":"response.completed"}\n\n',
                'data: [DONE]\n\n'
            ];
            const encoder = new TextEncoder();
            const chunks = events.map(e => encoder.encode(e));
            let idx = 0;
            return {
                ok: true,
                body: {
                    [Symbol.asyncIterator]() {
                        return {
                            next() {
                                if (idx < chunks.length) {
                                    return Promise.resolve({ value: chunks[idx++], done: false });
                                }
                                return Promise.resolve({ done: true });
                            }
                        };
                    }
                }
            };
        }
    });

    const result = await adapter.stream({
        providerId: "openai",
        model: "gpt-4o",
        prompt: "Hi"
    });

    assert.deepEqual(result.chunks, ["Hello", " world"]);
});

// ========================================================================
// BUG-018: SSE line buffering across chunk boundaries
// ========================================================================
test("BUG-018: SSE parser buffers incomplete lines across network chunks", async () => {
    const adapter = createNativeHttpAdapter({
        providerId: "openai",
        endpointMode: "chat",
        baseUrl: "https://api.openai.com/v1/chat/completions",
        apiKey: "test-key",
        fetcher: async () => {
            const encoder = new TextEncoder();
            // Simulate a data line split across two network chunks
            const chunk1 = encoder.encode('data: {"choices":[{"delta":{"content":"Hel');
            const chunk2 = encoder.encode('lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n');
            const chunks = [chunk1, chunk2];
            let idx = 0;
            return {
                ok: true,
                body: {
                    [Symbol.asyncIterator]() {
                        return {
                            next() {
                                if (idx < chunks.length) {
                                    return Promise.resolve({ value: chunks[idx++], done: false });
                                }
                                return Promise.resolve({ done: true });
                            }
                        };
                    }
                }
            };
        }
    });

    const result = await adapter.stream({
        providerId: "openai",
        model: "gpt-4",
        prompt: "Hi"
    });

    assert.deepEqual(result.chunks, ["Hello", " world"]);
});

// ========================================================================
// BUG-015: Embed supports responses endpointMode
// ========================================================================
test("BUG-015: embed() works with responses endpointMode", async () => {
    let capturedUrl = null;
    const adapter = createNativeHttpAdapter({
        providerId: "openai",
        endpointMode: "responses",
        baseUrl: "https://api.openai.com/v1/responses",
        apiKey: "test-key",
        fetcher: async (url) => {
            capturedUrl = url;
            return {
                ok: true,
                json: async () => ({
                    data: [{ embedding: [0.1, 0.2, 0.3] }]
                })
            };
        }
    });

    const result = await adapter.embed({
        providerId: "openai",
        model: "text-embedding-3-small",
        text: "test text"
    });

    assert.equal(capturedUrl, "https://api.openai.com/v1/embeddings");
    assert.deepEqual(result.vector, [0.1, 0.2, 0.3]);
});

// ========================================================================
// BUG-036: Updated Anthropic version header
// ========================================================================
test("BUG-036: Anthropic version header is 2024-10-22", async () => {
    let capturedHeaders = null;
    const adapter = createNativeHttpAdapter({
        providerId: "anthropic",
        endpointMode: "anthropic_messages",
        baseUrl: "https://api.anthropic.com/v1/messages",
        apiKey: "test-key",
        fetcher: async (url, init) => {
            capturedHeaders = init.headers;
            return {
                ok: true,
                json: async () => ({
                    content: [{ type: "text", text: "response" }]
                })
            };
        }
    });

    await adapter.generate({
        providerId: "anthropic",
        model: "claude-3",
        prompt: "test"
    });

    assert.equal(capturedHeaders["anthropic-version"], "2024-10-22");
});

// ========================================================================
// Telegram reply-to threadId derivation
// ========================================================================
test("Telegram normalizer derives threadId from replyToMessageId", () => {
    const adapter = createTelegramIngressAdapter({ now: () => 1000 });
    const envelope = adapter.normalize({
        chatId: "123",
        fromId: "456",
        text: "reply text",
        messageId: "789",
        replyToMessageId: "100",
        timestampMs: 1000
    });

    assert.equal(envelope.threadId, "telegram:reply:123:100");
    assert.equal(envelope.metadata.replyToMessageId, "100");
});

test("Telegram normalizer prefers messageThreadId over replyToMessageId for topics", () => {
    const adapter = createTelegramIngressAdapter({ now: () => 1000 });
    const envelope = adapter.normalize({
        chatId: "123",
        fromId: "456",
        text: "topic reply",
        messageId: "789",
        messageThreadId: "50",
        replyToMessageId: "100",
        timestampMs: 1000
    });

    assert.equal(envelope.threadId, "telegram:topic:123:50");
});

// ========================================================================
// BUG-008: Memory recall doesn't mutate original messages
// ========================================================================
test("BUG-008: Memory recall does not mutate frozen/original messages", async () => {
    const memoryGateway = {
        async search() {
            return {
                status: 'completed',
                records: [{ record: { fact: 'Test fact' } }]
            };
        }
    };

    const middleware = createMemoryRecallMiddleware({ memoryGateway });
    const originalMessages = Object.freeze([
        Object.freeze({ role: 'user', content: 'Hello' })
    ]);

    const context = {
        actionId: 'provider.generate',
        input: { sessionId: 's', userId: 'u', messages: originalMessages }
    };

    // Should not throw even though messages are frozen
    await middleware.before(context);

    // Original should be untouched
    assert.equal(originalMessages.length, 1);
    // Context.input should have new messages
    assert.equal(context.input.messages.length, 2);
    assert.notStrictEqual(context.input.messages, originalMessages);
});

// ========================================================================
// BUG-009: Tool synthesis doesn't mutate frozen input
// ========================================================================
test("BUG-009: Tool synthesis does not mutate frozen context.input", async () => {
    const providerGateway = {
        async generate() {
            return { text: JSON.stringify({ selectedToolIds: ['t1'] }) };
        }
    };

    const middleware = createToolSynthesisMiddleware({ providerGateway });
    const originalInput = Object.freeze({
        traceId: 'trace',
        messages: [{ role: 'user', content: 'Use t1' }],
        tools: Object.freeze([
            Object.freeze({ id: 't1', description: 'Tool 1' }),
            Object.freeze({ id: 't2', description: 'Tool 2' }),
            Object.freeze({ id: 't3', description: 'Tool 3' }),
            Object.freeze({ id: 't4', description: 'Tool 4' }),
        ])
    });

    const context = {
        actionId: 'provider.generate',
        input: originalInput
    };

    // Should not throw even though input is frozen
    await middleware.before(context);

    // Original input's tools should be unchanged
    assert.equal(originalInput.tools.length, 4);
    // Context.input should be a new object with pruned tools
    assert.equal(context.input.tools.length, 1);
    assert.notStrictEqual(context.input, originalInput);
});

// ========================================================================
// BUG-024: Budget middleware after hook doesn't crash on recording failure
// ========================================================================
test("BUG-024: Budget middleware after hook handles recording failures gracefully", async () => {
    const budgetGateway = {
        async checkBudget() {
            return { isBlocked: false, remainingBudgetUsd: 100 };
        },
        async recordUsage() {
            throw new Error("Recording DB is down");
        }
    };

    const middleware = createBudgetMiddleware({ budgetGateway });
    const context = {
        actionId: 'provider.generate',
        output: { costUsd: 0.01 },
        input: {}
    };

    // Should not throw even though recordUsage fails
    await assert.doesNotReject(async () => {
        await middleware.after(context);
    });
});

// ========================================================================
// BUG-025: CryptoVault case-insensitive field detection
// ========================================================================
test("BUG-025: CryptoVault encrypts fields regardless of case", () => {
    const vault = createCryptoVault();
    const input = {
        API_KEY: "my-secret-1",
        apikey: "my-secret-2",
        MyToken: "my-secret-3",
        MYSECRET: "my-secret-4",
        PASSWORD: "my-secret-5",
        normalField: "not-a-secret"
    };

    const encrypted = vault.encryptSecretsInObject(input);

    // All secret fields should be encrypted (start with vault:v1:)
    assert.ok(encrypted.API_KEY.startsWith("vault:v1:"), "API_KEY should be encrypted");
    assert.ok(encrypted.apikey.startsWith("vault:v1:"), "apikey should be encrypted");
    assert.ok(encrypted.MyToken.startsWith("vault:v1:"), "MyToken should be encrypted");
    assert.ok(encrypted.MYSECRET.startsWith("vault:v1:"), "MYSECRET should be encrypted");
    assert.ok(encrypted.PASSWORD.startsWith("vault:v1:"), "PASSWORD should be encrypted");
    assert.equal(encrypted.normalField, "not-a-secret", "Non-secret fields should not be encrypted");
});

// ========================================================================
// BUG-026: CryptoVault clear error message for Buffer key
// ========================================================================
test("BUG-026: CryptoVault provides clear error for wrong-size Buffer key", () => {
    const badKey = Buffer.alloc(16); // 16 bytes instead of 32
    assert.throws(() => {
        createCryptoVault({ masterKey: badKey });
    }, (err) => {
        return err.message.includes("exactly 32 bytes") && err.message.includes("16 bytes");
    });
});

// ========================================================================
// BUG-004/005/006: Middleware logs errors instead of silent swallow
// ========================================================================
test("BUG-004: Memory extraction logs error on provider failure", async () => {
    const logs = [];
    const originalWarn = console.warn;
    console.warn = (...args) => logs.push(args.join(' '));

    try {
        const middleware = createMemoryExtractionMiddleware({
            memoryGateway: { async upsert() { } },
            providerGateway: {
                async generate() { throw new Error("Provider down"); }
            }
        });

        await middleware.after({
            actionId: 'chat.message.append',
            input: { role: 'user', sessionId: 's', userId: 'u', text: 'hello', traceId: 't', messageId: 'm' },
            output: { status: 'appended' }
        });

        await new Promise(resolve => setTimeout(resolve, 50));
        assert.ok(logs.some(l => l.includes('[memory-extraction]') && l.includes('Provider down')));
    } finally {
        console.warn = originalWarn;
    }
});

test("BUG-005: Memory recall logs error on search failure", async () => {
    const logs = [];
    const originalWarn = console.warn;
    console.warn = (...args) => logs.push(args.join(' '));

    try {
        const middleware = createMemoryRecallMiddleware({
            memoryGateway: {
                async search() { throw new Error("Search failed"); }
            }
        });

        await middleware.before({
            actionId: 'provider.generate',
            input: {
                sessionId: 's', userId: 'u',
                messages: [{ role: 'user', content: 'hello' }]
            }
        });

        assert.ok(logs.some(l => l.includes('[memory-recall]') && l.includes('Search failed')));
    } finally {
        console.warn = originalWarn;
    }
});

test("BUG-006: Tool synthesis logs error on planning failure", async () => {
    const logs = [];
    const originalWarn = console.warn;
    console.warn = (...args) => logs.push(args.join(' '));

    try {
        const middleware = createToolSynthesisMiddleware({
            providerGateway: {
                async generate() { throw new Error("Planning failed"); }
            }
        });

        const tools = [
            { id: 't1', description: 'Tool 1' },
            { id: 't2', description: 'Tool 2' },
            { id: 't3', description: 'Tool 3' },
            { id: 't4', description: 'Tool 4' },
        ];

        await middleware.before({
            actionId: 'provider.generate',
            input: {
                traceId: 't',
                messages: [{ role: 'user', content: 'Do something' }],
                tools: [...tools]
            }
        });

        assert.ok(logs.some(l => l.includes('[tool-synthesis]') && l.includes('Planning failed')));
    } finally {
        console.warn = originalWarn;
    }
});

// ========================================================================
// BUG-019/020: Provider gateway returns .text not .content
// ========================================================================
test("BUG-019: Memory extraction correctly reads .text from provider response", async () => {
    let upsertedFact = null;
    const middleware = createMemoryExtractionMiddleware({
        memoryGateway: {
            async upsert(req) {
                upsertedFact = req.record.fact;
                return { memoryId: 'mem-1' };
            }
        },
        providerGateway: {
            async generate() {
                // Provider returns { text: "..." } not { content: "..." }
                return { text: JSON.stringify({ facts: ['User prefers dark mode'] }) };
            }
        }
    });

    await middleware.after({
        actionId: 'chat.message.append',
        input: { role: 'user', sessionId: 's', userId: 'u', text: 'I prefer dark mode', traceId: 't', messageId: 'm' },
        output: { status: 'appended' }
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(upsertedFact, 'User prefers dark mode');
});
