# IP-06: Focus/thread resolver migration + replay hardening

## Instructions
1. Read `AGENTS.md` first.
2. Read all required docs below before coding.
3. Implement all requested changes.
4. Run tests and boundary checks.
5. Append a new entry to `docs/IMPLEMENTATION_LOG.md`.

## Required docs
- `docs/specs/LLM_FIRST_PROPOSAL_AND_POLICY_ENFORCEMENT.md`
- `docs/specs/CONTEXT_MANAGEMENT_SYSTEM.md`
- `docs/specs/FOCUS_CONTEXT_AND_PENDING.md`
- `docs/specs/ROUTING_AND_DELEGATION_POLICY.md`
- `docs/prompts/FOCUS_THREAD_RESOLVER_PROMPT_CONTRACT.md`
- `docs/prompts/ROUTER_PROMPT_CONTRACT.md`

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
Migrate ambiguous follow-up focus resolution to LLM-proposed ranking while preserving deterministic lane/pending invariants and replay stability.

## Deliverables
- Add focus/thread resolver proposal call + schema validation.
- Keep deterministic lane, reply-anchor, and pending TTL/type enforcement authoritative.
- Integrate resolver output into routing input contract.
- Add replay fixtures for known ambiguous transcripts.
- Add telemetry for resolver proposal validity and candidate ranking.

## Suggested files
- `packages/polar-runtime-core/src/routing-policy-engine.mjs`
- `packages/polar-runtime-core/src/orchestrator.mjs`
- relevant tests under `tests/` and `packages/polar-runtime-core/tests/`

## Testing
- Ambiguous pronoun follow-up tests across lanes.
- Pending-type mismatch and expiry tests.
- Replay fixture regression pass.
- Run:
  - `npm test`
  - `npm run check:boundaries`
