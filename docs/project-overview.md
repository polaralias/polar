# Polar: Harness Specification & Project Overview

Last updated: 2026-02-24

This document serves as the singular 'Harness Specification' for the Polar project. It consolidates the project intent, execution rules, current capability status, and the remaining execution roadmap into one declarative source of truth for engineering agents.

## 1. Mission & Product Scope
Build a self-hosted personal AI assistant platform that behaves like one coherent product across all chat surfaces while keeping execution deterministic, auditable, and cost-governed.

## Product Scope

Polar is designed around these product commitments:

1. Singular, consistent chat interface regardless of endpoint.
2. Full support for Telegram, Slack, Discord, and future adapters.
3. Multi-agent orchestration where the primary chat agent routes to sub-agents at runtime.
4. Skill extensibility via installable `SKILL.md` packages aligned with the agent skills standard.
5. Native connectivity for MCP servers.
6. Claude plugin installation and execution through the same governance layer.
7. Agent profiles with pinning and defaults (model lane, system prompt, skills, MCP, plugins).
8. Chat-first configuration for profile, heartbeat, memory, and automation policy.
9. Polar-owned Web UI for operational management.
10. Full chat lifecycle management (sessions, history, retention, exports, moderation controls).
11. Dynamic automation configuration through chat.
12. Proactive automations that can initiate work safely.
13. Local-model routing for routine tasks and policy-driven fallback for premium tasks.

## 2. Core Architecture & Rules
## Configuration Source Of Truth

Polar treats structured runtime state as the source of truth:

1. Configured via chat commands, Web UI, and management API.
2. Persisted in typed stores with versioned schemas.
3. Enforced by policy and middleware on every run.

Markdown artifacts such as `MEMORY.md` or `HEARTBEAT.md` are optional interoperability surfaces, not canonical control state.

## Core Product Principles

1. Self-hosted first: deployment and data ownership remain with the operator.
2. One chat contract: all endpoints normalize into the same message/session model.
3. Dynamic specialization: orchestration delegates to the best-fit agent at runtime.
4. Extension parity: native tools, skills, MCP tools, and plugins are governed identically.
5. Deterministic runtime boundaries: all inputs and outputs are schema-checked in code.
6. Chat-first operations: users configure the system in chat, not via brittle side files.
7. Cost-aware model policy: local models handle routine loops, premium models handle heavy reasoning.
8. Explicit trust: any extension or integration is trusted, sandboxed, reviewed, or blocked by policy.
9. Auditability by default: every tool call, handoff, heartbeat tick, and automation run is traceable.
## Core Entities

| Entity | Purpose |
| --- | --- |
| User | Human actor with identity and policy context |
| Session | Conversation container across channels and web |
| Message | Normalized inbound/outbound chat event |
| Agent Profile | Pinned defaults for model lane, prompt, skills, MCP, plugins |
| Handoff | Structured delegation from one agent to another |
| Tool Call | Structured request/response operation against an executable capability |
| Extension | Installable capability package (`SKILL.md`, MCP tool set, or plugin) |
| Automation | Scheduled or event-driven workflow that executes through the same runtime |
| Heartbeat Policy | Periodic assistant check settings (cadence, scope, model lane, delivery rules) |
| Memory Record | Structured durable fact or summarized context with provenance metadata |
| Model Policy | Rule set for primary, worker, local, and fallback model selection |
| Task Item | Work unit tracked in the shared task board with owner and status |

## Release Philosophy

Polar is production-ready only when strict contract enforcement is active for all tool calls, handoffs, heartbeat ticks, and automation runs.

### Non-Negotiable Rules
1. No direct execution path bypasses before/after middleware.
2. No untyped input or output crosses a runtime boundary.
3. No direct import from `pi-mono` outside adapter modules.
4. No markdown file is canonical runtime config state.
5. Every high-risk action is policy-gated and auditable.

### Modular Blueprint
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

## 3. Current State & Capabilities
## Capability Status Snapshot

