# Implementation Log

Last updated: 2026-02-23

This is the append-only execution log for completed implementation work.

## Usage Rules

1. Add one entry per completed task or PR.
2. Do not delete old entries.
3. Mark `Done` only when work is actually completed and merged.
4. Include concrete file paths and concrete test commands.

## Active Work

Use this section for currently in-flight work. Move items to `Completed Items` when done.

| Date | Task/PR | Owner | Status | Scope | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-02-22 | None | n/a | Superseded | n/a | Replaced by scoped active audit entries below. |
| 2026-02-22 | AUDIT-RUNTIME-MIDDLEWARE-001 | codex | Done | `packages/polar-runtime-core/src/heartbeat-gateway.mjs`, `packages/polar-runtime-core/src/automation-gateway.mjs` | Fixed and moved to Completed Items entry `PR-HARDENING-MIDDLEWARE-002`. |
| 2026-02-22 | AUDIT-PLUGIN-AUTH-BINDINGS-001 | codex | Done | `packages/polar-runtime-core/src/plugin-installer-gateway.mjs` | Fixed and moved to Completed Items entry `PR-HARDENING-MIDDLEWARE-002`. |
| 2026-02-22 | AUDIT-MCP-EXPECTED-TOOL-IDS-001 | codex | Done | `packages/polar-runtime-core/src/mcp-connector-gateway.mjs` | Fixed and moved to Completed Items entry `PR-HARDENING-MIDDLEWARE-002`. |
| 2026-02-22 | AUDIT-STATUS-DRIFT-001 | codex | Done | `docs/status/current-status.md` | Status snapshot reconciled with implemented runtime gateways and regression-backed capabilities; moved to Completed Items entry `DOC-STATUS-ALIGN-002`. |
| 2026-02-22 | None | n/a | Clear | n/a | No active entries currently |

## Completed Items

Record completed work in reverse chronological order (newest first).

### 2026-02-23 - PR-13-MEMORY-HARDEN-002 - Contract-governed memory upsert/compaction gateway baseline

1. Status: Done
2. Owner: codex
3. Summary: Extended the Phase 5 memory service baseline by adding new Polar-owned typed contracts for `memory.upsert` and `memory.compact`, implementing runtime-core memory gateway execution paths for both operations through before/after middleware with strict request/result validation, and adding deterministic degraded-provider shaping and provider-payload normalization/error handling for write and compaction flows so no untyped or bypassed memory operation reaches runtime boundaries.
4. Files changed:
   - `packages/polar-domain/src/memory-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/memory-gateway.mjs`
   - `tests/runtime-core-memory-gateway.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-memory-gateway.test.mjs`
   - `npm run check`
6. Follow-up:
   - Wire memory gateway write/compaction operations to durable provider-backed persistence adapters and compaction policies.
   - Expose memory write/compaction operational controls and diagnostics through control-plane/Web UI workflows.
7. Blockers:
   - None.

### 2026-02-23 - PR-18-SCHEDULER-HARDEN-007 - Contract-governed scheduler queue run-action controls and durable dismissal hooks

1. Status: Done
2. Owner: codex
3. Summary: Extended scheduler governance with a new contract-registered queue run-action surface (`runtime.scheduler.event-queue.run-action`) that executes through before/after middleware, implemented typed queue-item dismissal for `retry` and `dead_letter` queues in scheduler runtime gateway, added durable file-state-store removal hooks (`removeRetryEvent`, `removeDeadLetterEvent`) so queue actions persist across restarts, and wired control-plane service proxying for operator-facing queue action invocation under the same contract/policy/audit path.
4. Files changed:
   - `packages/polar-domain/src/scheduler-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/scheduler-gateway.mjs`
   - `packages/polar-runtime-core/src/scheduler-state-store-file.mjs`
   - `packages/polar-control-plane/src/index.mjs`
   - `tests/runtime-core-scheduler-gateway.test.mjs`
   - `tests/runtime-core-scheduler-state-store-file.test.mjs`
   - `tests/control-plane-service.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-scheduler-gateway.test.mjs tests/runtime-core-scheduler-state-store-file.test.mjs tests/control-plane-service.test.mjs`
   - `npm run check`
   - Dev-only scheduler queue action smoke artifact generated at `file:///C:/Users/JAMES~1.DES/AppData/Local/Temp/polar-scheduler-queue-action-devtools-result.html` via `node - %TEMP%\\polar-scheduler-queue-action-devtools-result.html` and verified with Chrome DevTools MCP (`smoke=ok`, `actionStatus=applied`, `queueCount=0`, `contractCount=23`).
6. Follow-up:
   - Expand queue run-actions beyond dismiss (for example, operator-approved requeue/retry-now) with explicit policy gating.
   - Surface scheduler queue action controls in operator Web UI workflows with alert-routing integration.
7. Blockers:
   - None.

### 2026-02-23 - PR-18-SCHEDULER-HARDEN-006 - File-backed scheduler state-store adapter and control-plane queue diagnostics proxy baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented a concrete durable scheduler state-store adapter (`createFileSchedulerStateStore`) that persists processed/retry/dead-letter queue records with strict event-shape validation and deterministic serialized writes, extended scheduler contracts/gateway with a contract-governed queue diagnostics surface (`runtime.scheduler.event-queue.list`) including typed filters and summary outputs, and wired control-plane service proxying so operator surfaces can query scheduler retry/dead-letter diagnostics through the same middleware and contract enforcement path.
4. Files changed:
   - `packages/polar-domain/src/scheduler-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/scheduler-gateway.mjs`
   - `packages/polar-runtime-core/src/scheduler-state-store-file.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-control-plane/src/index.mjs`
   - `tests/runtime-core-scheduler-gateway.test.mjs`
   - `tests/runtime-core-scheduler-state-store-file.test.mjs`
   - `tests/control-plane-service.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-scheduler-state-store-file.test.mjs tests/runtime-core-scheduler-gateway.test.mjs tests/control-plane-service.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Add production-grade scheduler durability adapters (database/queue-backed stores) and migration strategy from file-backed baseline.
   - Integrate scheduler queue diagnostics into operator Web UI workflows and alert routing actions.
7. Blockers:
   - None.

### 2026-02-23 - PR-18-SCHEDULER-HARDEN-005 - Typed retry/dead-letter orchestration and scheduler state-store hooks baseline

1. Status: Done
2. Owner: codex
3. Summary: Extended the contract-governed persisted scheduler/event gateway with typed retry/dead-letter orchestration by adding explicit attempt/max-attempt/backoff/dead-letter policy inputs and disposition outputs, implementing deterministic retry scheduling and dead-letter routing for failed automation/heartbeat event execution, and adding pluggable scheduler state-store hooks (`hasProcessedEvent`, `storeProcessedEvent`, `storeRetryEvent`, `storeDeadLetterEvent`) so durable queue/storage adapters can be integrated without bypassing middleware, contracts, or audit flows.
4. Files changed:
   - `packages/polar-domain/src/scheduler-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/scheduler-gateway.mjs`
   - `tests/runtime-core-scheduler-gateway.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-scheduler-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Wire `schedulerStateStore` hooks to concrete durable queue/storage backends.
   - Add control-plane and Web UI diagnostics for retry/dead-letter queue visibility and operations.
