# Prompt contracts

This folder defines platform prompt contracts for LLM-first proposal paths.

Contracts here are authoritative for:
- expected structured output shape
- confidence fields
- reasoning/reference fields
- deterministic enforcement boundaries

Current contracts:
- `ROUTER_PROMPT_CONTRACT.md`
- `WORKFLOW_PLANNER_PROMPT_CONTRACT.md`
- `AUTOMATION_PLANNER_PROMPT_CONTRACT.md`
- `FAILURE_EXPLAINER_PROMPT_CONTRACT.md`
- `FOCUS_THREAD_RESOLVER_PROMPT_CONTRACT.md`

Any contract change should update:
1) corresponding code schema validators
2) replay fixtures/regression tests
3) related spec acceptance criteria
