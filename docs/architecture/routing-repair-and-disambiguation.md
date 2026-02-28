# Routing Repair And Disambiguation

Last updated: 2026-02-28

## Purpose
This document defines how Polar handles **ambiguous user messages** without reverting to prompt-driven routing. It describes a deterministic “repair” mechanism using **button-based disambiguation** (ideal for Telegram), where **code remains authoritative** and the LLM is used only for wording.

This is a clarification / addendum to:
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/architecture/chat-routing-and-multi-agent.md`

---

## Design principles

### Model does not decide routing
- **Code** decides:
  - when a repair is necessary
  - which attachment options are valid (A/B)
  - how the user’s choice updates session state

- The **LLM** may:
  - generate the phrasing of the repair question
  - produce short option labels, constrained to the options chosen by code

If the model can ignore a rule and the system breaks, the rule belongs in code.

---

## When to trigger repair (code-only)
The RoutingPolicyEngine must compute, per incoming user message:
- top candidate attachment (thread + message_type)
- runner-up candidate attachment
- a confidence signal (eg score margin)

Trigger repair only when:
1) Two or more attachments are plausibly valid, AND
2) The score margin is below a threshold, OR
3) The message is low-information (“more”, “that”, “yeah”, “ok”, “?”) AND multiple “open loops” exist

**Do not** trigger repair when:
- only one open loop exists (pending question, in-flight task, open offer)
- a status nudge clearly targets the most recent in-progress task
- override cues clearly apply to the active thread

---

## What repair looks like in the product

### Output shape
When repair is required, the orchestrator returns a typed response that the client renders as a message with buttons:

- `type`: `repair_question`
- `question`: user-facing string
- `options`: **exactly two** options (A/B), each with:
  - `id`: `"A"` or `"B"` (fixed)
  - `label`: short user-facing label
  - `threadId`: the target thread id (or `"new_thread"` for B, if applicable)
  - `action`: `attach_to_thread` | `create_new_thread`

The `id` set is defined by code and must never accept model-invented IDs.

### Button behaviour (Telegram-friendly)
- Render two buttons with labels A and B
- On click, send a canonical “selection event” to backend, eg:

```json
{
  "sessionId": "...",
  "userId": "...",
  "type": "repair_selection",
  "selection": "A",
  "correlationId": "..."
}
```

Backend applies selection deterministically:
- selection A attaches message to candidate A
- selection B attaches message to candidate B or creates a new thread

No LLM call is required to interpret the selection.

---

## LLM involvement (optional)
If you want the repair question to feel natural:
- Call the main chat LLM with a **tiny** input:
  - user message
  - summary of candidate A
  - summary of candidate B
- Ask it for:
  - a short question
  - two short labels

**Validation is mandatory:**
- JSON schema validation
- IDs must be exactly `"A"` and `"B"`
- If invalid, fall back to a deterministic canned question and canned labels.

The LLM is never asked “which option is correct”.

---

## Example

User message: “Can you explain more?”

Candidate A:
- Attach to thread “weather error troubleshooting” (open offer: troubleshoot)
Candidate B:
- Attach to thread “routing architecture discussion” (open offer: elaborate)

Repair response:

- Question: “Do you mean I should continue troubleshooting the weather lookup error, or explain more about the routing approach?”
- Buttons:
  - A: “Troubleshoot weather lookup”
  - B: “Explain routing approach”

---

## Telemetry and auditability
Log:
- repair triggers (with scores and candidate summaries)
- selections (A/B)
- outcomes (which thread was chosen)

This is essential for tuning thresholds and preventing regressions.

---

## Acceptance criteria
- Repair is triggered only when needed (rare).
- The LLM cannot introduce new options beyond A/B.
- Button selection always produces deterministic routing.
- If LLM output is malformed, fallback repair question renders correctly.
