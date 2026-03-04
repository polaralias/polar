# IP-05: Failure explainer and user-requested diagnostics

## Instructions
1. Read `AGENTS.md` first.
2. Read all required docs below before coding.
3. Implement all requested changes.
4. Run tests and boundary checks.
5. Append a new entry to `docs/IMPLEMENTATION_LOG.md`.

## Required docs
- `docs/specs/LLM_FIRST_PROPOSAL_AND_POLICY_ENFORCEMENT.md`
- `docs/specs/TOOL_FAILURE_NORMALISATION.md`
- `docs/specs/ORCHESTRATOR_OUTPUT_RULE.md`
- `docs/specs/WORKFLOW_EXECUTION_INTEGRITY.md`
- `docs/prompts/FAILURE_EXPLAINER_PROMPT_CONTRACT.md`

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
Make failure messaging orchestrator-LLM generated from typed normalized error envelopes, with controlled detail escalation when users ask for exact errors.

## Deliverables
- Add failure explainer proposal path (schema validated).
- Keep deterministic fallback message when explainer unavailable.
- Add explicit follow-up handling for "show exact error" style requests.
- Ensure only safe normalized diagnostics are exposed (no raw unsafe traces by default).
- Preserve typed error categories and pending-state cleanup rules.

## Suggested files
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/tool-workflow-error-normalizer.mjs`

## Testing
- Default safe failure explanation tests.
- Detail-request follow-up tests returning controlled diagnostics.
- Run:
  - `npm test`
  - `npm run check:boundaries`
