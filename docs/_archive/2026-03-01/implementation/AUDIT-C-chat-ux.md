# AUDIT-C: Chat UX Correctness (Routing, Open Loops, Repair, Inline Reply, Reactivation)

Date: 2026-02-28  
Scope docs:
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/architecture/open-loops-and-change-of-mind.md`
- `docs/architecture/routing-repair-and-disambiguation.md`

## Summary
- Implemented: deterministic routing priorities, change-of-mind handling, error-thread reactivation, workflow thread ownership, Telegram repair button flow.
- Partial: inline reply policy is strict in orchestrator but Telegram adapter still falls back to current message when anchor is invalid.
- Missing: web chat does not render/submit `repair_question` A/B selection flow.

## 1) RoutingPolicyEngine correctness
- Override precedence is code-first and runs before pending-fit/status logic:
  - `packages/polar-runtime-core/src/routing-policy-engine.mjs:858-895`
- Status nudges attach to active work threads (`in_progress|blocked|workflow_proposed`) and greeting nudges are recency-gated:
  - `packages/polar-runtime-core/src/routing-policy-engine.mjs:897-920`
  - `GREETING_RECENCY_MS`: `packages/polar-runtime-core/src/routing-policy-engine.mjs:622`
- Change-of-mind path (`nah` then `actually yes`) is deterministic and bounded by rejected-offer TTL:
  - `packages/polar-runtime-core/src/routing-policy-engine.mjs:603`, `858-887`
- `answer_to_pending` only attaches on fit-check success:
  - `packages/polar-runtime-core/src/routing-policy-engine.mjs:988-1003`, `1018-1041`
- Repair trigger is deterministic and low-info/open-loop based, with fixed A/B options:
  - `packages/polar-runtime-core/src/routing-policy-engine.mjs:716-779`
  - Selection accepts only `A|B` with matching correlationId:
  - `packages/polar-runtime-core/src/routing-policy-engine.mjs:791-803`

Finding:
- Doc mentions confidence-margin scoring between close candidates; implementation currently uses open-loop count + low-info checks, not explicit score margin.

## 2) Workflow ownership and reactivation
- Proposal stores canonical owner thread:
  - `packages/polar-runtime-core/src/orchestrator.mjs:427-433`
- Execution targets stored `threadId` (not active-thread drift):
  - `packages/polar-runtime-core/src/orchestrator.mjs:484-510`
- `lastError` records include `runId/workflowId/threadId` on validation, step, and crash paths:
  - `packages/polar-runtime-core/src/orchestrator.mjs:563-567`, `638-640`, `660-662`, `714-716`
- Recent failure inquiries route to the failed thread and reactivate it:
  - `packages/polar-runtime-core/src/routing-policy-engine.mjs:970-986`, `1145-1151`
  - lastError TTL gate: `packages/polar-runtime-core/src/routing-policy-engine.mjs:620`

## 3) Inline reply policy end-to-end
- Orchestrator returns explicit inline reply fields:
  - `packages/polar-runtime-core/src/orchestrator.mjs:464-474`
- Anchor policy is strict in routing engine (`useInlineReply` only with concrete anchor):
  - `packages/polar-runtime-core/src/routing-policy-engine.mjs:1160-1187`
- Telegram adapter currently falls back to current message if anchor is invalid/non-numeric:
  - `packages/polar-bot-runner/src/index.mjs:223-231`
- Synthetic IDs are not directly used as Telegram reply target (numeric coercion guard is present):
  - `packages/polar-bot-runner/src/index.mjs:225-227`

Finding:
- Strict policy requirement is not fully met in Telegram path due `numericAnchor || telegramMessageId` fallback.

## 4) Repair buttons end-to-end
- Telegram renders `repair_question` as A/B buttons with correlationId-backed callback data:
  - `packages/polar-bot-runner/src/index.mjs:263-273`
- Callback emits typed selection event to backend and backend applies deterministically (no LLM routing):
  - `packages/polar-bot-runner/src/index.mjs:471-493`
  - `packages/polar-runtime-core/src/orchestrator.mjs:769-787`
- Keyboard is disabled after click to prevent double-submission:
  - `packages/polar-bot-runner/src/index.mjs:486`
- Web chat currently has workflow buttons but no `repair_question` rendering/selection path:
  - `packages/polar-web-ui/src/views/chat.js:113-151`
  - no `fetchApi('handleRepairSelection', ...)` path present.

## 5) Tests run (exact)
- `node --test tests/runtime-core-open-loops-repair.test.mjs`
- `node --test tests/runtime-core-orchestrator-routing.test.mjs`
- `node --test tests/runtime-core-orchestrator-thread-ownership.test.mjs`
- `node --test tests/runtime-core-orchestrator-repair-phrasing.test.mjs`
- `node --test tests/channels-thin-client-enforcement.test.mjs`

New AUDIT-C regression tests added:
- `tests/runtime-core-open-loops-repair.test.mjs`
  - greeting stale recency does not become status nudge
  - greeting recent recency becomes status nudge
  - reversal phrase with override verb routes to `override`
  - recent failed thread with open offer still accepts affirmative

## 6) Gaps and follow-ups
1. Tighten Telegram inline policy: only set `reply_parameters` when `useInlineReply === true` and anchor is valid; otherwise send non-inline.
2. Add web `repair_question` A/B rendering + callback path (`handleRepairSelection`) and include API allowlist wiring.
3. If doc intent is strict confidence-margin repair gating, add explicit score-margin computation and telemetry.
