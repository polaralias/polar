import test from "node:test";
import assert from "node:assert/strict";

import {
    classifyUserMessage,
    applyUserTurn,
    detectOfferInText,
    setOpenOffer,
    pushRecentOffer,
    computeRepairDecision,
    handleRepairSelection,
} from "../packages/polar-runtime-core/src/routing-policy-engine.mjs";


// ═══════════════════════════════════════════════════════
// A) Offer detection tests
// ═══════════════════════════════════════════════════════

test("detectOfferInText: detects 'want me to troubleshoot' as offer", () => {
    const result = detectOfferInText("I see an error. Want me to troubleshoot that for you?");
    assert.equal(result.isOffer, true);
    assert.equal(result.offerType, "troubleshoot");
    assert.ok(result.offerText);
});

test("detectOfferInText: detects 'shall I explain more' as offer", () => {
    const result = detectOfferInText("That's the summary. Shall I explain more about the routing approach?");
    assert.equal(result.isOffer, true);
    assert.equal(result.offerType, "explain");
});

test("detectOfferInText: detects 'would you like me to search' as offer", () => {
    const result = detectOfferInText("Would you like me to search for related documentation?");
    assert.equal(result.isOffer, true);
    assert.equal(result.offerType, "search");
});

test("detectOfferInText: non-offer text returns false", () => {
    const result = detectOfferInText("Here is the weather forecast for today.");
    assert.equal(result.isOffer, false);
});

test("detectOfferInText: handles null/empty gracefully", () => {
    assert.equal(detectOfferInText(null).isOffer, false);
    assert.equal(detectOfferInText("").isOffer, false);
    assert.equal(detectOfferInText(undefined).isOffer, false);
});


// ═══════════════════════════════════════════════════════
// B) Open offer state helpers
// ═══════════════════════════════════════════════════════

test("setOpenOffer: sets openOffer and pushes to recentOffers", () => {
    const thread = { id: "t1", status: "in_progress" };
    setOpenOffer(thread, { offerType: "troubleshoot", target: "fix the error", askedAtMessageId: "m1" }, 1000);
    assert.deepEqual(thread.openOffer, { offerType: "troubleshoot", target: "fix the error", askedAtMessageId: "m1" });
    assert.equal(thread.recentOffers.length, 1);
    assert.equal(thread.recentOffers[0].outcome, "pending");
});

test("pushRecentOffer: ring buffer keeps max 3", () => {
    const thread = { id: "t1", recentOffers: [] };
    for (let i = 1; i <= 5; i++) {
        pushRecentOffer(thread, { offerType: "general", askedAtMessageId: `m${i}`, timestampMs: i * 1000 });
    }
    assert.equal(thread.recentOffers.length, 3);
    assert.equal(thread.recentOffers[0].askedAtMessageId, "m3");
    assert.equal(thread.recentOffers[2].askedAtMessageId, "m5");
});


// ═══════════════════════════════════════════════════════
// C) classifyUserMessage: accept_offer / reject_offer
// ═══════════════════════════════════════════════════════

test("classifyUserMessage: short affirmative with single open offer → accept_offer", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress", openOffer: { offerType: "troubleshoot", target: "fix it", askedAtMessageId: "m1" } }
        ]
    };
    const result = classifyUserMessage({ text: "sure", sessionState });
    assert.equal(result.type, "accept_offer");
    assert.equal(result.targetThreadId, "t1");
});

test("classifyUserMessage: short negative with open offer → reject_offer", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress", openOffer: { offerType: "troubleshoot", target: "fix it", askedAtMessageId: "m1" } }
        ]
    };
    const result = classifyUserMessage({ text: "nah", sessionState });
    assert.equal(result.type, "reject_offer");
    assert.equal(result.targetThreadId, "t1");
});


// ═══════════════════════════════════════════════════════
// D) Offer reversal (change-of-mind)
// ═══════════════════════════════════════════════════════

