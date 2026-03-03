# Routing and delegation policy (Hybrid v2: deterministic policy + LLM weighted decisions)

## Goal
Route requests reliably between:
- inline response
- tool call
- workflow proposal
- sub-agent delegation
- clarification question

while increasing model-driven decision quality without sacrificing safety or traceability.

---

## Core principle
Use a **hybrid weighted router**:
- LLM contributes semantic reasoning and ambiguity handling.
- Deterministic policy contributes guardrails, risk controls, and hard safety vetoes.

This is not fixed 50/50 globally. Weighting is dynamic by risk and confidence.

---

## Inputs to routing
Routing must be based on a **FocusContext** and typed runtime state:
- focus anchor message + snippet
- threadKey lane recency window
- active pending state (slot, clarification, workflow control)
- temporal attention summary (last ~30 minutes + unresolved items)
- installed agents/tools and capability scope

---

## Three-tier routing pipeline
### Tier 1: deterministic prefilter
Fast deterministic checks that run first:
- If a typed pending state is active and inbound matches expected selection/slot type, resolve directly.
- If a tool/agent is unavailable or disallowed, remove it from candidate set.
- If request is clearly low-risk and unambiguous, allow direct inline path without router call.
- If request implies destructive/high-risk action, mark `requiresApproval=true` before model involvement.

Output:
- `candidateModes` (`respond|tool|workflow|delegate|clarify`)
- `policyFlags` (`highRisk`, `requiresApproval`, `missingCapability`, `pendingMatch`, etc.)
- `heuristicScores` per candidate (0.0-1.0)

### Tier 2: LLM router
Call a small router prompt with strict JSON output.

Required fields:
- `decision`: `respond` | `delegate` | `tool` | `workflow` | `clarify`
- `target`:
  - delegate: `agentId`
  - tool: `extensionId`, `capabilityId`
- `confidence`: 0.0-1.0
- `rationale`: short
- `references`:
  - `refersTo`: `focus_anchor` | `pending` | `latest` | `temporal_attention`
  - `refersToReason`: short
- `scores`:
  - `focusResolutionScore`: 0.0-1.0
  - `routingScore`: 0.0-1.0

Router constraints:
- Router can only choose from Tier-1 candidate modes.
- Router never grants approvals or expands capability scope.

### Tier 3: deterministic post-policy executor
Arbitrate heuristic + LLM output, then enforce hard constraints.

Hard constraints (absolute vetoes):
- only registered agent IDs may be delegated to (unknown IDs clamp to fallback agent)
- only installed and allowed tools can be called
- capability scope and forwarded skills are clamped
- risk/approval rules are deterministic and centralized
- thread/lane isolation is deterministic

Arbitration:
- compute fused score per candidate from heuristic and LLM scores
- weighting adapts by risk/confidence:
  - high confidence + low risk: LLM-leading
  - low confidence or high risk: deterministic-leading
- if disagreement margin exceeds threshold, emit `clarify` with short two-option disambiguation

---

## Weighted arbitration contract
### Inputs
- `heuristicScores[candidate]`
- `llmScores[candidate]`
- `llmConfidence`
- `riskClass` (`low|medium|high|destructive`)

### Suggested default policy
- `low risk`: 0.40 heuristic / 0.60 LLM
- `medium risk`: 0.50 heuristic / 0.50 LLM
- `high risk`: 0.65 heuristic / 0.35 LLM
- `destructive`: deterministic policy controls route; LLM may assist rationale only

### Clarify trigger
Force clarification when any is true:
- fused top-2 score gap < `decisionMarginThreshold`
- LLM confidence < `routerConfidenceThreshold`
- heuristic and LLM top decisions conflict in high-risk class

---

## Delegation policy
### Strong delegation signals
- user asks for many variants ("10 versions", "write a proposal", "draft a plan")
- multi-step tasks ("research and compare", "make a workflow")
- explicit delegation request ("do this via sub-agent")

### Strong inline signals
- short direct question with no external action and no multi-step intent

### Approval semantics (deterministic only)
- read-only delegation may auto-run
- write, complex, workflow-level, or destructive delegation requires approval
- model cannot override approval requirement

---

## Typed pending state machine
Introduce typed pending records to avoid repeated model guessing:
- `slot_request`
- `clarification_needed`
- `workflow_waiting`
- `workflow_cancellable`
- `delegation_candidate`

Rules:
- short follow-ups ("yes", "that one", "do it") resolve against typed pending state first
- pending records are lane-scoped and TTL-bound
- terminal tool/workflow failures clear incompatible pending states in that lane

---

## Prevent stale task delegation
If user says "do that via sub-agent":
- prefer FocusAnchor and temporal attention unresolved item, not stale retry offers
- if ambiguous, ask one short disambiguation question with two options

---

## Telemetry and replay tuning
Record on every routing turn:
- `heuristic_decision`
- `llm_decision`
- `fused_decision`
- `heuristic_scores`
- `llm_scores`
- `llm_confidence`
- `risk_class`
- `policy_vetoes`
- `final_outcome`

Operational requirements:
- maintain replayable routing fixtures from production transcripts (redacted)
- run offline replay to tune thresholds/weights before changing defaults
- promote weight changes only with regression pass on routing acceptance suite

---

## Acceptance criteria
- "write 10 different versions" consistently routes to workflow/delegation path.
- "do that via sub-agent" attaches to correct recent focus and does not select stale pending by mistake.
- low-confidence or high-disagreement turns produce concise clarification questions.
- high-risk/destructive routing remains deterministic-policy gated.
- telemetry supports offline replay and measurable routing improvements.

---

## Tests
- prefilter resolves pending `clarification_needed` and `slot_request` without router call
- fused arbitration honors risk-weight policy and disagreement clarify triggers
- hard policy vetoes clamp invalid tool/agent decisions
- delegation approval requirement cannot be bypassed by router output
- replay suite validates no regression on known ambiguous transcripts

---

## Agent checklist
- Check AGENTS.md first.
- Read last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write a log entry when done.
