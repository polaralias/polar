# IP-04: Automation planner migration to LLM-first

## Instructions
1. Read `AGENTS.md` first.
2. Read all required docs below before coding.
3. Implement all requested changes.
4. Run tests and boundary checks.
5. Append a new entry to `docs/IMPLEMENTATION_LOG.md`.

## Required docs
- `docs/specs/LLM_FIRST_PROPOSAL_AND_POLICY_ENFORCEMENT.md`
- `docs/specs/AUTOMATION_RUNNER.md`
- `docs/specs/ORCHESTRATOR_OUTPUT_RULE.md`
- `docs/specs/CONTEXT_MANAGEMENT_SYSTEM.md`
- `docs/prompts/AUTOMATION_PLANNER_PROMPT_CONTRACT.md`

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
Move automation drafting from regex intent parsing to LLM-proposed structured plans with deterministic validation and confirmation flow on low confidence.

## Deliverables
- Add automation planner proposal call and schema validation.
- Low-confidence path: deterministic confirmation question flow.
- Normalize accepted automation proposal into deterministic internal schedule representation.
- Preserve existing deterministic safety controls:
  - quiet-hours
  - rate caps
  - approval requirements
  - capability restrictions
- Ensure orchestrator-mediated user-facing confirmation text.

## Suggested files
- `packages/polar-runtime-core/src/automation-gateway.mjs`
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-control-plane/src/index.mjs` (if orchestration pathway wiring needs updates)

## Testing
- Proposal accepted/rejected/clarify branches.
- Low-confidence confirmation branch.
- Regression tests for quiet hours and cap enforcement.
- Run:
  - `npm test`
  - `npm run check:boundaries`
