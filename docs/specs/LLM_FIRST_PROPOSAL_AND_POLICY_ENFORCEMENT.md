# LLM-first proposal and policy enforcement contract

## Goal
Make proposal-quality decisions primarily LLM-driven while keeping execution safety deterministic.

Core split:
- LLM proposes: intent, routing mode, workflow/automation plan, focus/thread interpretation, and user-facing explanation framing.
- Code enforces: capability scope, approvals, allowlists, tool/agent existence, thread/lane isolation, and execution validity.

This is the platform-wide default for chat, workflow, automation, and failure handling.

---

## Operating model
1. Build context (lane-first, typed pending state, temporal attention, durable summaries/facts).
2. Ask LLM for structured proposal using strict schema.
3. Validate proposal in code (schema + policy + capability + risk + tenancy/lane invariants).
4. Either:
   - execute validated proposal, or
   - clamp/rewrite/clarify deterministically when invalid/unsafe/ambiguous.
5. Monitor execution and emit deterministic telemetry + lineage.
6. Ask orchestrator LLM for user-facing synthesis/explanation (safe redaction policy applied).

---

## Proposal-first domains

### Routing and delegation
- LLM should be primary scorer/selector for `respond|tool|workflow|delegate|clarify`.
- Deterministic layer can veto/force clarify for high-risk or policy conflicts.
- Regex/keyword heuristics are fallback safety hints only, not the primary route selector.

### Workflow planning
- LLM may propose dynamic multi-step workflows (not limited to a tiny static shortlist).
- Code must validate each step against installed capabilities, skill manifests, and approval policy before execution.
- Unsupported or unsafe steps must be rejected/clamped with explicit reason.

### Automation planning
- LLM should propose automation intent, schedule semantics, and scope from natural language.
- If confidence is low or ambiguity remains, orchestrator asks for concise confirmation.
- Deterministic layer enforces quiet-hours, cost/rate caps, capability bounds, and approval gates.

### Conversation threading/focus
- LLM may rank focus candidates and propose lane/thread attachment.
- Code remains authoritative for lane boundaries, reply anchors, pending-state contracts, and TTL handling.

### Failure explanation
- Sub-agent/tool/workflow emits typed failure envelope.
- Orchestrator LLM produces user-facing explanation from that envelope.
- On user request ("show exact error"), orchestrator may reveal controlled diagnostic detail from normalized error metadata.

---

## Non-negotiable deterministic guards
- No proposal can expand privileges.
- No execution without capability + policy validation.
- No bypass of approval requirements.
- No cross-lane execution contamination.
- No direct surface-to-provider/tool bypass.
- Every proposal decision and enforcement outcome must be auditable.

---

## Structured output requirements
All LLM proposal calls must use strict structured outputs with:
- schema id/version
- confidence score
- rationale
- explicit references to focus/pending/temporal context when relevant

Proposal schema violations must fail closed to deterministic fallback.

---

## Telemetry contract
Record for each proposal-execution cycle:
- `proposal_type` (`routing|workflow|automation|focus|failure_explain`)
- `llm_confidence`
- `proposal_valid` + validation errors
- `policy_vetoes` / clamps
- `final_decision`
- `executed_steps` (where applicable)
- `outcome_status`

---

## Migration direction
- Move intent-specific regex trees to fallback-only paths.
- Promote LLM proposal prompts + schema validators to first-class contracts.
- Expand workflow planner from static template mapping to validated dynamic step graphs.

---

## Related specs
- `docs/specs/ROUTING_AND_DELEGATION_POLICY.md`
- `docs/specs/WORKFLOW_EXECUTION_INTEGRITY.md`
- `docs/specs/AUTOMATION_RUNNER.md`
- `docs/specs/CONTEXT_MANAGEMENT_SYSTEM.md`
- `docs/specs/TOOL_FAILURE_NORMALISATION.md`
- `docs/specs/ORCHESTRATOR_OUTPUT_RULE.md`
