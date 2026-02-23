# Polar Implementation Program Overview

Last updated: 2026-02-23

## Purpose

This plan defines the end-to-end implementation path from the current documentation-first state to a production-ready Polar runtime.

It is written as an execution guide for implementation agents and engineers.

## Current State (Baseline)

1. Canonical product and architecture docs are aligned.
2. `pi-mono` is selected as wrapped runtime foundation and isolated to adapter boundaries.
3. OpenClaw concept adoption decisions are documented (adopt/adapt/reject).
4. Core runtime invariants are implemented across shipped runtime gateways (tool/handoff/automation/heartbeat coverage, typed contracts, and middleware audit paths), with ongoing hardening and full-surface rollout work remaining.
5. Canonical ingress adapters for web/Telegram/Slack/Discord, channel-native thread/session continuity parity tests, typed ingress health-check baseline, control-plane ingress diagnostics proxying, and runtime profile pinning/resolution baseline are implemented; heartbeat and automation gateways now support resolver-driven profile fallback when explicit profile ids are absent, and handoff delegation paths support resolver-driven profile-scoped capability projection plus resolved-profile routing constraints, typed routing diagnostics, middleware-based routing telemetry collection, and contract-governed routing telemetry listing proxy surfaces with scoped filters (`sessionId`, `workspaceId`, `sourceAgentId`, `status`) and continuity fixtures; provider operations now emit usage telemetry events (fallback usage, execution duration, and optional model-lane/cost metadata) with contract-governed usage telemetry list/summary proxying plus cross-collector telemetry alert synthesis baseline, memory gateway surfaces now include contract-governed retrieval/write/compaction operations (`memory.search`, `memory.get`, `memory.upsert`, `memory.compact`) with deterministic degraded-provider shaping, while control-plane config, chat-management, and task-board backend/live-update contract baselines are implemented with automation/heartbeat gateway run-link wiring plus contract-governed run-link replay ingestion into task-board events and a contract-governed persisted scheduler/event processing gateway that now includes typed retry/dead-letter orchestration outputs, a concrete file-backed scheduler state-store adapter, contract-governed scheduler queue diagnostics proxying, and contract-governed queue run-action controls (`runtime.scheduler.event-queue.run-action`) through control-plane service surfaces; operator Web UI delivery, richer telemetry UI/alert integration depth, ingress alert workflow integration, and production-grade durable scheduler/queue backend + workflow hardening remain active roadmap items.

## Final Target State

1. One consistent chat runtime across Web, Telegram, Slack, and Discord.
2. Dynamic multi-agent orchestration with typed handoff contracts.
3. Skills + MCP + Claude plugins on one governance path.
4. Chat-first configuration for profiles, memory, heartbeat, and automations.
5. Polar-owned Web UI with task board, run visibility, and policy controls.
6. Deterministic middleware and schema checks on all tool, handoff, automation, and heartbeat paths.

## Non-Negotiable Implementation Rules

1. No direct execution path bypasses before/after middleware.
2. No untyped input or output crosses a runtime boundary.
3. No direct import from `pi-mono` outside adapter modules.
4. No markdown file is canonical runtime config state.
5. Every high-risk action is policy-gated and auditable.

## Semi-Modular pi-mono Integration Blueprint

### Objective

Use `pi-mono` for delivery speed now, while preserving low-cost extraction later.

### Required Module Boundaries

1. `packages/polar-domain`
   - entities, contracts, policy interfaces
   - no dependency on `pi-mono`
2. `packages/polar-runtime-core`
   - orchestration, middleware pipelines, contract registry, policy engine
   - depends only on domain contracts and adapter interfaces
3. `packages/polar-adapter-pi`
   - the only place allowed to import `pi-mono`
   - provider adapter, agent-loop adapter, streaming adapter
4. `packages/polar-adapter-channels`
   - ingress/egress adapters for web/telegram/slack/discord
5. `packages/polar-adapter-extensions`
   - skill, MCP, and plugin loaders mapped to Polar contracts
6. `packages/polar-control-plane`
   - management API and Web UI backend routes

### Anti-Coupling Rules

1. Add lint/CI rule that fails on `pi-mono` imports outside `polar-adapter-pi`.
2. Use interface injection in `polar-runtime-core` for all model/tool/handoff execution.
3. Keep transcript/session format owned by Polar schema, not adapter-native schema.
4. Contract tests run against adapter interfaces, not concrete `pi-mono` types.

