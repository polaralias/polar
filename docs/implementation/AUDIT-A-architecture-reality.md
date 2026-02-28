# AUDIT-A Architecture Reality Summary
Date: 2026-02-28

## Scope covered
- `docs/architecture/**`
- `docs/extensions/**`
- `docs/operations/**`
- `docs/product/**`
- `docs/implementation/**`
- Runtime/control-plane/channel/web/bot packages in scope from request.

## Evidence summary
- Core deterministic orchestration, open loops, repair routing, approvals/grants, capability scope enforcement, middleware contracts, and automation/heartbeat/task board paths are implemented and covered by targeted tests.
- Skill metadata enforcement paths are implemented for skill/MCP install-time blocking and operator override completion.
- Web and Telegram are thin clients against backend orchestration APIs; no local web orchestration loop was found.

## Major mismatches
1. `docs/product/ai-assistant.md` is materially stale (legacy `createPiAgentTurnAdapter` + `<polar_workflow>` narrative, outdated completion claims).
2. `docs/product/web-ui-and-chat-management.md` overstates delivered UI scope versus current views.
3. `docs/architecture/llm-providers.md` is largely reference material and not fully represented as enforceable runtime architecture.
4. Dev-only MCP harness isolation is documented but not strongly enforced in runtime policy code.
5. Telegram inline-reply anchoring still falls back to current message ID when anchor is invalid.

## Test evidence
Passing representative suites:
- `tests/runtime-core-open-loops-repair.test.mjs`
- `tests/runtime-core-orchestrator-repair-phrasing.test.mjs`
- `tests/runtime-core-workflow-template-enforcement.test.mjs`
- `tests/runtime-core-capability-scope-enforcement.test.mjs`
- `packages/polar-runtime-core/tests/approval-store.test.mjs`
- `packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- `tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `tests/channels-thin-client-enforcement.test.mjs`
- `tests/adapter-channels-normalization.test.mjs`
- `tests/runtime-core-contract-middleware.test.mjs`
- `tests/runtime-core-handoff-gateway.test.mjs`
- `tests/runtime-core-automation-gateway.test.mjs`
- `tests/runtime-core-heartbeat-gateway.test.mjs`
- `tests/runtime-core-scheduler-gateway.test.mjs`
- `tests/runtime-core-task-board-gateway.test.mjs`
- `tests/check-pi-mono-imports.test.mjs`
- `tests/adapter-pi.test.mjs`
- `tests/runtime-core-usage-telemetry-gateway.test.mjs`
- `tests/runtime-core-handoff-routing-telemetry.test.mjs`

Known failing suites (pre-existing regression):
- `tests/control-plane-service.test.mjs`
- `tests/runtime-core-skill-installer-gateway.test.mjs`
- `tests/runtime-core-skill-risk-enforcement.test.mjs`

Failure signature (all three): `POLAR_CONTRACT_REGISTRY_ERROR` at `skill.install.analyze` (`Contract retryPolicy.maxAttempts must be a positive integer`).

## Primary next actions
1. Fix `createSkillAnalyzerContract` retry metadata and re-run blocked suites.
2. Tighten Telegram anchor handling to avoid invalid inline fallback.
3. Add unified, durable lineage telemetry for workflow/run/thread + policy/repair decisions.
