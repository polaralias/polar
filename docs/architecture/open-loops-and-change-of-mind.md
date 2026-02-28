# Open Loops And Change-Of-Mind Handling

Last updated: 2026-02-28

## Purpose
This document clarifies how Polar maintains conversational continuity for:
- short follow-ups (“more”, “that”, “go on”)
- status nudges (“any luck?”)
- reversals (“nah … actually yes”)

The key concept is **open loops**: explicit conversational states that humans naturally respond to. By tracking open loops in code, we avoid brittle keyword logic and avoid spending tokens on a separate routing LLM step.

This is a clarification / addendum to:
- `docs/architecture/deterministic-orchestration-architecture.md`

---

## Definitions

### Open loop types
An open loop is a state that implies the next user turn is likely attached to it.

Minimum required types:
1) **Pending question**
   - assistant asked for missing info (slot fill)
   - eg “Which location?”

2) **In-flight action**
   - a workflow/tool call is running
   - eg “Fetching weather now…”

3) **Open offer**
   - assistant offered an optional next step
   - eg “Want me to troubleshoot that error?”
   - eg “Want me to explain more?”

4) **Awaiting approval**
   - `workflow_proposed` state
   - user must approve/reject

---

## State representation (per thread)
Each micro-thread may include:

- `pendingQuestion`: `{ key, expectedType, askedAtMessageId }`
- `inFlight`: `{ kind, startedAt, correlationId }`
- `openOffer`: `{ offerType, target, askedAtMessageId }`
- `awaitingApproval`: `{ workflowId, proposedAtMessageId }`

Additionally, keep a small `recentOffers` ring buffer (eg last 3 offers) per thread to support change-of-mind.

---

## Routing rules using open loops (code-only)

### A) “Answer to pending” (slot fill)
If `pendingQuestion` exists on the active thread:
- Attach the next message as an answer **only if it fits** `expectedType`
  - location: short noun phrase, city/postcode-like
  - yes/no: matches yes/no set
  - date/time: date/time-like tokens
  - freeform: anything, but only when no other open loop exists

If it does not fit, consider it a new request or trigger repair.

### B) Status nudges
If any thread is `in_flight` or `blocked`:
- Messages like “any luck?”, “update?”, “?”, “hello?” attach to the most recent in-flight/blocked thread.
- This rule has higher priority than answering a pending question in another thread.

### C) Open offers
If the assistant made an offer recently:
- Short affirmative responses should accept the offer:
  - “yeah”, “ok”, “go on”, “sure”
- Short negative responses reject the offer:
  - “nah”, “no”, “leave it”
- Store the offer outcome but keep the offer in `recentOffers` briefly.

### D) Change-of-mind / reversal
If a user previously rejected an offer, but then responds soon after with an affirmative follow-up:
- Treat as accepting the most recent offer in the active thread.
- This should not require an LLM call.

This covers:
- “Nah that’s ok”
- “Actually yeah can you explain more?”

The second message attaches back to the prior offer.

---

## Avoiding brittle keyword soup
We do not rely on single keywords. We rely on:
- open loop state (hard context)
- message shape (length, punctuation, yes/no normalisation)
- recency (time since last offer/question)
- confidence margins (when ambiguous, use repair)

A small stable list for yes/no normalisation is acceptable; it should not be treated as the primary routing signal.

---

## Acceptance criteria
- “Actually yes / go on” after a recent offer continues the same thread without asking “what topic?”
- “Explain more” defaults to the most recent open offer when only one plausible offer exists.
- “Any luck?” attaches to the last in-flight task.
- When ambiguous across two open offers, trigger repair with buttons (see `routing-repair-and-disambiguation.md`).
