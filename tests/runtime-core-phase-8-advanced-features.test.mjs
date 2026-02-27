import test from "node:test";
import assert from "node:assert/strict";
import {
    createMemoryExtractionMiddleware,
    createMemoryRecallMiddleware,
    createToolSynthesisMiddleware
} from "../packages/polar-runtime-core/src/index.mjs";

test("MemoryExtractionMiddleware triggers extraction on user message append", async () => {
    let upsertCalled = false;
    let generateCalled = false;

    const memoryGateway = {
        async upsert(req) {
            upsertCalled = true;
            assert.equal(req.sessionId, 'sess-1');
            assert.equal(req.record.fact, 'Extracted Fact');
            return { status: 'completed', memoryId: 'mem-1' };
        }
    };

    const providerGateway = {
        async generate(req) {
            generateCalled = true;
            // BUG-019 fix: provider gateway returns { text: "..." }, not { content: "..." }
            return { text: JSON.stringify({ facts: ['Extracted Fact'] }) };
        }
    };

    const middleware = createMemoryExtractionMiddleware({ memoryGateway, providerGateway });

    const context = {
        actionId: 'chat.message.append',
        input: {
            role: 'user',
            sessionId: 'sess-1',
            userId: 'user-1',
            text: 'I love London',
            messageId: 'msg-1',
            traceId: 'trace-1'
        },
        output: { status: 'appended' }
    };

    await middleware.after(context);

    // Wait a bit for background task
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.ok(generateCalled, "ProviderGateway.generate should have been called for extraction");
    assert.ok(upsertCalled, "MemoryGateway.upsert should have been called with extracted facts");
});

test("MemoryRecallMiddleware injects facts into the prompt", async () => {
    const memoryGateway = {
        async search(req) {
            return {
                status: 'completed',
                records: [
                    { record: { fact: 'User lives in London' } }
                ]
            };
        }
    };

    const middleware = createMemoryRecallMiddleware({ memoryGateway });

    const messages = [
        { role: 'user', content: 'What is the weather?' }
    ];
    const context = {
        actionId: 'provider.generate',
        input: {
            sessionId: 'sess-1',
            userId: 'user-1',
            messages
        }
    };

    await middleware.before(context);

    // BUG-008 fix: Messages are now cloned and replaced on context.input immutably
    // The original messages array should NOT be mutated
    assert.equal(messages.length, 1, "Original messages array should not be mutated");

    // The cloned messages on context.input should have the system message prepended
    assert.equal(context.input.messages.length, 2, "A system message should have been prepended to cloned messages");
    assert.ok(context.input.messages[0].content.includes('User lives in London'), "Retrieved facts should be in the system prompt");
});

test("ToolSynthesisMiddleware prunes toolset for complex requests", async () => {
    const providerGateway = {
        async generate(req) {
            // BUG-020 fix: provider gateway returns { text: "..." }, not { content: "..." }
            return { text: JSON.stringify({ selectedToolIds: ['tool-1'] }) };
        }
    };

    const middleware = createToolSynthesisMiddleware({ providerGateway });

    const tools = [
        { id: 'tool-1', description: 'desc 1' },
        { id: 'tool-2', description: 'desc 2' },
        { id: 'tool-3', description: 'desc 3' },
        { id: 'tool-4', description: 'desc 4' }
    ];

    const originalTools = [...tools]; // Keep reference to original

    const context = {
        actionId: 'provider.generate',
        input: {
            traceId: 'trace-1',
            messages: [{ role: 'user', content: 'Use tool 1 please' }],
            tools: [...tools]
        }
    };

    await middleware.before(context);

    // BUG-009 fix: context.input is replaced immutably, not mutated
    assert.equal(context.input.tools.length, 1, "Toolset should be pruned to 1 tool");
    assert.equal(context.input.tools[0].id, 'tool-1', "Pruned toolset should contain the selected tool");
});