test("offer reversal: reject then 'actually yeah' → accept_offer on same thread", () => {
    // Step 1: Set up thread with an open offer
    let sessionState = {
        activeThreadId: "t1",
        threads: [
            {
                id: "t1", status: "in_progress", slots: {},
                openOffer: { offerType: "troubleshoot", target: "fix the error", askedAtMessageId: "m1" },
                recentOffers: [{ offerType: "troubleshoot", target: "fix the error", askedAtMessageId: "m1", timestampMs: 1000, outcome: "pending" }]
            }
        ]
    };

    // Step 2: User rejects
    const rejection = classifyUserMessage({ text: "nah", sessionState });
    assert.equal(rejection.type, "reject_offer");
    sessionState = applyUserTurn({ sessionState, classification: rejection, rawText: "nah", now: () => 2000 });

    // Verify offer is rejected but kept in recentOffers
    const thread1 = sessionState.threads.find(t => t.id === "t1");
    assert.equal(thread1.openOffer, undefined);
    assert.equal(thread1.recentOffers[0].outcome, "rejected");

    // Step 3: User reverses — "actually yeah"
    const reversal = classifyUserMessage({ text: "actually yeah", sessionState, now: 3000 });
    assert.equal(reversal.type, "accept_offer", "Should classify as accept_offer on reversal");
    assert.equal(reversal.targetThreadId, "t1", "Should target the same thread");

    // Step 4: Apply the reversal
    sessionState = applyUserTurn({ sessionState, classification: reversal, rawText: "actually yeah", now: () => 3000 });
    const thread2 = sessionState.threads.find(t => t.id === "t1");
    assert.equal(thread2.status, "in_progress");
    assert.equal(thread2.recentOffers[0].outcome, "accepted");
});


// ═══════════════════════════════════════════════════════
// E) Explain more: single offer → accept_offer
// ═══════════════════════════════════════════════════════

test("explain more with single offer → accept_offer", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            {
                id: "t1", status: "in_progress",
                openOffer: { offerType: "explain", target: "explain the routing approach", askedAtMessageId: "m1" }
            }
        ]
    };
    const result = classifyUserMessage({ text: "go on", sessionState });
    assert.equal(result.type, "accept_offer");
    assert.equal(result.targetThreadId, "t1");
});

test("explain more with single offer: 'tell me more' variant", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            {
                id: "t1", status: "in_progress",
                openOffer: { offerType: "explain", target: "explain more about the error", askedAtMessageId: "m1" }
            }
        ]
    };
    const result = classifyUserMessage({ text: "tell me more", sessionState });
    assert.equal(result.type, "accept_offer");
    assert.equal(result.targetThreadId, "t1");
});

test("explain more with single offer: 'explain more' variant", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            {
                id: "t1", status: "in_progress",
                openOffer: { offerType: "explain", target: "explain more about the error", askedAtMessageId: "m1" }
            }
        ]
    };
    const result = classifyUserMessage({ text: "explain more", sessionState });
    assert.equal(result.type, "accept_offer");
    assert.equal(result.targetThreadId, "t1");
});


// ═══════════════════════════════════════════════════════
// F) Explain more: ambiguous (multiple offers) → repair
// ═══════════════════════════════════════════════════════

test("explain more with two open offers → triggers computeRepairDecision", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            {
                id: "t1", status: "in_progress",
                summary: "weather error troubleshooting",
                openOffer: { offerType: "troubleshoot", target: "troubleshoot the weather lookup", askedAtMessageId: "m1" }
            },
            {
                id: "t2", status: "in_progress",
                summary: "routing architecture discussion",
                openOffer: { offerType: "explain", target: "explain the routing approach", askedAtMessageId: "m2" }
            }
        ]
    };

    // Classify: with multiple offers, "explain more" should not resolve to a single accept
    const classification = classifyUserMessage({ text: "explain more", sessionState });
    // It falls through to new_request since it can't resolve
    // But repair decision should fire
    const repair = computeRepairDecision(sessionState, classification, "explain more");
    assert.ok(repair, "Should produce a repair decision");
    assert.equal(repair.type, "repair_question");
    assert.equal(repair.options.length, 2);
    assert.equal(repair.options[0].id, "A");
    assert.equal(repair.options[1].id, "B");
    assert.equal(repair.options[0].threadId, "t1");
    assert.equal(repair.options[1].threadId, "t2");
    assert.ok(repair.correlationId);
    assert.ok(repair.question);
});


// ═══════════════════════════════════════════════════════
// G) Repair selection
// ═══════════════════════════════════════════════════════

test("repair selection A → attaches to correct thread", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            {
                id: "t1", status: "in_progress",
                summary: "weather error",
                openOffer: { offerType: "troubleshoot", target: "troubleshoot", askedAtMessageId: "m1" },
                recentOffers: [{ offerType: "troubleshoot", askedAtMessageId: "m1", timestampMs: 1000, outcome: "pending" }]
            },
            {
                id: "t2", status: "in_progress",
                summary: "routing discussion",
                openOffer: { offerType: "explain", target: "explain routing", askedAtMessageId: "m2" },
                recentOffers: [{ offerType: "explain", askedAtMessageId: "m2", timestampMs: 1000, outcome: "pending" }]
            }
        ]
    };

    const correlationId = "test-corr-1";
    const repairContext = {
        type: "repair_question",
        correlationId,
        question: "Which topic?",
        options: [
            { id: "A", label: "Troubleshoot weather", threadId: "t1", action: "attach_to_thread" },
            { id: "B", label: "Explain routing", threadId: "t2", action: "attach_to_thread" }
        ]
    };

    const result = handleRepairSelection(sessionState, "A", correlationId, repairContext, 2000);
    assert.equal(result.activeThreadId, "t1");
    const thread1 = result.threads.find(t => t.id === "t1");
    assert.equal(thread1.status, "in_progress");
    // openOffer should be cleared after acceptance
    assert.equal(thread1.openOffer, undefined);
});

