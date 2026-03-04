# Orchestrator output rule (Hybrid v2)

## Goal
Keep a single coherent assistant voice while allowing stronger LLM reasoning under deterministic policy control.

Golden rule:
> Any user-facing message should come from orchestrator-mediated output.

Allowed exceptions remain minimal code acknowledgements and hard-failure fallbacks.

---

## Why this matters in Hybrid v2
- Routing and workflow decisions are more model-assisted.
- Safety and approvals remain deterministic.
- User-visible responses must still be coherent and traceable through one pipeline.

---

## Definitions
- **User-facing message**: any text the user reads in chat.
- **Code acknowledgement**: minimal immediate response for safe UX continuity (for example: "Approved", "Cancelled").
- **Side-effect free orchestration**: orchestrator call mode that does not persist user text or mutate durable state.

---

## Where this applies
### Must go through orchestrator
1. Normal chat turns.
2. Automation messages.
3. Command confirmations that should reflect personality/tone.
4. Workflow result summaries and post-tool explanations.
5. Clarification prompts generated from arbitration outcomes.

### Allowed exceptions (limited)
- inline callback acknowledgements before orchestrated final response
- deterministic failure fallback when orchestrator unavailable
- strict factual command outputs where hallucination risk must be zero (`/status`, `/whoami`, `/help`)

---

## Side-effect free orchestration mode
For command/ack confirmations, call orchestrator with write suppression.

Required behavior flags (names may vary):
- `suppressUserMessagePersist=true`
- `suppressMemoryWrite=true`
- `suppressTaskWrites=true`
- `suppressAutomationWrites=true`
- metadata `executionType="system"|"command"|"automation"`

---

## Hybrid v2 response requirements
- Orchestrator can use temporal attention and typed pending context to phrase clarifications/results.
- If routing arbitration selected `clarification_needed`, final question text still comes from orchestrator path (unless hard fallback).
- If workflow/tool execution returns normalized failure, user-facing wording should be orchestrator-generated from typed error envelope.
- Default failure wording must remain safe (no raw stack trace).
- If user explicitly asks for details, orchestrator may provide normalized exact error message/category in a controlled format.

Prompt contract artifact:
- `docs/prompts/FAILURE_EXPLAINER_PROMPT_CONTRACT.md`

---

## Auditing
Tag orchestrator-mediated system outputs with:
- `executionType` (`automation|command|system`)
- linkage identifiers (`jobId`, `commandName`, `workflowId`, `runId`, `threadId`)
- routing metadata when relevant (`decision`, `confidence`, `riskClass`)

---

## Tests (minimum)
- command handler does not append raw command text as conversational user turn
- confirmations use side-effect free orchestration path
- automation delivery sends orchestrator output text only
- callback ack is minimal and final visible result is orchestrator-mediated
- clarification-needed flow produces one coherent orchestrator-visible question
- explicit "what error exactly?" follow-up yields controlled diagnostic detail, not raw internal dump

---

## Implementation checklist
- keep/update helper for system confirmations via side-effect free orchestrator mode
- use helper in command router and automation runner where applicable
- keep callback handlers thin: ack first, final message via orchestrator