7. Blockers:
   - None.

### 2026-02-23 - PR-19-COST-TELEMETRY-002 - Contract-governed telemetry alert synthesis gateway and control-plane proxy baseline

1. Status: Done
2. Owner: codex
3. Summary: Added a new contract-governed telemetry alert synthesis surface (`runtime.telemetry.alerts.list`) that evaluates usage and handoff telemetry windows with deterministic threshold rules (failure/fallback/duration and route-adjustment/failure rates), emits typed warning/critical alert records, and runs entirely through before/after middleware; wired control-plane service proxying for operator access to alert outputs, expanded runtime/control-plane tests for strict validation and middleware coverage, and validated the new control-plane endpoint via a dev-only Chrome DevTools MCP smoke artifact.
4. Files changed:
   - `packages/polar-domain/src/telemetry-alert-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/telemetry-alert-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-control-plane/src/index.mjs`
   - `tests/runtime-core-telemetry-alert-gateway.test.mjs`
   - `tests/control-plane-service.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-telemetry-alert-gateway.test.mjs tests/runtime-core-usage-telemetry-gateway.test.mjs tests/runtime-core-handoff-telemetry-gateway.test.mjs tests/control-plane-service.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
   - Dev-only telemetry alert smoke artifact generated at `file:///C:/Users/JAMES~1.DES/AppData/Local/Temp/polar-telemetry-alert-devtools-result.html` via `node - %TEMP%\\polar-telemetry-alert-devtools-result.html` and verified with Chrome DevTools MCP (`telemetryStatus=ok`, `alertCount=0`, `scope=all`, `contractCount=19`).
6. Follow-up:
   - Wire telemetry alert outputs into operator Web UI dashboards and alert-routing policy workflows.
   - Add persisted alert history and escalation delivery channels (task-board, notification sinks, policy webhooks).
7. Blockers:
   - None.

### 2026-02-23 - PR-18-TASK-BOARD-004 - Contract-governed persisted scheduler/event execution and run-link replay runner baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented persisted scheduler/event execution depth by adding new contract-governed scheduler actions for processing persisted automation/heartbeat run envelopes and replaying recorded run-link events, wiring a runtime scheduler gateway that dispatches persisted events through existing automation/heartbeat gateways under before/after middleware with deterministic typed rejection/failure shaping and sequence-stamped event ledgering, and extending integration tests to verify task-board-linked outcomes plus idempotent replay behavior.
4. Files changed:
   - `packages/polar-domain/src/scheduler-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/scheduler-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `tests/runtime-core-scheduler-gateway.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-scheduler-gateway.test.mjs tests/runtime-core-task-board-run-linker.test.mjs tests/runtime-core-automation-gateway.test.mjs tests/runtime-core-heartbeat-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Connect scheduler gateway inputs to durable queue/storage adapters so replay survives process restarts without in-memory ledgers.
   - Expose scheduler event/replay diagnostics through control-plane/Web UI operator views and alert routing policies.
7. Blockers:
   - None.

### 2026-02-23 - PR-19-COST-TELEMETRY-001 - Provider usage telemetry collector and control-plane list/summary baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented a Phase 8 observability baseline by adding a new contract-governed usage telemetry list surface (`runtime.usage-telemetry.list`) with strict typed filters and summary payloads, a runtime usage telemetry collector with deterministic sequence/timestamp capture and summary aggregation (`fallbackUsed`, duration, optional model lane and estimated cost), provider-gateway telemetry emission on both success and terminal failure paths (including fallback attempt lineage), and control-plane service proxy wiring plus health visibility for usage telemetry counts.
4. Files changed:
   - `packages/polar-domain/src/usage-telemetry-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/provider-gateway.mjs`
   - `packages/polar-runtime-core/src/usage-telemetry.mjs`
   - `packages/polar-runtime-core/src/usage-telemetry-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-control-plane/src/index.mjs`
   - `tests/runtime-core-usage-telemetry-gateway.test.mjs`
   - `tests/control-plane-service.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-provider-gateway.test.mjs tests/runtime-core-usage-telemetry-gateway.test.mjs tests/control-plane-service.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
   - Dev-only control-plane smoke artifact generated at `file:///C:/Users/JAMES~1.DES/AppData/Local/Temp/polar-usage-telemetry-devtools-result.html` via `node %TEMP%\\polar-usage-telemetry-devtools-smoke.mjs %TEMP%\\polar-usage-telemetry-devtools-result.html` and verified with Chrome DevTools MCP (`telemetryStatus=ok`, `returnedCount=0`, `totalOperations=0`, `contractCount=18`, `usageTelemetryCount=0`).
6. Follow-up:
   - Expose usage telemetry list/summary outputs in operator Web UI dashboards and alert routing views.
   - Add budget-policy enforcement actions that consume usage telemetry and gate high-frequency automation lanes.
7. Blockers:
   - None.

### 2026-02-23 - PR-08-HANDOFF-TELEMETRY-006 - Scoped routing telemetry filters and continuity fixture expansion

1. Status: Done
2. Owner: codex
3. Summary: Extended handoff routing telemetry list surfaces with strict typed filters (`sessionId`, `workspaceId`, `sourceAgentId`, `status`) across domain contracts, runtime collector filtering, and runtime telemetry gateway request validation; enriched emitted telemetry events with stable run-context fields (`sessionId`, `workspaceId`, `userId`) so operator telemetry consumers can segment fanout/fanin flows deterministically; and expanded handoff telemetry regression fixtures to assert cross-run session continuity pagination plus scoped filtering behavior.
4. Files changed:
   - `packages/polar-domain/src/handoff-telemetry-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/handoff-routing-telemetry.mjs`
   - `packages/polar-runtime-core/src/handoff-telemetry-gateway.mjs`
   - `tests/runtime-core-handoff-routing-telemetry.test.mjs`
   - `tests/runtime-core-handoff-telemetry-gateway.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-handoff-routing-telemetry.test.mjs tests/runtime-core-handoff-telemetry-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Wire scoped handoff telemetry filters into operator Web UI dashboards and alert-routing policy views.
   - Add orchestrator integration fixtures that assert routing diagnostics and telemetry continuity across policy/budget context overlays.
7. Blockers:
   - None.

### 2026-02-23 - PR-MAINT-SECURITY-AUDIT-003 - Transitive vulnerability remediation and gitignore hygiene

1. Status: Done
2. Owner: codex
3. Summary: Resolved `npm audit` high-severity transitive vulnerabilities in the `gaxios -> rimraf -> glob -> minimatch` chain by adding root dependency overrides and regenerating lock resolution, resulting in `0` reported vulnerabilities; also expanded repository `.gitignore` coverage for Node dependency/cache artifacts, build outputs, and future `.env*` secret files while preserving common template env files.
4. Files changed:
   - `package.json`
   - `package-lock.json`
   - `.gitignore`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm audit --json`
   - `npm run check`
6. Follow-up:
   - Re-run `npm audit` during dependency bumps and keep root overrides aligned with upstream package releases.
7. Blockers:
   - None.

### 2026-02-23 - PR-MAINT-PI-MONO-TRIM-002 - Remove local pi-mono snapshot and pin runtime package dependencies