test("repair selection B → attaches to correct thread", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            {
                id: "t1", status: "in_progress",
                summary: "weather error",
                openOffer: { offerType: "troubleshoot", target: "troubleshoot", askedAtMessageId: "m1" },
                recentOffers: [{ offerType: "troubleshoot", askedAtMessageId: "m1", timestampMs: 1000, outcome: "pending" }]
            },
            {
                id: "t2", status: "in_progress",
                summary: "routing discussion",
                openOffer: { offerType: "explain", target: "explain routing", askedAtMessageId: "m2" },
                recentOffers: [{ offerType: "explain", askedAtMessageId: "m2", timestampMs: 1000, outcome: "pending" }]
            }
        ]
    };

    const correlationId = "test-corr-2";
    const repairContext = {
        type: "repair_question",
        correlationId,
        question: "Which topic?",
        options: [
            { id: "A", label: "Troubleshoot weather", threadId: "t1", action: "attach_to_thread" },
            { id: "B", label: "Explain routing", threadId: "t2", action: "attach_to_thread" }
        ]
    };

    const result = handleRepairSelection(sessionState, "B", correlationId, repairContext, 2000);
    assert.equal(result.activeThreadId, "t2");
    const thread2 = result.threads.find(t => t.id === "t2");
    assert.equal(thread2.status, "in_progress");
    assert.equal(thread2.openOffer, undefined);
});

test("repair selection with create_new_thread → creates new thread", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress", summary: "weather error" }
        ]
    };

    const correlationId = "test-corr-3";
    const repairContext = {
        type: "repair_question",
        correlationId,
        question: "Which topic?",
        options: [
            { id: "A", label: "Weather error", threadId: "t1", action: "attach_to_thread" },
            { id: "B", label: "Start something new", threadId: "new_thread", action: "create_new_thread" }
        ]
    };

    const result = handleRepairSelection(sessionState, "B", correlationId, repairContext, 2000);
    assert.equal(result.threads.length, 2, "Should have created a new thread");
    assert.notEqual(result.activeThreadId, "t1", "Active thread should be the new one");
});

test("repair selection with invalid correlation → no-op", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{ id: "t1", status: "in_progress" }]
    };

    const repairContext = {
        type: "repair_question",
        correlationId: "correct-id",
        options: [
            { id: "A", label: "A", threadId: "t1", action: "attach_to_thread" },
            { id: "B", label: "B", threadId: "t2", action: "attach_to_thread" }
        ]
    };

    const result = handleRepairSelection(sessionState, "A", "wrong-id", repairContext, 2000);
    // Should be unchanged
    assert.equal(result.activeThreadId, "t1");
});

test("repair selection with invalid choice (not A/B) → no-op", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{ id: "t1", status: "in_progress" }]
    };

    const correlationId = "test-corr-5";
    const repairContext = {
        type: "repair_question",
        correlationId,
        options: [
            { id: "A", label: "A", threadId: "t1", action: "attach_to_thread" },
            { id: "B", label: "B", threadId: "t2", action: "attach_to_thread" }
        ]
    };

    const result = handleRepairSelection(sessionState, "C", correlationId, repairContext, 2000);
    assert.equal(result.activeThreadId, "t1");
});


// ═══════════════════════════════════════════════════════
// H) applyUserTurn: accept_offer + reject_offer
// ═══════════════════════════════════════════════════════

test("applyUserTurn: accept_offer clears openOffer and marks recentOffer accepted", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{
            id: "t1", status: "in_progress", slots: {},
            openOffer: { offerType: "explain", target: "explain more", askedAtMessageId: "m1" },
            recentOffers: [{ offerType: "explain", target: "explain more", askedAtMessageId: "m1", timestampMs: 1000, outcome: "pending" }]
        }]
    };

    const classification = { type: "accept_offer", targetThreadId: "t1", offerDetail: sessionState.threads[0].openOffer };
    const result = applyUserTurn({ sessionState, classification, rawText: "sure", now: () => 2000 });
    const thread = result.threads.find(t => t.id === "t1");
    assert.equal(thread.openOffer, undefined);
    assert.equal(thread.recentOffers[0].outcome, "accepted");
    assert.equal(thread.status, "in_progress");
});

