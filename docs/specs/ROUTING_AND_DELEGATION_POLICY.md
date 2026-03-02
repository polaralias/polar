# Routing and delegation policy (heuristics + LLM router with confidence)

## Goal
Route requests reliably between:
- inline response
- tool call
- workflow proposal
- sub-agent delegation

without delegating the wrong task or ignoring obvious multi-step requests (e.g. “write 10 email variants”).

---

## Inputs to routing
Routing must be based on a **FocusContext** (see Focus Context spec):
- focus anchor message + snippet
- threadKey lane recency window
- any active pending state (only if applicable)

---

## Two-stage router
### Stage A: deterministic guardrails
Fast checks to avoid stupid mistakes:
- If a workflow is awaiting user input (pending workflow_waiting) and inbound matches expected selection -> handle selection directly.
- If inbound is a pure slot-fill (pending slot_request and matches type) -> handle as continuation (no delegation).
- If tool is known unavailable -> do not route to it.

### Stage B: LLM router (main chooser)
Call a small router prompt that outputs strict JSON:

Fields:
- decision: `respond` | `delegate` | `tool` | `workflow` | `clarify`
- target:
  - for delegate: `agentId`
  - for tool: `extensionId` and `capabilityId`
- confidence: 0.0–1.0
- rationale: short string
- references:
  - `refersTo`: `focus_anchor` | `pending` | `latest`
  - `refersToReason`: short

Enforcement:
- Only allow delegate to registered agent profiles.
  - Introduce a default generic sub agent profile as fallback agent as part of this work
- Only allow tool calls for installed tools.
- If confidence below threshold (e.g. 0.65):
  - either respond inline or ask a clarifying question
  - do not delegate blindly
- Enforce:
  - only installed tools can be called
- If confidence below threshold:
  - ask one short clarifying question (two-option disambiguation when possible)
- Sub agent spin up:
  - Utilise our allowed skills/tools pass through functionality
  - Simple delegation for read tasks should not require approval
  - Delegation involing complex workflows and plans should require approval
  - Delegation for write and destructive tasks should require approval
---

## Delegation triggers (examples)
Strong delegate signals:
- user asks for many variants (“10 versions”, “write a proposal”, “draft a plan”)
- multi-step tasks (“research and compare”, “make a workflow”)
- “do this via sub-agent” explicitly

Strong inline signals:
- short question, no external data, single answer

---

## Prevent “stale task delegation”
If user asks “do that via sub-agent”:
- It must refer to FocusAnchor, not pending tool retry offers unless expected type matched.
- If focus is ambiguous, ask one short question (“Do you mean the weather check or the email draft?”).

---

## Acceptance criteria
- “write 10 different versions” triggers delegation to writer agent (or at least a multi-step plan) consistently.
- “do that via sub-agent” delegates the correct most-recent task.
- Delegation and tool calls are safe and clamped to allowlists.

---

## Tests
- Router honours focus anchor over stale pending.
- Confidence threshold prevents unsafe delegation.

---

## Agent checklist
- Check AGENTS.md first.
- Read last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write a log entry when done.