1. Status: Done
2. Owner: codex
3. Summary: Declared explicit runtime dependencies for `@polar/adapter-pi` (`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`), verified both packages resolve from npm-installed modules, and removed the remaining local `pi-mono-main` snapshot now that Polar consumes published package artifacts.
4. Files changed:
   - `packages/polar-adapter-pi/package.json`
   - `package-lock.json`
   - `pi-mono-main` (removed)
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm ls @mariozechner/pi-ai @mariozechner/pi-agent-core`
   - `node -e "Promise.all([import('@mariozechner/pi-ai'), import('@mariozechner/pi-agent-core')]).then(() => { console.log('ok') }).catch((error) => { console.error(error); process.exit(1); });"`
   - `npm run check`
6. Follow-up:
   - Track upstream `@mariozechner/pi-*` releases and refresh adapter compatibility tests during dependency upgrades.
7. Blockers:
   - None.

### 2026-02-23 - PR-MAINT-PI-MONO-TRIM-001 - Trim unused local pi-mono package snapshots

1. Status: Done
2. Owner: codex
3. Summary: Removed unused local `pi-mono-main` package trees (`coding-agent`, `mom`, `pods`, `tui`) to keep only selected foundation snapshots (`ai`, `agent`, `web-ui`) aligned with Polar adapter integration boundaries; no Polar runtime contract, middleware, or adapter behavior changed.
4. Files changed:
   - `pi-mono-main/packages/coding-agent` (removed)
   - `pi-mono-main/packages/mom` (removed)
   - `pi-mono-main/packages/pods` (removed)
   - `pi-mono-main/packages/tui` (removed)
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - If Polar starts using additional upstream pi packages, re-introduce only required package snapshots or pin published package versions directly.
7. Blockers:
   - None.

### 2026-02-23 - PR-08-HANDOFF-TELEMETRY-005 - Middleware-based handoff routing telemetry collector baseline

1. Status: Done
2. Owner: codex
3. Summary: Added a new runtime-core handoff routing telemetry collector that ships as execution-type-scoped middleware (`handoff`) and records deterministic resolver-aware route telemetry events (`requestedMode`, `resolvedMode`, target counts, adjustment reasons, profile-resolution status) from typed handoff routing diagnostics; included strict list/filter request validation, fail-closed telemetry sink behavior through middleware, and hardened handoff failure payload shaping to avoid non-JSON `traceId: undefined` fields under strict contract validation.
4. Files changed:
   - `packages/polar-runtime-core/src/handoff-routing-telemetry.mjs`
   - `packages/polar-runtime-core/src/handoff-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `tests/runtime-core-handoff-routing-telemetry.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-handoff-routing-telemetry.test.mjs tests/runtime-core-handoff-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Expose telemetry-collector list/filter surfaces through orchestrator/control-plane views.
   - Add orchestrator fanout/fanin fixtures that assert cross-run telemetry continuity and route-adjustment diagnostics.
7. Blockers:
   - None.

### 2026-02-23 - PR-08-HANDOFF-TELEMETRY-004 - Resolver-aware handoff routing diagnostics and context telemetry baseline

1. Status: Done
2. Owner: codex
3. Summary: Extended handoff contract-governed orchestration telemetry by adding typed `routingDiagnostics` fields on handoff input/output surfaces, generating deterministic resolver-aware routing diagnostics (requested vs resolved mode/target counts, adjustment reasons, and resolved-profile routing constraints), and merging diagnostics into provided handoff `policyContext`/`traceMetadata` contexts so upstream orchestrator consumers can trace profile-policy route decisions without bypassing middleware or contracts.
4. Files changed:
   - `packages/polar-domain/src/handoff-contracts.mjs`
   - `packages/polar-runtime-core/src/handoff-gateway.mjs`
   - `tests/runtime-core-handoff-gateway.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-handoff-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Wire orchestrator-level telemetry consumers/dashboards to ingest new `routingDiagnostics` outputs and trace-context enrichments.
   - Add end-to-end orchestrator fixtures that assert diagnostics propagation across fanout/fanin runs with policy/budget context overlays.
7. Blockers:
   - None.

### 2026-02-23 - PR-08-HANDOFF-PROFILE-003 - Resolver-aware handoff routing-policy constraint baseline

1. Status: Done
2. Owner: codex
3. Summary: Extended handoff orchestration depth by feeding resolved profile context into routing-policy decisions, adding deterministic profile-config routing constraints (`allowedHandoffModes`, optional `defaultHandoffMode`, and `maxFanoutAgents`), and moving profile resolution ahead of routing so delegation/fanout route selection and capability projection both consume the same resolved profile surface; expanded handoff tests to cover constrained fanout truncation, policy-driven delegate-to-direct rerouting, and preferred-mode rejection when blocked by resolved profile policy.
4. Files changed:
   - `packages/polar-runtime-core/src/routing-policy-engine.mjs`
   - `packages/polar-runtime-core/src/handoff-gateway.mjs`
   - `tests/runtime-core-handoff-gateway.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-handoff-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Integrate resolved-profile routing-policy outcomes into orchestrator-level policy telemetry and trace diagnostics.
   - Add orchestrator fixture coverage that combines routing constraints with policy/budget contexts across fanout/fanin execution.
7. Blockers:
   - None.

### 2026-02-23 - DOC-LOG-BLOCKERS-001 - Blocker/status reconciliation for recent profile and handoff deliveries

1. Status: Done
2. Owner: codex
3. Summary: Audited the latest shipped entries (`PR-03-PROFILE-RESOLUTION-001`, `PR-03-PROFILE-RESOLUTION-002`, `PR-08-HANDOFF-PROFILE-002`) and reconciled blocker tracking by explicitly recording that no hard blockers were present at completion time, while preserving concrete dependency-style follow-ups (orchestrator integration depth and persisted scheduler/event integration) as outstanding next work.
4. Files changed:
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - Manual reconciliation audit of latest completed entries against `docs/status/current-status.md` immediate priorities and `docs/status/roadmap.md` next milestones.
6. Follow-up:
   - Continue logging blockers per completed item as explicit `Blockers` lines whenever a hard blocker exists; use `Blockers: none` when clear.
7. Blockers:
   - None at reconciliation time. Outstanding items are roadmap follow-ups, not hard blockers.

### 2026-02-23 - PR-08-HANDOFF-PROFILE-002 - Resolver-aware delegated handoff profile projection baseline

1. Status: Done
2. Owner: codex
3. Summary: Extended handoff contracts and runtime gateway to support resolver-aware profile context on delegated/fanout handoffs by adding optional workspace/default profile inputs and resolved-profile output fields, integrating optional profile resolution in handoff execution (with deterministic typed failure when resolution is attempted but unresolved), and applying profile-config capability constraints (`allowedTools`, `allowedExtensions`, `maxToolCalls`) into delegated scope projection while preserving prior behavior when no resolver is configured.
4. Files changed:
   - `packages/polar-domain/src/handoff-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/handoff-gateway.mjs`
   - `tests/runtime-core-handoff-gateway.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-handoff-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Integrate resolver-aware handoff profile context into orchestrator-level routing decisions and policy telemetry.
   - Add parity tests for fanout/fanin projection under profile constraints with orchestrator-level fixtures.