| Capability | Status | Notes |
| --- | --- | --- |
| Singular consistent chat interface | In Progress | Canonical ingress + chat-management runtime gateways are implemented with deterministic cross-channel multi-turn session/thread continuity tests; end-to-end UX/operator surfaces are still expanding |
| Telegram support | In Progress | Telegram canonical ingress adapter is implemented through shared middleware/contract path |
| Slack support | In Progress | Slack canonical ingress adapter is implemented through shared middleware/contract path |
| Discord support | In Progress | Discord canonical ingress adapter is implemented through shared middleware/contract path, including native thread derivation from parent-message linkage |
| Channel ingress health conformance | In Progress | Typed `chat.ingress.health.check` gateway baseline and default adapter probes are implemented, and control-plane service diagnostics proxying is now wired through the same middleware/contracts path; operator UI and alert workflow integration remain |
| Dynamic multi-agent routing | In Progress | Typed routing + handoff gateway is implemented with resolver-aware delegated profile projection, resolved-profile routing constraints (`allowedHandoffModes`, `defaultHandoffMode`, `maxFanoutAgents`), typed routing diagnostics surfaced on handoff contracts, middleware-based handoff routing telemetry collection, and control-plane telemetry listing proxy baseline with scoped telemetry filters (`sessionId`, `workspaceId`, `sourceAgentId`, `status`) plus cross-run continuity fixture coverage; broader orchestrator integration and telemetry view depth remain |
| Usage/cost telemetry APIs | In Progress | Provider gateway now emits typed usage telemetry events (fallback usage, execution duration, optional model-lane/cost metadata), and control-plane service now proxies contract-governed usage telemetry list/summary plus telemetry alert synthesis queries across usage/handoff collectors; operator dashboards, alert routing workflows, and budget-policy actions remain |
| `SKILL.md` import/install support | In Progress | Skill parser, provenance verification, install/upgrade lifecycle, and governed execution path are implemented |
| MCP server integration | In Progress | MCP probe/catalog sync, trust/policy lifecycle, and governed capability execution are implemented |
| Claude plugin installation | In Progress | Plugin descriptor mapping, auth-binding checks, lifecycle governance, and execution wrappers are implemented |
| Agent pinning and scoped defaults | In Progress | Runtime profile-resolution gateway baseline is implemented with deterministic `session -> workspace -> global -> default` precedence. Agent profiles explicitly bind roles to specific LLM models (e.g., Anthropic for writing, Gemini for research) and strictly govern downstream `allowedHandoffTargets` to prevent domain privilege expansion |
| Chat-first config & Web UI settings | In Progress | Typed control-plane config contracts/gateway are implemented; fully supporting dynamic `polar config set` CLI deployments for LLMs, Channels, Automations, and Extensions, all manageable via the Web UI interface without requiring hardcoded script edits or raw plain-text config files |
| Heartbeat policy engine | In Progress | Heartbeat tick gateway with policy gating/escalation is implemented and now supports profile resolution fallback when profile pins are configured |
| Structured memory and recall service | In Progress | `memory.search`, `memory.get`, `memory.upsert`, and `memory.compact` gateways with degraded-provider behavior are implemented; provider-backed persistence/compaction lifecycle hardening remains |
| Automatic model fallback and cooldown policies | In Progress | Provider fallback routing is implemented; cooldown/advanced policy surfaces remain |
| Polar-owned Web UI management surface | In Progress | Control-plane config/chat-management/task-board backend foundations are implemented; operator Web UI surfaces (including configs for external integrations) are still pending |
| Task board runtime + live update stream | In Progress | Typed task-board contracts, deterministic status transitions, control-plane task/event list backends, automation/heartbeat gateway run-link ingestion, replay ingestion endpoint, and persisted scheduler/event source execution + replay gateway baseline with retry/dead-letter disposition ledgers plus scheduler state-store hooks are implemented, and a file-backed scheduler state-store adapter baseline with queue run-action controls (`dismiss`, `retry_now`, `requeue`) is now available; production-grade queue backends and UI visualization are still pending |
| Full chat lifecycle management | In Progress | Message append/session list/history/search/retention gateways are implemented; broader lifecycle controls remain |
| Dynamic automation creation in chat | In Progress | Intent-to-draft automation gateway is implemented |
| Proactive automations | In Progress | Automation run gateway with gating/escalation/typed outcomes is implemented and now supports profile resolution fallback when profile pins are configured, and persisted scheduler/event dispatch now includes contract-governed retry/dead-letter orchestration with typed disposition outputs, file-backed durable scheduler state storage, and control-plane queue diagnostics plus queue run-action controls (`dismiss`, `retry_now`, `requeue`) with deterministic rejection shaping; broader queue backend options, policy tuning, and operator workflow integration remain |
| Scheduler retry/dead-letter diagnostics | In Progress | Contract-governed scheduler queue diagnostics listing (`runtime.scheduler.event-queue.list`) and queue run-action controls (`runtime.scheduler.event-queue.run-action`) are implemented with file-backed state-store support and control-plane proxy wiring, including typed `retry_now` and dead-letter `requeue` operations backed by retained request-payload provenance; operator UI workflows, approval routing, and production queue backends remain |
| Before/after middleware on tool calls | In Progress | Enforced across implemented runtime gateways; broader runtime coverage hardening is ongoing |
| Before/after middleware on handoffs | In Progress | Handoff gateway is middleware-enforced with typed before/after validation |
| Before/after middleware on automation and heartbeat paths | In Progress | Automation and heartbeat gateways are middleware-enforced with typed before/after validation |
| Zero unexpected I/O via contract checks | In Progress | Strict schema validation is implemented for runtime gateways; hardened deployment rollout remains |

