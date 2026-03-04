# IP-03: Dynamic workflow planner (LLM-proposed graph, code-validated execution)

## Instructions
1. Read `AGENTS.md` first.
2. Read all required docs below before coding.
3. Implement all requested changes.
4. Run tests and boundary checks.
5. Append a new entry to `docs/IMPLEMENTATION_LOG.md`.

## Required docs
- `docs/specs/LLM_FIRST_PROPOSAL_AND_POLICY_ENFORCEMENT.md`
- `docs/specs/WORKFLOW_EXECUTION_INTEGRITY.md`
- `docs/specs/ROUTING_AND_DELEGATION_POLICY.md`
- `docs/specs/TOOL_FAILURE_NORMALISATION.md`
- `docs/prompts/WORKFLOW_PLANNER_PROMPT_CONTRACT.md`

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
Support dynamic LLM-proposed workflows beyond a narrow static template set, with strict code validation and policy enforcement.

## Deliverables
- Add workflow planner proposal call (structured output) in orchestrator flow.
- Accept dynamic step graph proposal and validate each step:
  - capability existence and install state
  - capability scope / skill manifest constraints
  - args schema requirements
  - approval and risk policy
- Keep static templates as compatibility fallback path.
- Add clear clamp/reject semantics for invalid steps.
- Ensure execution monitoring and cancellation semantics remain deterministic.

## Suggested files
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/workflow-engine.mjs`
- `packages/polar-runtime-core/src/workflow-templates.mjs` (compat fallback only)

## Testing
- Dynamic mixed-validity plan tests (drop/reject unsafe steps).
- Capability-scope mismatch and approval-required tests.
- Run:
  - `npm test`
  - `npm run check:boundaries`
