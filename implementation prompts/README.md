# Implementation prompt pack (LLM-first proposal + deterministic enforcement)

Use these prompts in order with your coding agent.

## Global instructions for every prompt
- Read `AGENTS.md` first.
- Read all required docs listed in the prompt.
- Implement code (not just analysis).
- Run targeted tests first, then full `npm test` and `npm run check:boundaries` before finishing.
- Append a structured entry to `docs/IMPLEMENTATION_LOG.md`.

## Prompt sequence
1. `IP-01_PROMPT_CONTRACT_SCHEMAS_AND_GATES.md`
2. `IP-02_ROUTING_LLM_FIRST_MIGRATION.md`
3. `IP-03_DYNAMIC_WORKFLOW_PLANNER.md`
4. `IP-04_AUTOMATION_PLANNER_LLM_FIRST.md`
5. `IP-05_FAILURE_EXPLAINER_AND_DIAGNOSTICS.md`
6. `IP-06_FOCUS_THREAD_RESOLVER_AND_REPLAY.md`

## Shared required docs (all prompts)
- `AGENTS.md`
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
- `docs/IMPLEMENTATION_LOG.md`
