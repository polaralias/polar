# IP-02: Routing migration to LLM-first proposal

## Instructions
1. Read `AGENTS.md` first.
2. Read all required docs below before coding.
3. Implement all requested changes.
4. Run tests and boundary checks.
5. Append a new entry to `docs/IMPLEMENTATION_LOG.md`.

## Required docs
- `docs/specs/LLM_FIRST_PROPOSAL_AND_POLICY_ENFORCEMENT.md`
- `docs/specs/ROUTING_AND_DELEGATION_POLICY.md`
- `docs/specs/FOCUS_CONTEXT_AND_PENDING.md`
- `docs/specs/CONTEXT_MANAGEMENT_SYSTEM.md`
- `docs/prompts/ROUTER_PROMPT_CONTRACT.md`
- `docs/prompts/FOCUS_THREAD_RESOLVER_PROMPT_CONTRACT.md`

## Global reference set (also keep in scope)
- `docs/specs/LLM_FIRST_PROPOSAL_AND_POLICY_ENFORCEMENT.md`
- `docs/specs/ROUTING_AND_DELEGATION_POLICY.md`
- `docs/specs/WORKFLOW_EXECUTION_INTEGRITY.md`
- `docs/specs/AUTOMATION_RUNNER.md`
- `docs/specs/TOOL_FAILURE_NORMALISATION.md`
- `docs/specs/CONTEXT_MANAGEMENT_SYSTEM.md`
- `docs/specs/FOCUS_CONTEXT_AND_PENDING.md`
- `docs/specs/ORCHESTRATOR_OUTPUT_RULE.md`
- `docs/MEMORY_AND_FEEDBACK.md`
- `docs/prompts/ROUTER_PROMPT_CONTRACT.md`
- `docs/prompts/WORKFLOW_PLANNER_PROMPT_CONTRACT.md`
- `docs/prompts/AUTOMATION_PLANNER_PROMPT_CONTRACT.md`
- `docs/prompts/FAILURE_EXPLAINER_PROMPT_CONTRACT.md`
- `docs/prompts/FOCUS_THREAD_RESOLVER_PROMPT_CONTRACT.md`

## Objective
Make routing primarily LLM-proposed while keeping deterministic policy veto and lane/pending safety.

## Deliverables
- Rework routing flow so proposal comes from router structured output first.
- Keep deterministic prefilter for safety but downgrade regex heuristics to fallback weighting hints.
- Ensure policy vetoes (capability, approval, unknown targets, risk) remain authoritative.
- Ensure low-confidence/ambiguous outputs produce concise clarification.
- Add telemetry:
  - `proposal_valid`
  - `router_invoked`
  - `router_affirmed_decision`
  - `policy_vetoes`
  - `fallback_reason`

## Suggested files
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/routing-policy-engine.mjs`

## Testing
- Existing hybrid routing tests updated/preserved.
- Add replay-oriented tests for router malformed output and fallback behavior.
- Run:
  - `npm test`
  - `npm run check:boundaries`