## Immediate Priorities

1. Build operator-facing telemetry views and alert workflow routing on top of the shipped handoff/usage telemetry listing + alert synthesis baselines.
2. Harden scheduler durability beyond the shipped file-backed state-store adapter by adding a production-grade SQLite queue/storage backend and integrating retry/dead-letter diagnostics into operator Web UI + alert workflows.
3. Deliver Polar Web UI management/task-board surfaces on top of implemented control-plane/chat-management/task-board backends and linked runtime events.
4. Integrate ingress health diagnostics into operator UI and alert workflows on top of the shipped control-plane proxy baseline.
5. Continue hardening and observability rollout (budget governance, memory persistence/compaction lifecycle controls, policy telemetry, and production strictness posture).


## 4. Execution Roadmap
## Execution Snapshot (2026-02-23)

| Track/Phase | Status | Shipped Baseline | Next Milestone |
| --- | --- | --- | --- |
| Foundation Track A: pi-mono Wrap Layer | Backend Complete | Provider + agent-loop adapters, import boundaries, and middleware lifecycle hooks are implemented | Expand conformance + extraction-readiness suites and keep adapter parity as upstream dependencies evolve |
| Foundation Track B: OpenClaw Concept Adaptation | Backend Complete | Heartbeat, memory retrieval/write/compaction gateway contracts, automation, fallback patterns, scheduler retry/dead-letter orchestration baseline, and a file-backed scheduler state-store adapter + queue diagnostics/run-action baseline (`dismiss`, `retry_now`, `requeue`) are implemented as Polar-native gateway contracts | Wire production-grade durable SQLite scheduler backend and richer observability surfaces for automation + run health |
| Phase 1: Deterministic Core | Backend Complete | Contract registry + typed middleware/audit pipelines are implemented and enforced in runtime gateways | Complete hardened deployment defaults and maintain non-bypass regression coverage as new capabilities land |
| Phase 2: Unified Chat Surface | Backend Complete | Web/Telegram/Slack/Discord ingress normalization, native-thread/session continuity parity coverage, typed ingress health-check baseline, and control-plane ingress diagnostics proxying are implemented on one canonical contract path | Integrate ingress health diagnostics into operator UI + alert workflows and extend end-to-end channel continuity visibility |
| Phase 3: Multi-Agent And Profiles | Backend Complete | Typed routing policy + handoff gateway, contract-governed profile pinning/resolution baseline, resolver-aware automation/heartbeat gateway entry handling, resolver-aware handoff routing constraints, typed handoff routing diagnostics, middleware-based handoff routing telemetry collector baseline, contract-governed telemetry listing gateway with control-plane proxying plus scoped telemetry filters (`sessionId`, `workspaceId`, `sourceAgentId`, `status`) and continuity fixtures, contract-governed telemetry alert synthesis for handoff/usage collector windows, and delegated handoff profile-scoped capability projection support are implemented | Complete operator-facing telemetry views/alerts and full orchestrator fanout/fanin integration on top of resolver-aware routing/projection baselines |
| Phase 4: Extension Fabric | Backend Complete | Skills/MCP/plugins install-sync/lifecycle/execute governance baselines are implemented | Complete operational trust/revocation workflows and deeper governance telemetry |
| Phase 5: Automation, Heartbeat, And Memory | Backend Complete | Typed heartbeat tick, automation draft/run, memory search/get/upsert/compact gateways, and contract-governed persisted scheduler/event processing + run-link replay orchestration baseline with retry/dead-letter dispositions, file-backed scheduler state-store durability, and queue diagnostics + run-action controls (`dismiss`, `retry_now`, `requeue`) are implemented | Harden production-grade SQLite scheduler queue/storage backend, memory persistence lifecycle controls, and retry/dead-letter policy tuning/diagnostics |
| Phase 6: Polar Web UI Control Plane | Complete | Control-plane config API, chat-management backend, task-board runtime/live-update gateways, automation/heartbeat gateway run-to-task linkage wiring, task replay ingestion endpoint, persisted scheduler/event run-link source ingestion baseline, contract-governed usage telemetry list/summary + telemetry alert proxy baseline, control-plane scheduler queue diagnostics + run-action proxying (including `retry_now` and dead-letter `requeue`), and operator Web UI surfaces (Dashboard, Telemetry, Scheduler, Tasks) with dynamic glassmorphism and real-time state mapping are implemented | Continuous refinement of operator UI aesthetics and addition of custom diagnostic views |
| Phase 7: Production Hardening | Complete | Multiple hardening sweeps and policy-bypass regressions are in place. Production-grade SQLite durable scheduler queue/storage backend and AES-256-GCM Crypto-Vault interception for zero-configuration encryption-at-rest of provider and extension credentials within the control plane state are implemented | Monitor production telemetry, extend SLO/alerting coverage as edge-cases emerge, maintain non-bypass regression suites |