### 2026-02-23 - PR-03-PROFILE-RESOLUTION-002 - Resolver-aware profile fallback in automation and heartbeat gateways

1. Status: Done
2. Owner: codex
3. Summary: Extended automation and heartbeat execution entry paths to support resolver-driven profile fallback when `profileId` is omitted by adding typed optional session/workspace/default profile inputs, integrating resolver callbacks inside middleware-validated execution callbacks, emitting deterministic typed outcomes when profile resolution fails (`automation` blocked with `profile_not_resolved`, `heartbeat` skipped with `profile_not_resolved`), and preserving task run-link emission only when a concrete resolved profile id is available.
4. Files changed:
   - `packages/polar-domain/src/automation-contracts.mjs`
   - `packages/polar-domain/src/heartbeat-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/automation-gateway.mjs`
   - `packages/polar-runtime-core/src/heartbeat-gateway.mjs`
   - `tests/runtime-core-automation-gateway.test.mjs`
   - `tests/runtime-core-heartbeat-gateway.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-automation-gateway.test.mjs tests/runtime-core-heartbeat-gateway.test.mjs tests/runtime-core-task-board-run-linker.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Integrate resolved profile outputs into orchestrator routing/handoff capability projection paths.
   - Extend persisted scheduler/event runners to supply resolution-scope context and policy projection metadata.

### 2026-02-23 - PR-03-PROFILE-RESOLUTION-001 - Runtime profile pinning/resolution contract baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented a new contract-governed runtime profile resolution baseline by adding typed `profile.resolve` contracts/gateway with deterministic `session -> workspace -> global -> default` precedence over existing control-plane config surfaces, exposed `resolveProfile` through the control-plane service, added control-plane record-read support for internal profile resolver composition without bypassing middleware/contract boundaries, and expanded runtime-core/control-plane tests for resolution precedence, deterministic `not_found` behavior, invalid pin policy rejection, and updated service contract counts.
4. Files changed:
   - `packages/polar-domain/src/profile-resolution-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/profile-resolution-gateway.mjs`
   - `packages/polar-runtime-core/src/control-plane-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-control-plane/src/index.mjs`
   - `tests/runtime-core-profile-resolution-gateway.test.mjs`
   - `tests/runtime-core-control-plane-gateway.test.mjs`
   - `tests/control-plane-service.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-profile-resolution-gateway.test.mjs tests/runtime-core-control-plane-gateway.test.mjs tests/control-plane-service.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
   - Dev-only profile-resolution smoke artifact generated at `file:///C:/Users/JAMES~1.DES/AppData/Local/Temp/polar-profile-resolution-devtools-result.html` and verified with Chrome DevTools MCP (`status=resolved`, `resolvedScope=session`, `contractCount=16`).
6. Follow-up:
   - Integrate profile resolution into orchestrator/heartbeat/automation execution entry paths.
   - Add scoped capability and policy projection tests that consume resolved profile outputs across delegated/handoff workflows.

### 2026-02-23 - PR-07-INGRESS-HEALTH-004 - Control-plane ingress diagnostics proxy baseline

1. Status: Done
2. Owner: codex
3. Summary: Extended the control-plane service with a contract-governed ingress diagnostics proxy by registering chat-ingress contracts in the shared control-plane middleware pipeline and exposing `checkIngressHealth` backed by default web/Telegram/Slack/Discord adapter probes; expanded control-plane tests to validate healthy diagnostics output, middleware execution, typed validation rejection, and updated contract-count visibility while reconciling status/roadmap/program docs to reflect the shipped diagnostics baseline and remaining UI/alert integration work.
4. Files changed:
   - `packages/polar-control-plane/src/index.mjs`
   - `tests/control-plane-service.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/control-plane-service.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
   - Dev-only ingress diagnostics smoke artifact generated at `file:///C:/Users/JAMES~1.DES/AppData/Local/Temp/polar-ingress-health-devtools-result.html` and verified with Chrome DevTools MCP (`ingressStatus=healthy`, `resultCount=4`, `contractCount=15`).
6. Follow-up:
   - Integrate control-plane ingress diagnostics into operator Web UI views and alert workflow routing.
   - Add persisted ingress diagnostics history and policy-driven alert thresholds.

### 2026-02-23 - PR-18-TASK-BOARD-003 - Contract-governed run-link replay ingestion baseline

1. Status: Done
2. Owner: codex
3. Summary: Extended the task-board baseline with a new contract-registered replay operation (`task-board.run-link.replay`) that ingests deterministic run-link records under middleware/audit enforcement with idempotent replay-key semantics, updated the task-board run-linker to drive linking through this replay path and added replay-from-ledger support, and extended control-plane service/task-board tests to validate replay ingestion, duplicate-skip determinism, and updated health visibility.
4. Files changed:
   - `packages/polar-domain/src/task-board-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/task-board-gateway.mjs`
   - `packages/polar-runtime-core/src/task-board-run-linker.mjs`
   - `packages/polar-control-plane/src/index.mjs`
   - `tests/runtime-core-task-board-gateway.test.mjs`
   - `tests/runtime-core-task-board-run-linker.test.mjs`
   - `tests/control-plane-service.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-task-board-gateway.test.mjs tests/runtime-core-task-board-run-linker.test.mjs tests/runtime-core-automation-gateway.test.mjs tests/runtime-core-heartbeat-gateway.test.mjs tests/control-plane-service.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
   - Dev-only replay smoke artifact generated at `file:///C:/Users/JAMES~1.DES/AppData/Local/Temp/polar-taskboard-replay-devtools-result.html` for control-plane replay outcome verification.
6. Follow-up:
   - Wire persisted scheduler/event producers to emit replay records into the new replay ingestion path.
   - Deliver operator Web UI stream consumers and diagnostics for replay-linked task events.

### 2026-02-23 - PR-18-TASK-BOARD-002 - Automation and heartbeat run-link wiring into task-board event stream

1. Status: Done
2. Owner: codex
3. Summary: Wired automatic runtime run-link integration by adding a typed task-board run-linker that normalizes automation and heartbeat run outcomes into deterministic task upsert + transition operations, integrated optional run-link hooks into automation and heartbeat gateways so each run outcome can emit task-board events on the same middleware/contract path, and added integration tests validating linked task state and event-stream outputs for executed/skipped heartbeat and automation outcomes with deterministic typed request rejection.
4. Files changed:
   - `packages/polar-runtime-core/src/task-board-run-linker.mjs`
   - `packages/polar-runtime-core/src/automation-gateway.mjs`
   - `packages/polar-runtime-core/src/heartbeat-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `tests/runtime-core-task-board-run-linker.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-automation-gateway.test.mjs tests/runtime-core-heartbeat-gateway.test.mjs tests/runtime-core-task-board-gateway.test.mjs tests/runtime-core-task-board-run-linker.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Extend run-link ingestion from gateway-level hooks to persisted scheduler/event execution and replay workflows.
   - Deliver operator Web UI task-board stream consumers and diagnostics for linked automation/heartbeat run events.

