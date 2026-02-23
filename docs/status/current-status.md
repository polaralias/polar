# Current Status

Last updated: 2026-02-23

## Program State

Documentation has been refactored to the canonical architecture that combines:

1. Wrapped `pi-mono` foundations.
2. Polar-native governance and orchestration.
3. Selected OpenClaw concept adoption (pattern-level, not runtime lift).

Implementation has shipped core runtime baselines across contracts, middleware, ingress normalization (web/Telegram/Slack/Discord), channel-native thread/session continuity parity on ingress, ingress health-check conformance probes with control-plane diagnostics proxying, runtime profile pinning/resolution baseline with session/workspace/global/default precedence plus resolver-aware heartbeat/automation entry handling and handoff scope projection support, resolver-aware handoff routing-policy constraints with typed routing diagnostics, handoff routing telemetry collector middleware baseline, contract-governed handoff routing telemetry listing gateway with control-plane service proxying plus scoped telemetry filters (`sessionId`, `workspaceId`, `sourceAgentId`, `status`) and cross-run continuity fixtures, provider-gateway usage telemetry capture (fallback usage, execution duration, and optional model-lane/cost metadata), contract-governed usage telemetry listing + alert synthesis proxy surfaces, extension governance, memory gateway retrieval/write/compaction operations (`memory.search`, `memory.get`, `memory.upsert`, `memory.compact`) with degraded-provider shaping, heartbeat, automation, control-plane config, chat-management gateways, and task-board runtime/live-update gateways including automatic automation/heartbeat gateway run-link event wiring, contract-governed run-link replay ingestion, and typed persisted scheduler/event execution + replay orchestration baselines now extended with retry/dead-letter disposition handling, a concrete file-backed scheduler state-store adapter, contract-governed scheduler queue diagnostics proxying, and contract-governed queue run-action controls (`runtime.scheduler.event-queue.run-action`) including typed `dismiss`, `retry_now`, and `requeue` operations with deterministic rejection shaping for unsupported queue/action pairs through control-plane surfaces; current focus is integration depth, orchestration completeness, operator UI delivery, and production-grade durable scheduler/queue backend + operator workflow hardening.

## Integration Decisions (2026-02-22)

1. `pi-mono` decision: wrap core libraries (`pi-ai`, `pi-agent-core`, selected `pi-web-ui`) behind Polar middleware, contract, and orchestration layers.
2. OpenClaw decision: adopt selected concepts (heartbeat policy, memory retrieval patterns, model fallback, observability patterns) as Polar-native features.
3. Web UI decision: build Polar-owned management UI and task board rather than adopting external dashboard runtime as-is.

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
| Agent pinning and scoped defaults | In Progress | Runtime profile-resolution gateway baseline is implemented with deterministic `session -> workspace -> global -> default` precedence over control-plane config surfaces and handoff routing now consumes resolved profile context for route constraints + diagnostics; orchestrator-wide integration remains |
| Chat-first config state | In Progress | Typed control-plane config contracts/gateway are implemented; full chat authoring UX is pending |
| Heartbeat policy engine | In Progress | Heartbeat tick gateway with policy gating/escalation is implemented and now supports profile resolution fallback when profile pins are configured |
| Structured memory and recall service | In Progress | `memory.search`, `memory.get`, `memory.upsert`, and `memory.compact` gateways with degraded-provider behavior are implemented; provider-backed persistence/compaction lifecycle hardening remains |
| Automatic model fallback and cooldown policies | In Progress | Provider fallback routing is implemented; cooldown/advanced policy surfaces remain |
| Polar-owned Web UI management surface | In Progress | Control-plane config/chat-management/task-board backend foundations are implemented; operator Web UI surfaces are still pending |
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
2. Harden scheduler durability beyond the shipped file-backed state-store adapter by adding production-grade queue/storage backends and integrating retry/dead-letter diagnostics into operator Web UI + alert workflows.
3. Deliver Polar Web UI management/task-board surfaces on top of implemented control-plane/chat-management/task-board backends and linked runtime events.
4. Integrate ingress health diagnostics into operator UI and alert workflows on top of the shipped control-plane proxy baseline.
5. Continue hardening and observability rollout (budget governance, memory persistence/compaction lifecycle controls, policy telemetry, and production strictness posture).
