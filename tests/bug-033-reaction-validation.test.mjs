import test from 'node:test';
import assert from 'node:assert/strict';
import { handleReactionUpdate } from '../packages/polar-bot-runner/src/reaction-handler.mjs';

test('handleReactionUpdate returns early for malformed payloads without crashing', async (t) => {
    const malformedPayloads = [
        {},
        { update: {} },
        { update: { message_reaction: {} } },
        { update: { message_reaction: { chat: {} } } },
        { update: { message_reaction: { chat: { id: 123 } } } },
        { update: { message_reaction: { message_id: 456 } } },
        { update: { message_reaction: { chat: { id: 123 }, message_id: 456 } } },
        { update: { message_reaction: { chat: { id: 123 }, message_id: 456, new_reaction: [] } } },
        {
            update: {
                message_reaction: {
                    chat: { id: 123 },
                    message_id: 456,
                    new_reaction: [{ type: 'emoji' }]
                }
            }
        },
        {
            update: {
                message_reaction: {
                    chat: { id: 123 },
                    message_id: 456,
                    new_reaction: [{ type: 'emoji', emoji: '' }]
                }
            }
        },
    ];

    const controlPlane = {
        getSessionHistory: async () => { throw new Error("Should not reach here"); },
        recordFeedbackEvent: async () => { throw new Error("Should not reach here"); }
    };

    for (const payload of malformedPayloads) {
        const ctx = payload;
        await assert.doesNotReject(async () => {
            await handleReactionUpdate(ctx, { controlPlane });
        }, `Should not crash for payload: ${JSON.stringify(payload)}`);
    }
});