### 2026-02-22 - PR-18-TASK-BOARD-001 - Phase 7 task-board runtime and live-update gateway baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented a Polar-owned typed task-board baseline by adding contract-registered task upsert, status transition, task listing, and task-event listing operations; added a runtime-core task-board gateway that enforces deterministic status transitions, optimistic version conflict handling, and append-only task event stream emission through before/after middleware; and extended the control-plane service to proxy task-board operations and health counts while reconciling status/roadmap/program docs to reflect the shipped backend baseline and remaining UI/runtime-link work.
4. Files changed:
   - `packages/polar-domain/src/task-board-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/task-board-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-control-plane/src/index.mjs`
   - `tests/runtime-core-task-board-gateway.test.mjs`
   - `tests/control-plane-service.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-task-board-gateway.test.mjs tests/control-plane-service.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Wire persisted scheduler/event automation and heartbeat outcomes into automatic task-board run-link events.
   - Deliver operator Web UI task-board views and live stream consumers on top of the shipped task-board backend contracts.

### 2026-02-22 - PR-07-SESSION-CONTINUITY-004 - Cross-channel native threading continuity parity baseline

1. Status: Done
2. Owner: codex
3. Summary: Hardened canonical ingress continuity behavior by adding typed Telegram native threading fields (`messageThreadId`, `replyToMessageId`) and Discord parent-message threading field (`parentMessageId`) with deterministic `threadId` derivation, then expanded adapter and runtime-gateway parity tests to validate stable multi-turn `sessionId`/`threadId` continuity across web/Telegram/Slack/Discord under channel-native threading inputs.
4. Files changed:
   - `packages/polar-adapter-channels/src/index.mjs`
   - `tests/adapter-channels-normalization.test.mjs`
   - `tests/runtime-core-chat-ingress-gateway.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/adapter-channels-normalization.test.mjs tests/runtime-core-chat-ingress-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Expose ingress continuity and health diagnostics in control-plane operator surfaces and alerts.

### 2026-02-22 - PR-07-INGRESS-HEALTH-003 - Channel ingress health-check and conformance baseline

1. Status: Done
2. Owner: codex
3. Summary: Added a typed `chat.ingress.health.check` operation to the chat ingress contract set and runtime gateway so ingress health evaluation executes through the same middleware/audit path as normalization, implemented default web/Telegram/Slack/Discord adapter conformance probes in `polar-adapter-channels`, and expanded ingress test coverage for healthy/unhealthy adapter health outcomes plus deterministic request rejection.
4. Files changed:
   - `packages/polar-domain/src/chat-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-adapter-channels/src/index.mjs`
   - `packages/polar-runtime-core/src/chat-ingress-gateway.mjs`
   - `tests/adapter-channels-normalization.test.mjs`
   - `tests/runtime-core-chat-ingress-gateway.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/adapter-channels-normalization.test.mjs tests/runtime-core-chat-ingress-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Extend multi-turn/session continuity parity coverage across web/Telegram/Slack/Discord and expose ingress health diagnostics in control-plane operator surfaces.

### 2026-02-22 - PR-07-DISCORD-INGRESS-002 - Phase 2 Discord canonical ingress parity baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented Discord canonical ingress normalization on the same contract-registered middleware path as web/Telegram/Slack by extending the ingress adapter contract set, adding a transport-only Discord channel normalizer with deterministic id/timestamp/metadata shaping, and extending adapter/runtime parity tests to enforce deterministic typed validation failures across all four adapters; reconciled status/roadmap/program docs to reflect the shipped Discord ingress baseline and updated immediate priorities accordingly.
4. Files changed:
   - `packages/polar-domain/src/chat-contracts.mjs`
   - `packages/polar-adapter-channels/src/index.mjs`
   - `packages/polar-runtime-core/src/chat-ingress-gateway.mjs`
   - `tests/adapter-channels-normalization.test.mjs`
   - `tests/runtime-core-chat-ingress-gateway.test.mjs`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/adapter-channels-normalization.test.mjs tests/runtime-core-chat-ingress-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Extend multi-turn/session continuity parity and channel-health conformance coverage across web/Telegram/Slack/Discord.

### 2026-02-22 - DOC-AGENTS-COMMS-004 - Agent message percentage rule and reconciliation lessons update

1. Status: Done
2. Owner: codex
3. Summary: Updated repository-level `AGENTS.md` to require a terminal `Progress: NN%` line in every user-facing response and added explicit documentation reconciliation lessons from recent status/roadmap/program alignment work so future agents keep execution-state docs synchronized with implementation-log and test-backed reality.
4. Files changed:
   - `AGENTS.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Enforce the same response-format convention in any future agent-specific guides if new sub-repo `AGENTS.md` files are introduced.

### 2026-02-22 - DOC-ROADMAP-ALIGN-003 - Roadmap and program baseline alignment with shipped implementation state

1. Status: Done
2. Owner: codex
3. Summary: Reworked `docs/status/roadmap.md` from pre-implementation planning language to an execution-aware roadmap with explicit 2026-02-22 status snapshot (shipped baselines plus next milestones) across foundation tracks and phases, and updated `docs/implementation/implementation-program-overview.md` baseline wording to reflect that core invariants and gateway baselines are already implemented while hardening/integration work remains.
4. Files changed:
   - `docs/status/roadmap.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - Manual cross-check against `docs/status/current-status.md` and completed PR history in `docs/implementation/implementation-log.md`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Keep roadmap snapshot and phase milestones synchronized with upcoming delivery updates (Discord ingress, profile-resolution runtime, scheduler/event automation pipeline, and Web UI/task-board milestones).

### 2026-02-22 - DOC-STATUS-ALIGN-002 - Status snapshot reconciliation with implemented runtime baseline

1. Status: Done
2. Owner: codex
3. Summary: Reconciled capability and priority status reporting in `docs/status/current-status.md` to match shipped runtime behavior captured in the implementation log and test suite, including updating previously stale `Planned` entries for heartbeat/memory/automation/plugin/middleware paths to reflect implemented gateway baselines and shifting immediate priorities to remaining integration and delivery work.
4. Files changed:
   - `docs/status/current-status.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - Manual cross-check against `docs/implementation/implementation-log.md` completed-item history and current runtime test inventory.
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Keep capability statuses synchronized with completed PR entries as Discord parity, profile resolution, scheduler/event automation pipeline, and Web UI/task-board milestones land.

### 2026-02-22 - PR-HARDENING-MIDDLEWARE-002 - Middleware-derived input enforcement and extension installer patch handling