test("applyUserTurn: reject_offer clears openOffer but keeps in recentOffers as rejected", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{
            id: "t1", status: "in_progress", slots: {},
            openOffer: { offerType: "troubleshoot", target: "fix", askedAtMessageId: "m1" },
            recentOffers: [{ offerType: "troubleshoot", target: "fix", askedAtMessageId: "m1", timestampMs: 1000, outcome: "pending" }]
        }]
    };

    const classification = { type: "reject_offer", targetThreadId: "t1", offerDetail: sessionState.threads[0].openOffer };
    const result = applyUserTurn({ sessionState, classification, rawText: "nah", now: () => 2000 });
    const thread = result.threads.find(t => t.id === "t1");
    assert.equal(thread.openOffer, undefined);
    assert.equal(thread.recentOffers[0].outcome, "rejected");
});


// ═══════════════════════════════════════════════════════
// I) Edge cases: existing behaviour preserved
// ═══════════════════════════════════════════════════════

test("override still beats everything (no open offers)", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{ id: "t1", status: "waiting_for_user", pendingQuestion: { text: "Location?" } }]
    };
    const result = classifyUserMessage({ text: "ignore that", sessionState });
    assert.equal(result.type, "override");
});

test("status nudge still works", () => {
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

test("answer_to_pending still works", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "waiting_for_user", pendingQuestion: { key: "confirm", expectedType: "yes_no", text: "Confirm?" } }
        ]
    };
    const fitResult = classifyUserMessage({ text: "yep", sessionState });
    assert.equal(fitResult.type, "answer_to_pending");
});

test("no open offers: 'ok' is filler not accept_offer", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{ id: "t1", status: "in_progress" }]
    };
    // Without open offers, "ok" should not be accept_offer
    // It may be filler or new_request depending on implementation
    const result = classifyUserMessage({ text: "thanks", sessionState });
    assert.equal(result.type, "filler");
});


// ═══════════════════════════════════════════════════════
// J) Yes-normalisation: UK/chat slang variants
// ═══════════════════════════════════════════════════════

test("'ye' with open offer → accept_offer", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress", openOffer: { offerType: "troubleshoot", target: "fix it", askedAtMessageId: "m1" } }
        ]
    };
    assert.equal(classifyUserMessage({ text: "ye", sessionState }).type, "accept_offer");
});

test("'ya' with open offer → accept_offer", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress", openOffer: { offerType: "explain", target: "explain more", askedAtMessageId: "m1" } }
        ]
    };
    assert.equal(classifyUserMessage({ text: "ya", sessionState }).type, "accept_offer");
});

test("'yh' with open offer → accept_offer", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress", openOffer: { offerType: "explain", target: "more", askedAtMessageId: "m1" } }
        ]
    };
    assert.equal(classifyUserMessage({ text: "yh", sessionState }).type, "accept_offer");
});

test("'yep!' (with punctuation) with open offer → accept_offer", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress", openOffer: { offerType: "search", target: "search docs", askedAtMessageId: "m1" } }
        ]
    };
    assert.equal(classifyUserMessage({ text: "yep!", sessionState }).type, "accept_offer");
});

test("'yeee' (prefix match, ≤4 chars) with open offer → accept_offer", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [
            { id: "t1", status: "in_progress", openOffer: { offerType: "search", target: "search docs", askedAtMessageId: "m1" } }
        ]
    };
    assert.equal(classifyUserMessage({ text: "yeee", sessionState }).type, "accept_offer");
});

test("'actually ye' after rejection → accept_offer reversal", () => {
    let sessionState = {
        activeThreadId: "t1",
        threads: [{
            id: "t1", status: "in_progress", slots: {},
            openOffer: { offerType: "troubleshoot", target: "fix", askedAtMessageId: "m1" },
            recentOffers: [{ offerType: "troubleshoot", target: "fix", askedAtMessageId: "m1", timestampMs: 1000, outcome: "pending" }]
        }]
    };
    // Reject first
    const rej = classifyUserMessage({ text: "nah", sessionState });
    sessionState = applyUserTurn({ sessionState, classification: rej, rawText: "nah", now: () => 2000 });
    // Then reverse with "actually ye"
    const rev = classifyUserMessage({ text: "actually ye", sessionState, now: 3000 });
    assert.equal(rev.type, "accept_offer");
});


// ═══════════════════════════════════════════════════════
// K) Error inquiry: "what happened?" routing
// ═══════════════════════════════════════════════════════