### Future Extraction Readiness

If replacing `pi-mono`, only `polar-adapter-pi` and wiring code should change.

## Workstreams

1. WS-A Core runtime and contracts.
2. WS-B Channel adapters and chat normalization.
3. WS-C Extension fabric (skills/MCP/plugins).
4. WS-D Memory, heartbeat, and automations.
5. WS-E Control plane (API + Web UI + task board).
6. WS-F Security, observability, and release hardening.
7. WS-G Harness engineering and eval loops (dev-only infrastructure).

## Phase Plan

## Phase 0: Program Bootstrap

### Goals

1. Establish repository/package structure and enforcement rules.
2. Create CI gates for contracts, linting, and forbidden imports.

### Tasks

1. Create package boundaries from the modular blueprint.
2. Add import-boundary lint rules.
3. Add CI workflow skeleton with required checks.
4. Define environment profiles (`dev`, `staging`, `prod`).
5. Define dev-only harness policy boundaries and isolate test-only MCP integrations from runtime extension surfaces.
6. Define local dev verification flow: written automated tests first, then DevTools checks for UI-affecting changes.

### Exit Criteria

1. CI fails if `pi-mono` is imported outside adapter package.
2. Baseline test and lint workflows are required on PR.
3. Dev-only harness integrations cannot be enabled through runtime extension APIs or end-user profile configuration.

## Phase 1: Contracts + Middleware Spine

### Goals

1. Build contract registry with versioned input/output schemas.
2. Implement before/after middleware pipeline engine.

### Tasks

1. Implement action registry format: `actionId`, `version`, `inputSchema`, `outputSchema`, `riskClass`, `trustClass`.
2. Build middleware runner with deterministic ordering.
3. Add typed error model for policy/validation/runtime failures.
4. Add audit event envelope and trace correlation IDs.

### Exit Criteria

1. Tool and handoff paths cannot execute without contract registration.
2. Middleware runs are logged with before/after checkpoints.

## Phase 2: pi-mono Adapter Layer

### Goals

1. Wire `pi-mono` through Polar interfaces only.
2. Keep runtime core independent from `pi-mono` types.

### Tasks

1. Implement provider adapter (`generate`, `stream`, `embed` abstraction).
2. Implement agent-turn adapter for planner loop integration.
3. Implement tool lifecycle hooks that feed Polar middleware.
4. Implement fallback adapter interface for profile/provider/model fallback.

### Exit Criteria

1. End-to-end turn can run via adapter with Polar contracts enforced.
2. Replacing adapter with mock engine passes core tests.

## Phase 3: Unified Chat Surface

### Goals

1. Normalize all ingress into one canonical message contract.
2. Deliver parity across web, Telegram, Slack, and Discord.

### Tasks

1. Implement `web` ingress and baseline session handling.
2. Implement Telegram adapter mapping to canonical envelope.
3. Implement Slack adapter mapping to canonical envelope.
4. Implement Discord adapter mapping to canonical envelope.
5. Add and maintain parity test suite for prompt flow and session continuity.
6. Add ingress health-check conformance probes across active channel adapters.

### Exit Criteria

1. Same request behavior and deterministic errors across active channels.
2. Channel adapters remain transport-only modules.

## Phase 4: Multi-Agent Orchestration

### Goals

1. Implement primary agent + delegated sub-agent model.
2. Enforce typed handoff contract pipeline.

### Tasks

1. Build routing policy engine (direct vs delegate vs fan-out/fan-in).
2. Implement handoff envelope validation.
3. Implement scoped capability projection for sub-agents.
4. Implement deterministic failure propagation back to primary agent.

### Exit Criteria

1. All handoffs validated before execution and after return.
2. Fan-out/fan-in path has reproducible test fixtures.

## Phase 5: Extension Fabric

### Goals

1. Run skills, MCP tools, and Claude plugins through one policy stack.
2. Add source trust and permission-delta controls.

### Tasks

1. Implement `SKILL.md` parser + capability mapping.
2. Implement MCP connection lifecycle + tool import wrappers.
3. Implement Claude plugin descriptor mapping + auth binding.
4. Add trust-level workflow (`trusted`, `reviewed`, `sandboxed`, `blocked`).
5. Add install/upgrade permission diff report.