1. Status: Done
2. Owner: codex
3. Summary: Fixed four middleware enforcement gaps by deriving heartbeat and automation execution gating/lane/step calculations from middleware-validated input inside execution callbacks, switching plugin installer auth-binding verification to use middleware-updated input instead of pre-pipeline parsed state, and switching MCP expected-tool-id verification to use middleware-validated input so before-middleware patches are enforced for guardrail checks; added regression tests for all four paths.
4. Files changed:
   - `packages/polar-runtime-core/src/heartbeat-gateway.mjs`
   - `packages/polar-runtime-core/src/automation-gateway.mjs`
   - `packages/polar-runtime-core/src/plugin-installer-gateway.mjs`
   - `packages/polar-runtime-core/src/mcp-connector-gateway.mjs`
   - `tests/runtime-core-heartbeat-gateway.test.mjs`
   - `tests/runtime-core-automation-gateway.test.mjs`
   - `tests/runtime-core-plugin-installer-gateway.test.mjs`
   - `tests/runtime-core-mcp-connector-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Close `AUDIT-STATUS-DRIFT-001` by reconciling `docs/status/current-status.md` with shipped runtime behavior and test coverage.

### 2026-02-22 - PR-17-CHAT-MGMT-FOUNDATION-001 - Phase 7 web UI chat-management foundation baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented a contract-governed chat-management foundation for Web UI surfaces by adding typed runtime operations for message append, session listing, session history retrieval, message search, and session retention policy application; added a new runtime-core chat-management gateway that executes all operations through middleware with deterministic pagination/filtering and typed rejection/retention outcomes; and extended the control-plane service to expose these chat-management endpoints using a shared contract registry + middleware pipeline alongside existing config API operations.
4. Files changed:
   - `packages/polar-domain/src/chat-management-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/chat-management-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-control-plane/src/index.mjs`
   - `tests/runtime-core-chat-management-gateway.test.mjs`
   - `tests/control-plane-service.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-chat-management-gateway.test.mjs tests/control-plane-service.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-18 task board + live updates baseline (task entity model, status transitions, runtime event linkage, and deterministic update stream contracts).

### 2026-02-22 - PR-16-CONTROL-PLANE-API-001 - Phase 7 control-plane configuration API baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented control-plane configuration API baseline with Polar-owned typed contracts and runtime gateway for config upsert/get/list across runtime-critical resource surfaces (`profile`, `channel`, `extension`, `policy`, `automation`), added deterministic optimistic-lock version conflict handling, typed cursor-based listing, and middleware/audit execution for all control-plane operations; upgraded `polar-control-plane` service from placeholder health-only behavior to a contract-governed config service backed by runtime-core contract registry and middleware pipeline.
4. Files changed:
   - `packages/polar-domain/src/control-plane-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/control-plane-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-control-plane/src/index.mjs`
   - `tests/runtime-core-control-plane-gateway.test.mjs`
   - `tests/control-plane-service.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-control-plane-gateway.test.mjs tests/control-plane-service.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-17 web UI foundation and chat management baseline with control-plane-backed session/history/search/retention views and deterministic UI state contracts.

### 2026-02-22 - PR-15-AUTOMATION-EXECUTOR-001 - Phase 6 automation draft and executor baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented chat-intent automation authoring and run execution baseline with Polar-owned typed contracts for `automation.draft.from-intent` and `automation.run.execute`, added runtime-core automation gateway that runs both authoring and execution through contract-registered middleware, implemented deterministic automation gating (inactive policy, queue backpressure, budget limits, approval-required blocking), local-model-first lane selection with escalation routing, and typed run outcomes (`executed`, `skipped`, `blocked`, `failed`) including retry/dead-letter eligibility fields.
4. Files changed:
   - `packages/polar-domain/src/automation-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/automation-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `tests/runtime-core-automation-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-automation-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-16 control-plane API baseline for runtime-critical configuration surfaces (profiles/channels/extensions/policies/automations) backed by typed contract-governed runtime gateways.

### 2026-02-22 - PR-14-HEARTBEAT-RUNTIME-001 - Phase 6 heartbeat policy runtime baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented typed heartbeat runtime baseline with a Polar-owned heartbeat tick contract and runtime gateway that executes through middleware as `executionType=heartbeat`, added deterministic policy gating for inactive policy, active-hours windows, empty-check skips, queue backpressure, and budget limits, and implemented local-model-first lane selection with explicit escalation policy to `worker`/`brain` based on failure thresholds or forced escalation while preserving typed executed/skipped outcomes.
4. Files changed:
   - `packages/polar-domain/src/heartbeat-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/heartbeat-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `tests/runtime-core-heartbeat-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-heartbeat-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-15 automation authoring and executor baseline (chat-intent draft contract, trigger/run-plan validation, and automation run outcomes through automation/heartbeat middleware paths).

### 2026-02-22 - PR-13-MEMORY-SERVICE-001 - Phase 6 structured memory retrieval gateway baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented structured memory retrieval baseline with Polar-owned typed contracts for `memory.search` and `memory.get`, added runtime-core memory gateway that executes both retrieval paths through contract-registered before/after middleware, introduced deterministic degraded-output behavior when memory providers are unavailable (instead of silent failures), and added strict request/result normalization plus typed failure propagation for invalid provider payloads.
4. Files changed:
   - `packages/polar-domain/src/memory-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/memory-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `tests/runtime-core-memory-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-memory-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-14 heartbeat policy runtime baseline (typed heartbeat policy fields, run gating, and local-model-first escalation policy through automation/heartbeat middleware paths).

### 2026-02-22 - PR-12-PLUGIN-INSTALLER-001 - Phase 5 plugin descriptor mapping and governance baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented Claude-plugin-compatible descriptor onboarding through a Polar-owned plugin installer contract and runtime gateway that executes through contract-registered middleware, added adapter-level plugin descriptor mapping/auth-binding verification/capability wrapping, enforced source trust policy, permission-delta approval gating, descriptor-hash verification, lifecycle parity (`install`/`upgrade` + optional enable), and extension-registry execution wiring so plugin capabilities run through the same extension governance/middleware path as skills and MCP.
4. Files changed:
   - `packages/polar-domain/src/plugin-installer-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-adapter-extensions/src/plugin-connector.mjs`
   - `packages/polar-adapter-extensions/src/index.mjs`
   - `packages/polar-runtime-core/src/plugin-installer-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `tests/adapter-extensions.test.mjs`
   - `tests/runtime-core-plugin-installer-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/adapter-extensions.test.mjs tests/runtime-core-plugin-installer-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-13 structured memory service baseline (`memory_search`, `memory_get`, constrained retrieval failure shaping) with the same contract + middleware enforcement model.

### 2026-02-22 - PR-HARDENING-SECURITY-001 - Runtime hardening bugfix sweep for contract/policy bypass paths

1. Status: Done
2. Owner: codex
3. Summary: Closed multiple runtime hardening gaps by enforcing strict JSON-value validation in contract fields, making middleware fail-closed so `after` middleware cannot clear or override pre-existing errors, locking extension execution trust to persisted state, preventing extension type mutation for existing extension ids, removing request-level approval policy override inputs from skill/MCP install-sync gateway requests, and fixing reinstall semantics so removed skills/MCP extensions are treated as fresh `install` operations rather than invalid `upgrade`; also sanitized channel/provenance metadata assembly to avoid emitting undefined values under strict JSON enforcement.
4. Files changed:
   - `packages/polar-domain/src/runtime-contracts.mjs`
   - `packages/polar-runtime-core/src/middleware-pipeline.mjs`
   - `packages/polar-runtime-core/src/extension-gateway.mjs`
   - `packages/polar-runtime-core/src/skill-installer-gateway.mjs`
   - `packages/polar-runtime-core/src/mcp-connector-gateway.mjs`
   - `packages/polar-adapter-channels/src/index.mjs`
   - `packages/polar-adapter-extensions/src/skill-installer.mjs`
   - `tests/runtime-contracts-json-field.test.mjs`
   - `tests/runtime-core-contract-middleware.test.mjs`
   - `tests/runtime-core-extension-gateway.test.mjs`
   - `tests/runtime-core-skill-installer-gateway.test.mjs`
   - `tests/runtime-core-mcp-connector-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Apply the same non-overridable policy-source pattern to future plugin installer/governance surfaces in PR-12 so approval/trust controls remain policy-owned across all extension types.