## Foundation Track A: pi-mono Wrap Layer

1. Maintain provider and agent-loop adapter parity as wrapped dependencies evolve.
2. Keep `pi-mono` import boundaries enforced via CI/lint.
3. Expand adapter conformance coverage for contract and middleware guarantees.
4. Validate low-friction extraction readiness through adapter isolation tests.

Exit criteria:

1. Wrapped package boundaries remain explicit and version-pinned.
2. Polar middleware remains non-bypassable despite wrapped internals.
3. Conformance tests fail if wrapped dependencies return uncontracted payloads.

## Foundation Track B: OpenClaw Concept Adaptation

1. Extend heartbeat, memory, fallback, and automation adaptations from gateway baseline to full runtime operations.
2. Add persistence and compaction-oriented memory lifecycle controls.
3. Deepen observability and governance views for proactive/runtime health.
4. Keep concept adaptations Polar-owned and contract-first.

Exit criteria:

1. Adopt/adapt/reject decisions are codified in production docs and tests.
2. No markdown artifact (`HEARTBEAT.md`, `MEMORY.md`) is required as canonical runtime control.
3. Concept adaptations run through Polar middleware and contracts.

## Phase 1: Deterministic Core

1. Keep all new callable operations contract-registered.
2. Maintain before/after middleware coverage on every execution path expansion.
3. Progressively tighten deployment strictness and hardening controls outside dev mode.

Exit criteria:

1. 100% callable operations contract-registered.
2. 100% execution paths validated in before and after middleware.
3. Invalid input and output paths are blocked with typed errors.

## Phase 2: Unified Chat Surface

1. Preserve web/Telegram/Slack/Discord parity on the canonical chat contract.
2. Keep deterministic multi-turn/session continuity coverage for all active channels as adapters evolve.
3. Integrate channel-health and transport-conformance diagnostics into control-plane/operator surfaces.

Exit criteria:

1. Endpoint behavior parity tests pass.
2. Thread and session continuity verified across all active channels.
3. Channel adapters contain transport-only logic.

## Phase 3: Multi-Agent And Profiles

1. Integrate dynamic routing and delegated execution into full orchestrator flows.
2. Implement agent profile pinning at global, workspace, and session scopes.
3. Add deterministic failure propagation and policy-driven model fallback across live orchestrations.

Exit criteria:

1. Handoff contracts enforced in strict mode.
2. Agent profile resolution order works exactly as documented.
3. Fan-out/fan-in execution is reproducible and fully traced.

## Phase 4: Extension Fabric

1. Harden `SKILL.md` installer lifecycle operations and governance.
2. Harden MCP onboarding/catalog exposure lifecycle operations.
3. Harden plugin onboarding/auth binding/lifecycle parity under one contract stack.
4. Expand trust/provenance/permission-delta governance and audit controls.

Exit criteria:

1. Skills, MCP tools, and plugins all execute through one policy stack.
2. Trust levels and permissions apply consistently by extension type.
3. Extension lifecycle operations are auditable and reversible.

## Phase 5: Automation, Heartbeat, And Memory

1. Extend chat-configured automation and heartbeat from gateway baseline to persisted runtime control.
2. Harden proactive schedule/event runners by extending the shipped file-backed scheduler state-store baseline with a production-grade SQLite queue/storage backend.
3. Harden structured memory write/recall flows with provider-backed persistence and compaction policy controls.
4. Deepen idempotency, retry, and dead-letter controls with queue observability and operator diagnostics.

Exit criteria:

1. Automation and heartbeat runs are fully typed and auditable.
2. Heartbeat local-model-first routing and fallback policies are active.
3. Memory retrieval/write/compaction contracts are enforced and observable.
4. Failure and retry behavior is deterministic.

## Phase 6: Polar Web UI Control Plane

1. Complete task-board operator surfaces on top of shipped assignment/status contract backends.
2. Ship operator management surfaces for channels (e.g., dynamic Telegram bot config), extensions, automations, policies, and runs.
3. Surface persisted scheduler/event run execution and replay diagnostics in operator UI workflows.
4. Expand shipped usage/cost telemetry list/summary + alert APIs into operator-visible dashboards and actionable diagnostics.
5. Extend the Web UI configuration layer to securely manage LLM model settings and broader client configurations directly through the control plane.

Exit criteria:

1. Task board reflects live run state and ownership transitions.
2. Operator can manage all runtime-critical settings without file edits.
3. Policy and audit views support incident response workflows.

## Phase 7: Production Hardening

1. Complete security hardening and secret management controls.
2. Finalize observability and SLO dashboards for orchestration paths.
3. Run canary rollouts and incident drills.

Exit criteria:

1. No policy bypass paths exist.
2. SLO and alerting coverage is complete.
3. Canary and rollback procedures are validated.