### Exit Criteria

1. No extension call bypasses middleware and contracts.
2. Extension lifecycle actions are fully audited.

## Phase 6: Memory + Heartbeat + Automations

### Goals

1. Implement structured memory with constrained retrieval.
2. Implement heartbeat as policy-driven automation class.
3. Implement chat-first automation authoring.

### Tasks

1. Add memory entities and contract-governed retrieval/write/compaction tools (`memory_search`, `memory_get`, `memory_upsert`, `memory_compact`).
2. Add degraded behavior contract when retrieval provider is unavailable.
3. Implement pre-compaction memory persistence run.
4. Implement heartbeat policy fields (cadence, active hours, delivery rules, model lane).
5. Implement local-model-first routine checks with escalation policy.
6. Implement automation draft flow from chat intent.

### Exit Criteria

1. No markdown files required for runtime memory/heartbeat control.
2. Heartbeat and automation runs emit typed outcomes and audit events.

## Phase 7: Control Plane + Task Board

### Goals

1. Ship management API and Polar Web UI.
2. Add live task board for user/agent assignment and status.

### Tasks

1. Build control-plane endpoints for profiles, channels, extensions, policies, automations.
2. Build chat management views (sessions/history/search/retention).
3. Build task board data model and live updates.
4. Connect task board state to runtime events and automation runs.

### Exit Criteria

1. Operators can configure runtime-critical behavior without file edits.
2. Task board reflects live ownership and state transitions.

## Phase 8: Observability + Cost Governance

### Goals

1. Add run visibility and budget guardrails.
2. Add fallback diagnostics and policy telemetry.

### Tasks

1. Emit metrics for lane selection, fallback reasons, and execution durations.
2. Add usage and cost dashboard APIs.
3. Add budget policies that gate high-frequency automations.
4. Add alerting for policy bypass attempts and repeated failures.

### Exit Criteria

1. Cost and fallback behavior are visible per run and per profile.
2. Budget enforcement works in proactive and interactive paths.

## Phase 9: Hardening + Rollout

### Goals

1. Complete production safety baseline.
2. Execute staged rollout with rollback confidence.

### Tasks

1. Run security review on extension and credential boundaries.
2. Execute incident and rollback drills.
3. Run canary deployments on selected channel scopes.
4. Finalize SLOs and release criteria checklists.

### Exit Criteria

1. No known bypass path remains.
2. Canary and rollback playbooks are validated.

## Cross-Cutting Track: Harness Engineering (Dev-Only)

### Goals

1. Build deterministic harness workflows that keep runtime quality measurable as scope grows.
2. Use Chrome DevTools MCP for automated test execution in development and CI only.
3. Maintain a regression/eval corpus that is easy to replay and expand without accumulating brittle tests.

### Tasks

1. Define harness scenario contracts (`scenarioId`, inputs, assertions, expected artifacts).
2. Add replay runner tooling for deterministic regression execution with trace correlation.
3. Integrate Chrome DevTools MCP for web and control-plane UI validation in non-production environments.
4. Add failure-corpus workflow: convert escaped defects into reproducible harness scenarios.
5. Add periodic harness cleanup and deduplication to control test entropy and stale fixtures.

### Exit Criteria

1. Core user and operator flows are covered by deterministic harness scenarios with stable replay commands.
2. UI-affecting feature work includes written tests plus DevTools verification evidence (manual is acceptable before PR-21/22 lands).
3. Chrome DevTools MCP harness automation is integrated in CI by hardening phase milestones (PR-21/22), and remains blocked from production runtime paths.
4. Escaped bugs require corresponding harness coverage additions before closure once replay tooling is available.

## End-To-End Configuration Process (Operator Runbook)

This is the target operator flow from clean deployment to fully configured runtime.

### Step 1: Bootstrap Runtime

1. Deploy Polar services (`runtime-core`, `control-plane`, `web-ui`, channel adapters).
2. Initialize database schemas.
3. Set base environment config and secrets provider.
4. Verify health endpoints and trace pipeline.

### Step 2: Configure Model Lanes

1. Configure `local` lane model/provider for routine checks.
2. Configure `worker` lane model/provider for normal tasks.
3. Configure `brain` lane model/provider for heavy reasoning.
4. Configure fallback chain and cooldown policy.
5. Validate with policy simulation endpoint.