### 2026-02-22 - PR-11-MCP-CONNECTOR-001 - Phase 5 MCP connector and wrapper lifecycle baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented MCP connector baseline with Polar-owned typed sync contract and runtime gateway that executes connection health probing, tool catalog import, catalog hash/tool-id parity checks, trust/source policy evaluation, permission-delta approval gating, lifecycle transitions, and capability wrapper registration through the existing extension contract + middleware path; added adapter-level MCP catalog mapping, health normalization, connection adapter helpers, and capability wrappers so MCP tool calls execute through extension governance without bypassing policy, contract validation, or audit pipelines.
4. Files changed:
   - `packages/polar-domain/src/mcp-connector-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/mcp-connector-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-adapter-extensions/src/mcp-connector.mjs`
   - `packages/polar-adapter-extensions/src/index.mjs`
   - `tests/adapter-extensions.test.mjs`
   - `tests/runtime-core-mcp-connector-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/adapter-extensions.test.mjs tests/runtime-core-mcp-connector-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-12 plugin adapter and governance baseline (descriptor mapping, auth binding contract surfaces, and lifecycle policy parity with skills/MCP).

### 2026-02-22 - PR-10-SKILL-INSTALLER-001 - Phase 5 skill installer and trust pipeline baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented `SKILL.md` installer baseline with strict frontmatter/section parsing and capability mapping in `polar-adapter-extensions`, added provenance verification (source policy, pinned revision for remote sources, hash validation, trust recommendation), added runtime-core skill installer gateway that runs through registered middleware/contracts and integrates permission-delta approval gating with extension lifecycle operations, and wired deterministic skill adapter registration/upgrades through extension registry upsert without bypassing extension governance.
4. Files changed:
   - `packages/polar-domain/src/skill-installer-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/skill-installer-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-adapter-extensions/src/skill-installer.mjs`
   - `packages/polar-adapter-extensions/src/index.mjs`
   - `tests/adapter-extensions.test.mjs`
   - `tests/runtime-core-skill-installer-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/adapter-extensions.test.mjs tests/runtime-core-extension-gateway.test.mjs tests/runtime-core-skill-installer-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-11 MCP connector and wrapper lifecycle integration (catalog import mapping, connection health probing, and contract-wrapped tool exposure).

### 2026-02-22 - PR-09-EXTENSION-FRAMEWORK-001 - Phase 5 extension contract and gateway baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented the extension framework baseline with Polar-owned typed contracts for extension lifecycle and extension capability execution, added runtime-core extension gateway so lifecycle and execution actions run through contract-registered before/after middleware paths, added deterministic trust/lifecycle policy enforcement and failure shaping (`applied/rejected`, `completed/failed`), and extended adapter/runtime tests for registry behavior, permission-delta determinism, lifecycle transitions, policy denials, and execution outcomes across skill/MCP/plugin extension surfaces.
4. Files changed:
   - `packages/polar-domain/src/extension-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/extension-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-adapter-extensions/src/index.mjs`
   - `tests/adapter-extensions.test.mjs`
   - `tests/runtime-core-extension-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/adapter-extensions.test.mjs tests/runtime-core-extension-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-10 skill installer and trust pipeline (`SKILL.md` parse/capability mapping, provenance checks, and permission-delta approval flow integration).

### 2026-02-22 - PR-08-HANDOFF-ORCHESTRATION-001 - Phase 4 typed handoff gateway and routing policy baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented a first-class handoff contract and runtime gateway that executes all handoffs through Polar middleware with typed before/after validation, added deterministic routing policy decisions (`direct`, `delegate`, `fanout-fanin`), added scoped capability projection for delegated/fanout paths, and enforced deterministic failure propagation as typed handoff output payloads for sub-agent execution failures.
4. Files changed:
   - `packages/polar-domain/src/handoff-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/routing-policy-engine.mjs`
   - `packages/polar-runtime-core/src/handoff-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `tests/runtime-core-handoff-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/runtime-core-handoff-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-09 extension framework baseline (contract-registered skill/MCP/plugin execution surfaces and lifecycle governance path).

### 2026-02-22 - PR-07-SLACK-INGRESS-001 - Phase 3 slack canonical ingress and parity baseline

1. Status: Done
2. Owner: codex
3. Summary: Added Slack as a first-class canonical ingress adapter with strict typed input validation, deterministic timestamp/id/thread normalization, and unified runtime-core gateway parity so web/telegram/slack all execute through the same contract-registered middleware path with deterministic validation failures.
4. Files changed:
   - `packages/polar-domain/src/chat-contracts.mjs`
   - `packages/polar-adapter-channels/src/index.mjs`
   - `packages/polar-runtime-core/src/chat-ingress-gateway.mjs`
   - `tests/adapter-channels-normalization.test.mjs`
   - `tests/runtime-core-chat-ingress-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `node --test tests/adapter-channels-normalization.test.mjs tests/runtime-core-chat-ingress-gateway.test.mjs`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-08 multi-agent orchestration and typed handoff contract enforcement (routing policy + deterministic handoff failure propagation).

### 2026-02-22 - DOC-HARNESS-GOV-002 - Phased harness policy alignment for local development

1. Status: Done
2. Owner: codex
3. Summary: Refined harness governance wording to match the phased implementation model: written automated tests first, then DevTools checks for UI-affecting changes, with CI harness automation treated as a hardening milestone rather than a day-one local development blocker.
4. Files changed:
   - `AGENTS.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/operations/quality-and-safety.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Implement PR-21/PR-22 harness automation so manual DevTools verification can be replaced by CI replay coverage.

### 2026-02-22 - DOC-HARNESS-GOV-001 - Dev-only harness governance and Chrome DevTools MCP policy alignment

1. Status: Done
2. Owner: codex
3. Summary: Added explicit development-harness governance so Chrome DevTools MCP is treated as dev/CI-only test infrastructure (not an end-user runtime capability), and aligned implementation/safety docs with harness-engineering practices for deterministic replay, regression corpus growth, and harness entropy cleanup.
4. Files changed:
   - `AGENTS.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/operations/quality-and-safety.md`
   - `docs/extensions/skills-mcp-plugins.md`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Land runtime enforcement that blocks dev-only harness integrations from production extension/profile surfaces.

### 2026-02-22 - PR-06-INGRESS-NORMALIZATION-001 - Phase 3 web + telegram canonical ingress and parity baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented Polar-owned canonical chat ingress contract and runtime gateway for normalized ingress, added web and Telegram transport adapters that normalize into one canonical message envelope with deterministic validation errors, and added parity-oriented tests validating shared behavior across web/telegram normalization paths through middleware and contract enforcement.
4. Files changed:
   - `packages/polar-domain/src/runtime-contracts.mjs`
   - `packages/polar-domain/src/chat-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-adapter-channels/src/index.mjs`
   - `packages/polar-runtime-core/src/chat-ingress-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `tests/adapter-channels-normalization.test.mjs`
   - `tests/runtime-core-chat-ingress-gateway.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm run check`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start PR-07 slack normalized ingress + parity tests against web/telegram canonical envelope behavior.

