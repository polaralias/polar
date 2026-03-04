# IP-01: Prompt-contract schemas and enforcement gates

## Instructions
1. Read `AGENTS.md` first.
2. Read all required docs below before coding.
3. Implement all requested changes.
4. Run tests and boundary checks.
5. Append a new entry to `docs/IMPLEMENTATION_LOG.md`.

## Required docs
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
Introduce code-level schema validators and enforcement adapters for all prompt contracts so runtime can migrate from regex-first to LLM-proposal-first safely.

## Deliverables
- Add strict schema validators for:
  - router proposal
  - workflow planner proposal
  - automation planner proposal
  - failure explainer proposal
  - focus/thread resolver proposal
- Add shared proposal validation utilities (normalize + fail-closed behavior).
- Add deterministic clamp/error pathways when any proposal is invalid.
- Add telemetry fields for proposal validity and clamp reasons.

## Suggested files
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/automation-gateway.mjs`
- `packages/polar-runtime-core/src/routing-policy-engine.mjs`
- new helper module(s) under `packages/polar-runtime-core/src/` for proposal schema handling

## Testing
- Unit tests per schema validator.
- Integration tests for fail-closed behavior on malformed proposal outputs.
- Run:
  - `npm test`
  - `npm run check:boundaries`
