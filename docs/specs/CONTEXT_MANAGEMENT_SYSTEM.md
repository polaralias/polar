# Context management system (Hybrid v2: lane memory + temporal attention + typed state)

## Goal
Make conversations coherent over time while keeping token cost bounded by composing context from:
- lane recency
- rolling summaries
- long-term memory retrieval
- temporal attention (recent-time recap)
- typed pending state

This improves coherence and decision quality, but does not replace deterministic thread routing.

---

## Vision alignment
The context system is intentionally multi-layered, not "one giant prompt window":
- compress old conversation into structured summaries
- store durable facts separately from transient runtime state
- dynamically load only relevant memory for the current lane/task
- keep specialist/delegated work context tied to the same lane unless user redirects

---

## Core entities
### SessionId
Chat-scoped:
- `sessionId = telegram:chat:<chatId>`

### ThreadKey (lane)
Stable deterministic lane identity (topic > reply > root):
- `topic:<chatId>:<message_thread_id>`
- `reply:<chatId>:<reply_to_message_id>`
- `root:<chatId>`

### FocusAnchor
Primary reference target for ambiguous follow-ups:
1. explicit reply target
2. most recent assistant anchor in same lane
3. matching pending-state anchor (typed)

### TemporalAttention
A structured, deterministic recap for recent continuity:
- target window: last ~30 minutes in current lane/session
- unresolved asks and pending actions
- recent outcomes/failures and current active workflow/delegation status

---

## Context assembly order
1. system/developer policy
2. personality profile
3. lane summary (`thread_summary`)
4. session summary (`session_summary`)
5. temporal attention block (`temporal_attention`)
6. retrieved memories (lane-first)
7. recent lane messages
8. quoted reply context block
9. current user message

Rules:
- recency message window remains lane-scoped
- temporal attention is structured fields, not a raw transcript dump
- prefer high-signal compact blocks over long history
- avoid including cross-lane context unless explicitly referenced or high-confidence matched

---

## Storage model
SQLite remains source of truth.

### Memory record types
- `thread_summary` (session scope, keyed by sessionId + threadKey)
- `session_summary` (session scope, keyed by sessionId)
- `temporal_attention` (session scope, keyed by sessionId + threadKey)
- `thread_state` (typed pending state and focus anchors)
- `extracted_fact` (session scope, durable user/project fact)

Required metadata:
- `threadKey` (where applicable)
- `summaryVersion`
- `updatedAtMs`
- `messageRange` (optional)
- `windowStartMs`/`windowEndMs` for temporal attention
- `stateVersion` + `expiresAtMs` for typed pending records (`thread_state`)

Never persist secrets/credentials in summaries or temporal attention blocks.

---

## Temporal attention layer
### Purpose
Improve short-horizon reasoning (for "that", "continue", "do it") without inflating token usage.

### Build contract
Deterministically produce a compact JSON-like block containing:
- `window`: `{ startAtMs, endAtMs }`
- `focusCandidates`: top 1-3 candidate anchors with short labels
- `unresolved`: pending slots, clarifications, approvals, cancellations
- `recentActions`: last meaningful tool/workflow/delegation outcomes
- `riskHints`: whether unresolved items imply write/destructive approvals
- `activeDelegation`: currently active delegated agent (if any)

### Selection policy
- default source: current lane
- include session-level unresolved items only when high-confidence relevance exists
- stale items (expired TTL) are excluded

---

## Compaction and summarization
### Lane compaction trigger
- `recentMessagesCount > 30` OR
- `estimatedTokens(recentMessages) > 2500`

### Session compaction trigger
- `sessionMessagesCount > 30` OR
- `estimatedTokens(sessionMessages) > 3000`

### Temporal attention refresh trigger
- every new turn touching unresolved state
- or when now - `updatedAtMs` exceeds configured freshness target (for example 5 minutes)

### Summary format
Include structured sections:
- goals/open questions
- decisions/outcomes
- constraints/facts
- pending actions

---

## Retrieval policy
Start simple with SQLite FTS / text search.

Retrieve in this order:
1. lane records (`thread_summary`, lane facts)
2. temporal attention for active lane
3. session summary
4. cross-lane records only when explicitly referenced or high-confidence match

Avoid retrieving all-thread memories by default.

When middleware-level recall is enabled, it must apply the same lane-first policy and cross-lane gating.

---

## Typed pending state integration
Pending state is first-class context, not free-form prose.

Recommended typed states:
- `slot_request`
- `clarification_needed`
- `workflow_waiting`
- `workflow_cancellable`
- `delegation_candidate`

Rules:
- if inbound matches pending type, resolve deterministically before broad retrieval
- pending state is lane-scoped and TTL-bound
- terminal normalized failures clear incompatible pending state in same lane
- pending state should be durable across runtime restarts (`thread_state` source of truth)

---

## LLM and deterministic responsibilities
LLM-leaning responsibilities:
- focus candidate ranking assistance
- routing mode proposal
- workflow shaping
- post-tool interpretation/synthesis
- thread/focus disambiguation proposals when short/ambiguous follow-ups occur

Deterministic responsibilities (absolute):
- thread/lane derivation and isolation
- pending-state resolution contract
- capability and approval enforcement
- installed tool/agent existence checks
- policy vetoes and execution gating

Reference architecture:
- `docs/specs/LLM_FIRST_PROPOSAL_AND_POLICY_ENFORCEMENT.md`
- `docs/prompts/FOCUS_THREAD_RESOLVER_PROMPT_CONTRACT.md`

---

## Observability and replay
Capture per-turn context telemetry:
- selected lane and focus anchor
- temporal attention payload hash/version
- retrieved memory IDs
- pending state consumed/updated
- routed decision path and outcome
- memory source breakdown (`lane|session|cross_lane`)
- recall gate decisions (why any cross-lane record was included)

Replay requirements:
- preserve redacted transcript fixtures with expected focus/routing outputs
- validate context assembly and routing stability before threshold/weight changes

---

## Acceptance criteria
- assistant can continue correctly on short follow-ups using temporal attention + typed pending state
- lane recency isolation is preserved (no cross-thread bleed)
- session continuity improves without raw whole-chat injection
- context remains compact while unresolved items are retained accurately
- replay suite catches regressions in focus/routing continuity
- restarts do not silently lose active typed pending state for a lane

---

## Agent checklist
- Check AGENTS.md first.
- Read last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write a log entry using the agreed template when done.