### 2026-02-22 - PR-05-AGENT-LOOP-002 - Phase 2 agent-loop tool lifecycle middleware enforcement

1. Status: Done
2. Owner: codex
3. Summary: Implemented tool lifecycle contract and runtime gateway so pi-agent tool start/end events execute through Polar runtime middleware with typed contracts, deterministic validation failures, and audit-compatible execution; wired `polar-adapter-pi` agent-turn adapter to support configured lifecycle handlers for non-bypass middleware integration.
4. Files changed:
   - `packages/polar-domain/src/runtime-contracts.mjs`
   - `packages/polar-domain/src/tool-lifecycle-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/tool-lifecycle-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-adapter-pi/src/index.mjs`
   - `tests/runtime-core-tool-lifecycle-gateway.test.mjs`
   - `tests/adapter-pi.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm run check`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Begin Phase 3 unified chat surface with canonical ingress contract and web/telegram adapter normalization parity tests.

### 2026-02-22 - PR-04-PROVIDER-GATEWAY-001 - Phase 2 provider adapter + fallback gateway baseline

1. Status: Done
2. Owner: codex
3. Summary: Implemented Polar provider operation contracts (`generate`, `stream`, `embed`), added runtime-core provider gateway with fallback routing through contract registry and middleware, and refactored `polar-adapter-pi` to lazy-load `pi-mono` integrations with explicit provider and agent-turn adapter surfaces while keeping `pi-mono` imports isolated to adapter layer.
4. Files changed:
   - `packages/polar-domain/src/runtime-contracts.mjs`
   - `packages/polar-domain/src/provider-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/provider-gateway.mjs`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-adapter-pi/src/index.mjs`
   - `tests/runtime-core-provider-gateway.test.mjs`
   - `tests/adapter-pi.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm run check`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Complete Phase 2 agent-turn integration by executing tool lifecycle start/end through runtime-core middleware + typed contracts (before/after invariants) instead of callback pass-through only.

### 2026-02-22 - PR-03-AUDIT-TRACE-001 - Middleware audit envelopes and execution-type trace hardening

1. Status: Done
2. Owner: codex
3. Summary: Implemented audit-event envelope emission and trace correlation IDs in runtime middleware execution, added explicit execution-type enforcement (`tool`, `handoff`, `automation`, `heartbeat`), and extended runtime-core tests for execution-type middleware routing, audit correlation, and fail-closed audit-sink behavior.
4. Files changed:
   - `packages/polar-domain/src/runtime-contracts.mjs`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-runtime-core/src/middleware-pipeline.mjs`
   - `tests/runtime-core-contract-middleware.test.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm run check`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Start Phase 2 adapter-layer hardening: wire `pi-mono` provider/agent-loop adapter lifecycle hooks through Polar middleware and contract registry.

### 2026-02-22 - PR-01-03-BOOTSTRAP-BASELINE - Phase 0 bootstrap and Phase 1 spine baseline

1. Status: Done
2. Owner: codex
3. Summary: Bootstrapped the Polar workspace with required package boundaries, CI quality gates, and strict `pi-mono` import enforcement; added typed environment profiles plus a first executable contract registry and before/after middleware pipeline with deterministic typed error mapping and strict input/output schema rejection.
4. Files changed:
   - `.gitignore`
   - `package.json`
   - `package-lock.json`
   - `.github/workflows/ci.yml`
   - `scripts/check-pi-mono-imports.mjs`
   - `tests/check-pi-mono-imports.test.mjs`
   - `tests/environment-profiles.test.mjs`
   - `tests/runtime-core-contract-middleware.test.mjs`
   - `packages/polar-domain/package.json`
   - `packages/polar-domain/src/index.mjs`
   - `packages/polar-domain/src/runtime-contracts.mjs`
   - `packages/polar-domain/src/environment-profiles.mjs`
   - `packages/polar-runtime-core/package.json`
   - `packages/polar-runtime-core/src/index.mjs`
   - `packages/polar-runtime-core/src/contract-registry.mjs`
   - `packages/polar-runtime-core/src/middleware-pipeline.mjs`
   - `packages/polar-adapter-pi/package.json`
   - `packages/polar-adapter-pi/src/index.mjs`
   - `packages/polar-adapter-channels/package.json`
   - `packages/polar-adapter-channels/src/index.mjs`
   - `packages/polar-adapter-extensions/package.json`
   - `packages/polar-adapter-extensions/src/index.mjs`
   - `packages/polar-control-plane/package.json`
   - `packages/polar-control-plane/src/index.mjs`
   - `docs/implementation/implementation-log.md`
5. Validation performed:
   - `npm run check`
   - `npm run check:boundaries`
   - `npm test`
6. Follow-up:
   - Complete Phase 1 middleware spine hardening with audit envelope/trace IDs and add execution-type parity coverage for tool, handoff, automation, and heartbeat paths.

### 2026-02-22 - DOC-GOV-001 - Repository agent operating guide and execution log

1. Status: Done
2. Owner: codex
3. Summary: Added repository-level `AGENTS.md` with implementation rules and made implementation logging mandatory; created append-only implementation log with clear completed items structure.
4. Files changed:
   - `AGENTS.md`
   - `docs/implementation/implementation-log.md`
   - `docs/implementation/README.md`
   - `docs/README.md`
5. Validation performed:
   - Manual file and link verification
6. Follow-up:
   - Enforce implementation-log updates in PR checklist or CI lint rule

### 2026-02-22 - DOC-PLAN-001 - Program execution docs activation

1. Status: Done
2. Owner: codex
3. Summary: Activated implementation-docs section and established execution planning baseline in canonical docs map.
4. Files changed:
   - `docs/implementation/README.md`
   - `docs/implementation/implementation-program-overview.md`
   - `docs/README.md`
5. Validation performed:
   - Manual content verification and index link checks
6. Follow-up:
   - Begin Phase 0 repository/package bootstrap tasks

### 2026-02-22 - DOC-ARCH-001 - Canonical docs refactor

1. Status: Done
2. Owner: codex
3. Summary: Refactored canonical docs to align with Polar architecture, pi-mono wrap strategy, and OpenClaw concept adaptation.
4. Files changed:
   - `docs/README.md`
   - `docs/project-overview.md`
   - `docs/architecture/pi-mono-adoption-strategy.md`
   - `docs/architecture/openclaw-concepts-adoption.md`
   - `docs/architecture/runtime-topology.md`
   - `docs/architecture/chat-routing-and-multi-agent.md`
   - `docs/architecture/tooling-contract-middleware.md`
   - `docs/extensions/skills-mcp-plugins.md`
   - `docs/product/automations.md`
   - `docs/product/web-ui-and-chat-management.md`
   - `docs/operations/quality-and-safety.md`
   - `docs/status/current-status.md`
   - `docs/status/roadmap.md`
5. Validation performed:
   - Manual content verification of updated docs
6. Follow-up:
   - Implement runtime code and tests against documented contracts
