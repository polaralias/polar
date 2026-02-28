import test from "node:test";
import assert from "node:assert/strict";

import { classifyUserMessage, applyUserTurn, selectReplyAnchor } from "../packages/polar-runtime-core/src/routing-policy-engine.mjs";

test("routing-policy-engine override beats everything", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "waiting_for_user", pendingQuestion: { text: "Location?" } }
        ]
    };
    const result = classifyUserMessage({ text: "Actually, ignore that", sessionState });
    assert.equal(result.type, "override");
    assert.equal(result.targetThreadId, "t1");
});

test("routing-policy-engine status nudge attaches to last in_progress/blocked thread", () => {
    const sessionState = {
        activeThreadId: "t2",
        threads: [
            { id: "t1", status: "in_progress" },
            { id: "t2", status: "waiting_for_user", pendingQuestion: { text: "Destination?" } }
        ]
    };
    const result = classifyUserMessage({ text: "any luck?", sessionState });
    assert.equal(result.type, "status_nudge");
    assert.equal(result.targetThreadId, "t1");
});

test("routing-policy-engine answer_to_pending fit check prevents mis-attachment", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "waiting_for_user", pendingQuestion: { key: "confirm", expectedType: "yes_no", text: "Confirm?" } }
        ]
    };
    // "Maybe tomorrow" doesn't fit yes_no, should fall through to new_request
    const result = classifyUserMessage({ text: "Maybe tomorrow", sessionState });
    assert.notEqual(result.type, "answer_to_pending");
    assert.equal(result.type, "new_request");

    // Fit check success
    const fitResult = classifyUserMessage({ text: "yep", sessionState });
    assert.equal(fitResult.type, "answer_to_pending");
});

test("routing-policy-engine selectReplyAnchor rules", () => {
    // 1. Single active thread, no repair -> no inline
    const s1 = {
        activeThreadId: "t1",
        threads: [{ id: "t1", status: "in_progress" }]
    };
    assert.equal(selectReplyAnchor({ sessionState: s1, classification: { type: "new_request" } }).useInlineReply, false);

    // 2. Multiple active threads -> inline reply
    const s2 = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress" },
            { id: "t2", status: "blocked" }
        ]
    };
    assert.equal(selectReplyAnchor({ sessionState: s2, classification: { type: "new_request" } }).useInlineReply, true);

    // 3. Repair/Override -> inline reply
    const s3 = {
        activeThreadId: "t1",
        threads: [{ id: "t1", status: "waiting_for_user", pendingQuestion: { text: "Y/N?", askedAtMessageId: "m1" } }]
    };
    const c3 = { type: "override", targetThreadId: "t1" };
    const a3 = selectReplyAnchor({ sessionState: s3, classification: c3 });
    assert.equal(a3.useInlineReply, true);
    assert.equal(a3.anchorMessageId, "m1");
});