test("'what happened' with recent lastError → error_inquiry", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{
            id: "t1", status: "failed",
            lastError: {
                correlationId: "wf1",
                extensionId: "web",
                capabilityId: "search_web",
                output: "Connection refused",
                messageId: "msg_err_1",
                timestampMs: Date.now() - 60000 // 1 minute ago
            }
        }]
    };
    const result = classifyUserMessage({ text: "what happened?", sessionState });
    assert.equal(result.type, "error_inquiry");
    assert.equal(result.targetThreadId, "t1");
    assert.equal(result.errorDetail.capabilityId, "search_web");
});

test("'why' with recent lastError → error_inquiry", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{
            id: "t1", status: "failed",
            lastError: {
                correlationId: "wf2",
                extensionId: "email",
                capabilityId: "draft_email",
                output: "SMTP timeout",
                messageId: "msg_err_2",
                timestampMs: Date.now() - 120000 // 2 minutes ago
            }
        }]
    };
    const result = classifyUserMessage({ text: "why", sessionState });
    assert.equal(result.type, "error_inquiry");
    assert.equal(result.targetThreadId, "t1");
});

test("'what happened' with expired lastError (>5min) → NOT error_inquiry", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{
            id: "t1", status: "failed",
            lastError: {
                correlationId: "wf3",
                extensionId: "web",
                capabilityId: "search_web",
                output: "Old error",
                messageId: "msg_err_3",
                timestampMs: Date.now() - 10 * 60 * 1000 // 10 minutes ago
            }
        }]
    };
    const result = classifyUserMessage({ text: "what happened?", sessionState });
    assert.notEqual(result.type, "error_inquiry");
});

test("'?' with recent lastError → error_inquiry", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{
            id: "t1", status: "failed",
            lastError: {
                correlationId: "wf4",
                extensionId: "orchestrator",
                capabilityId: "executeWorkflow",
                output: "Crash",
                messageId: "msg_err_4",
                timestampMs: Date.now() - 30000
            }
        }]
    };
    const result = classifyUserMessage({ text: "?", sessionState });
    assert.equal(result.type, "error_inquiry");
    assert.equal(result.targetThreadId, "t1");
});

test("applyUserTurn: error_inquiry reactivates failed thread", () => {
    const sessionState = {
        activeThreadId: "t2",
        threads: [
            { id: "t1", status: "failed", slots: {}, lastError: { messageId: "m1", timestampMs: Date.now() } },
            { id: "t2", status: "in_progress", slots: {} }
        ]
    };
    const classification = { type: "error_inquiry", targetThreadId: "t1" };
    const result = applyUserTurn({ sessionState, classification, rawText: "what happened", now: () => Date.now() });
    const thread = result.threads.find(t => t.id === "t1");
    assert.equal(thread.status, "in_progress");
    assert.equal(result.activeThreadId, "t1");
});

test("'what was the workflow for?' with recent lastError → error_inquiry", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{
            id: "t1", status: "failed",
            lastError: {
                runId: "run_1", workflowId: "wf1", threadId: "t1",
                extensionId: "web", capabilityId: "search_web",
                output: "Connection refused",
                messageId: "msg_err_5",
                timestampMs: Date.now() - 30000
            }
        }]
    };
    const result = classifyUserMessage({ text: "what was the workflow for?", sessionState });
    assert.equal(result.type, "error_inquiry");
    assert.equal(result.targetThreadId, "t1");
});

test("'what did you try?' with recent lastError → error_inquiry", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{
            id: "t1", status: "failed",
            lastError: {
                runId: "run_2", workflowId: "wf2", threadId: "t1",
                extensionId: "web", capabilityId: "lookup_weather",
                output: "Invalid extension request",
                messageId: "msg_err_6",
                timestampMs: Date.now() - 60000
            }
        }]
    };
    const result = classifyUserMessage({ text: "what did you try?", sessionState });
    assert.equal(result.type, "error_inquiry");
    assert.equal(result.targetThreadId, "t1");
});

test("'what failed' with recent lastError → error_inquiry", () => {
    const sessionState = {
        activeThreadId: "t1",
        threads: [{
            id: "t1", status: "failed",
            lastError: {
                runId: "run_3", workflowId: "wf3", threadId: "t1",
                extensionId: "orchestrator", capabilityId: "executeWorkflow",
                output: "Crashed", messageId: "msg_err_7",
                timestampMs: Date.now() - 10000
            }
        }]
    };
    const result = classifyUserMessage({ text: "what failed", sessionState });
    assert.equal(result.type, "error_inquiry");
    assert.equal(result.targetThreadId, "t1");
});