### Step 3: Create Agent Profiles

1. Create global default profile.
2. Create workspace profiles.
3. Set pinned defaults (prompt, model policy, safety mode).
4. Assign allowed skills/MCP/plugins per profile.

### Step 4: Connect Channels

1. Connect Web chat.
2. Connect Telegram.
3. Connect Slack.
4. Validate channel health and message normalization.
5. Enable Discord after parity gates pass.

### Step 5: Install Extensions

1. Install starter skills from trusted sources.
2. Connect approved MCP servers.
3. Install approved Claude plugins.
4. Review permission deltas and trust levels.
5. Enable only required capabilities per profile.

### Step 6: Configure Memory

1. Enable structured memory storage.
2. Set retention policy and scope rules.
3. Enable retrieval provider and fallback policy.
4. Validate `memory_search`, `memory_get`, `memory_upsert`, and `memory_compact` behavior.

### Step 7: Configure Heartbeat

1. Create heartbeat policy via chat or UI.
2. Set cadence, active hours, visibility rules.
3. Set model lane to `local` by default.
4. Set escalation rules and budget constraints.
5. Validate queue-aware skip and quiet-hour behavior.

### Step 8: Configure Automations

1. Create baseline recurring automations through chat.
2. Set explicit run scopes and approvals.
3. Enable proactive triggers.
4. Configure retry/dead-letter policy.
5. Link automation outcomes to task board updates.

### Step 9: Configure Task Board

1. Create task statuses and assignment model.
2. Enable automatic task creation from selected run types.
3. Configure ownership transitions (`user` vs `agent`).
4. Validate real-time board updates from runtime events.

### Step 10: Enable Hardened Mode

1. Set contract strictness to `hardened`.
2. Enable required approval policies.
3. Enable budget guardrails and anomaly alerts.
4. Run full pre-production conformance suite.

### Step 11: Production Cutover

1. Enable canary users/channels.
2. Monitor fallback rates, policy denials, and cost telemetry.
3. Expand rollout by channel and workspace.
4. Freeze release and tag production baseline.

## PR Sequence (Recommended)

1. PR-01 package boundaries and CI import rules.
2. PR-02 contract registry and typed errors.
3. PR-03 middleware engine and audit envelope.
4. PR-04 pi-mono provider adapter.
5. PR-05 pi-mono agent loop adapter.
6. PR-06 web + telegram normalized ingress.
7. PR-07 slack normalized ingress + parity tests.
8. PR-08 orchestration and handoff contract enforcement.
9. PR-09 extension framework baseline.
10. PR-10 skill installer and trust pipeline.
11. PR-11 MCP connector and wrappers.
12. PR-12 plugin adapter and governance.
13. PR-13 structured memory service.
14. PR-14 heartbeat policy runtime.
15. PR-15 automation authoring and executor.
16. PR-16 control-plane API.
17. PR-17 web UI foundation and chat management.
18. PR-18 task board + live updates.
19. PR-19 cost governance and telemetry surfaces.
20. PR-20 hardened mode rollout and incident runbooks.
21. PR-21 dev-only Chrome DevTools MCP harness baseline.
22. PR-22 harness regression corpus, replay tooling, and entropy cleanup cadence.

## Quality Gates Per Phase

1. Unit tests for contract and policy logic.
2. Integration tests for adapter boundaries.
3. End-to-end tests for channel and multi-agent behavior.
4. Security tests for extension and credential paths.
5. Performance tests for heartbeat and automation fan-out.
6. For UI-affecting changes, run DevTools checks with dev-only tooling (manual until harness CI automation is landed; automated afterward).

## Migration Path Off pi-mono (Future)

1. Implement alternative adapter package (for example `polar-adapter-native`).
2. Run adapter conformance suite against both implementations.
3. Switch runtime wiring behind feature flag.
4. Compare outputs and error classes in shadow mode.
5. Cut over after parity thresholds are met.
6. Remove `polar-adapter-pi` only after one stable release cycle.

## Definition Of Done (Program)

1. All documented product capabilities are running in production mode.
2. Hardened contract enforcement is active across all execution types.
3. Operators can fully configure runtime behavior via chat/API/UI.
4. `pi-mono` dependency is contained to replaceable adapter modules.
5. Runbooks, dashboards, and rollback procedures are validated.
