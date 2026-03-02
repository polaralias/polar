import test from "node:test";
import assert from "node:assert/strict";

import { classifyUserMessage, applyUserTurn, selectReplyAnchor, resolveFocusContext } from "../packages/polar-runtime-core/src/routing-policy-engine.mjs";

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

    // 2. Multiple active threads WITHOUT a concrete anchor -> no inline reply (stricter policy)
    const s2 = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress" },
            { id: "t2", status: "blocked" }
        ]
    };
    assert.equal(selectReplyAnchor({ sessionState: s2, classification: { type: "new_request" } }).useInlineReply, false);

    // 3. Override with concrete anchor (pending question) -> inline reply
    const s3 = {
        activeThreadId: "t1",
        threads: [{ id: "t1", status: "waiting_for_user", pendingQuestion: { text: "Y/N?", askedAtMessageId: "m1" } }]
    };
    const c3 = { type: "override", targetThreadId: "t1" };
    const a3 = selectReplyAnchor({ sessionState: s3, classification: c3 });
    assert.equal(a3.useInlineReply, true);
    assert.equal(a3.anchorMessageId, "m1");

    // 4. Error inquiry with lastError anchor -> inline reply
    const s4 = {
        activeThreadId: "t1",
        threads: [{ id: "t1", status: "failed", lastError: { messageId: "msg_err_1", capabilityId: "search_web" } }]
    };
    const c4 = { type: "error_inquiry", targetThreadId: "t1" };
    const a4 = selectReplyAnchor({ sessionState: s4, classification: c4 });
    assert.equal(a4.useInlineReply, true);
    assert.equal(a4.anchorMessageId, "msg_err_1");

    // 5. Topic switch to thread WITH a pending question -> inline reply
    const s5 = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress" },
            { id: "t2", status: "waiting_for_user", pendingQuestion: { text: "Where?", askedAtMessageId: "m2" } }
        ]
    };
    const c5 = { type: "status_nudge", targetThreadId: "t2" };
    const a5 = selectReplyAnchor({ sessionState: s5, classification: c5 });
    assert.equal(a5.useInlineReply, true);
    assert.equal(a5.anchorMessageId, "m2");

    // 6. Topic switch to thread WITHOUT a pending question -> no inline reply (no anchor)
    const s6 = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress" },
            { id: "t2", status: "blocked" }
        ]
    };
    const c6 = { type: "status_nudge", targetThreadId: "t2" };
    assert.equal(selectReplyAnchor({ sessionState: s6, classification: c6 }).useInlineReply, false);
});


test("focus resolver prioritizes reply anchor over lane recency", () => {
    const sessionState = {
        activeThreadId: "t2",
        threads: [
            { id: "t1", status: "waiting_for_user", laneThreadKey: "topic:1", pendingQuestion: { askedAtMessageId: "m-older", text: "Retry tool?" }, lastActivityTs: 10 },
            { id: "t2", status: "in_progress", laneThreadKey: "topic:1", summary: "Draft email to Alex", lastActivityTs: 20 }
        ]
    };
    const focus = resolveFocusContext({
        sessionState,
        laneThreadKey: "topic:1",
        replyToMessageId: "m-older",
    });
    assert.equal(focus.focusThreadId, "t1");
    assert.equal(focus.source, "reply_anchor");
});

test("pending slot applies only on expected type and clears on mismatch", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "waiting_for_user", laneThreadKey: "topic:42", slots: {}, pendingQuestion: { key: "location", expectedType: "location", text: "Which city?" }, lastActivityTs: 100 }
        ]
    };

    const fit = classifyUserMessage({ text: "Swansea", sessionState, laneThreadKey: "topic:42" });
    assert.equal(fit.type, "answer_to_pending");

    const mismatch = classifyUserMessage({ text: "do that via sub-agent", sessionState, laneThreadKey: "topic:42" });
    assert.equal(mismatch.type, "new_request");
    assert.equal(mismatch.clearPendingThreadId, "t1");

    const next = applyUserTurn({ sessionState, classification: mismatch, rawText: "do that via sub-agent", laneThreadKey: "topic:42", now: 200 });
    const thread = next.threads.find((entry) => entry.id === "t1");
    assert.equal(thread.pendingQuestion, undefined);
});

test("focus context lane recency keeps 'that' on latest lane task", () => {
    const sessionState = {
        activeThreadId: "old",
        threads: [
            {
                id: "old",
                status: "waiting_for_user",
                laneThreadKey: "topic:9",
                pendingQuestion: { key: "confirm", expectedType: "yes_no", text: "Retry failed weather tool?", askedAtMessageId: "m-retry" },
                lastActivityTs: 100,
            },
            {
                id: "latest",
                status: "in_progress",
                laneThreadKey: "topic:9",
                summary: "Send update email",
                lastActivityTs: 200,
            },
        ],
    };

    const classification = classifyUserMessage({
        text: "do that via sub-agent",
        sessionState,
        laneThreadKey: "topic:9",
    });
    assert.equal(classification.focusContext.focusThreadId, "latest");
    assert.equal(classification.focusContext.focusAnchorTextSnippet, "Send update email");
});
