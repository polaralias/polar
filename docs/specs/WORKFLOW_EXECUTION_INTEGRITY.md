# Workflow execution integrity (Hybrid v2: proposal-by-LLM, execution-by-policy)

## Problem
Workflow failures or invalid append payloads must never break conversation continuity.

A crash like `Invalid chat.management.gateway.message.append.request` indicates an internal contract bug and must fail safe.

---

## Goals
- Keep workflow proposal/model reasoning strong while execution remains deterministic and policy-gated.
- Validate append and execution contracts before side effects.
- Ensure tool/delegation/workflow runs share one enforcement pipeline.
- Normalize execution failures to typed categories and recover conversation state safely.
- Support dynamic LLM-proposed workflows, not just a narrow static template set.

---

## Execution split
### LLM responsibilities
- propose workflow intent and dynamic step graph
- shape step decomposition/order with arguments
- summarize outcomes for user

### Deterministic responsibilities (absolute)
- validate proposal schema, step graph shape, and argument contracts
- enforce capability scope, tool/agent allowlists, and grants/approvals
- gate destructive/write actions
- execute steps and cancellation semantics
- append chat messages through validated gateway contract only

Model output cannot bypass approval or capability checks.

---

## Dynamic workflow proposal contract
The planner output should support:
- `goal`
- ordered `steps[]` with `{ extensionId, capabilityId, args, reason }`
- optional dependency hints (`dependsOnStep`)
- confidence + risk hints

Code must reject or clamp any step when:
- capability not installed/allowed
- args invalid for capability contract
- step violates delegated/skill manifest scope
- approval requirements are unmet

Rejected/clamped steps must be reflected in lineage telemetry.

Prompt contract artifact:
- `docs/prompts/WORKFLOW_PLANNER_PROMPT_CONTRACT.md`

---

## Append and contract requirements
All append operations must include valid contract fields:
- `sessionId`, `userId`, `messageId`, `role`, `text`, `timestampMs`
- optional metadata must be JSON-safe

Additional integrity rules:
- messageId uniqueness holds within session
- workflow/status messages follow same append validator as normal turns
- assistant outputs with channel delivery must maintain channel-id bindings

---

## Failure normalization and state safety
Workflow failures must normalize into typed categories (for example):
- `ToolUnavailable`
- `ToolMisconfigured`
- `ToolTransientError`
- `ToolValidationError`
- `InternalContractBug`

Rules:
- no crash loop on normalized failure
- terminal classes clear incompatible pending state in same lane
- lineage/audit events are always emitted with run/workflow/thread IDs
- user receives deterministic safe error text if synthesis is unavailable

---

## Cancellation integrity
Cancellation is cooperative and deterministic:
- pending workflows: cancel immediately
- in-flight workflows: mark cancellation requested and stop before next step
- final state must be explicit (`cancelled` or `cancellation_requested`)
- cancellation events include stable thread linkage in lineage

---

## Approval integrity
Approval semantics are deterministic and centralized:
- read-only workflows/delegation may auto-run per policy
- write/complex/destructive workflows require grants/approval
- LLM cannot self-approve or escalate risk class

---

## Telemetry requirements
Capture per execution:
- `workflowId`, `runId`, `threadId`, `riskClass`
- proposed vs executed steps (after policy clamps), including dropped/rewritten steps
- approval/grant decisions
- normalized error category (if any)
- final status and user-visible outcome type

---

## Tests
- executeWorkflow appends assistant/system messages with valid contract shape.
- invalid append payload normalizes to `InternalContractBug` and does not crash orchestrator.
- tool/delegation policy clamps are enforced at execution boundary.
- cancellation halts multi-step run before next step and emits cancellation lineage event.
- approval-required workflow cannot execute without deterministic approval path.
- dynamic workflow proposals with mixed valid/invalid steps are safely clamped or rejected with explicit reason.

---

## Agent checklist
- Check AGENTS.md first.
- Read last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write a log entry when done.
