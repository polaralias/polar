# Delivery Roadmap

Last updated: 2026-02-23

## Execution Snapshot (2026-02-23)

| Track/Phase | Status | Shipped Baseline | Next Milestone |
| --- | --- | --- | --- |
| Foundation Track A: pi-mono Wrap Layer | In Progress | Provider + agent-loop adapters, import boundaries, and middleware lifecycle hooks are implemented | Expand conformance + extraction-readiness suites and keep adapter parity as upstream dependencies evolve |
| Foundation Track B: OpenClaw Concept Adaptation | In Progress | Heartbeat, memory retrieval/write/compaction gateway contracts, automation, fallback patterns, scheduler retry/dead-letter orchestration baseline, and a file-backed scheduler state-store adapter + queue diagnostics/run-action baseline (`dismiss`, `retry_now`, `requeue`) are implemented as Polar-native gateway contracts | Wire production-grade durable scheduler backends and richer observability surfaces for automation + run health |
| Phase 1: Deterministic Core | In Progress | Contract registry + typed middleware/audit pipelines are implemented and enforced in runtime gateways | Complete hardened deployment defaults and maintain non-bypass regression coverage as new capabilities land |
| Phase 2: Unified Chat Surface | In Progress | Web/Telegram/Slack/Discord ingress normalization, native-thread/session continuity parity coverage, typed ingress health-check baseline, and control-plane ingress diagnostics proxying are implemented on one canonical contract path | Integrate ingress health diagnostics into operator UI + alert workflows and extend end-to-end channel continuity visibility |
| Phase 3: Multi-Agent And Profiles | In Progress | Typed routing policy + handoff gateway, contract-governed profile pinning/resolution baseline, resolver-aware automation/heartbeat gateway entry handling, resolver-aware handoff routing constraints, typed handoff routing diagnostics, middleware-based handoff routing telemetry collector baseline, contract-governed telemetry listing gateway with control-plane proxying plus scoped telemetry filters (`sessionId`, `workspaceId`, `sourceAgentId`, `status`) and continuity fixtures, contract-governed telemetry alert synthesis for handoff/usage collector windows, and delegated handoff profile-scoped capability projection support are implemented | Complete operator-facing telemetry views/alerts and full orchestrator fanout/fanin integration on top of resolver-aware routing/projection baselines |
| Phase 4: Extension Fabric | In Progress | Skills/MCP/plugins install-sync/lifecycle/execute governance baselines are implemented | Complete operational trust/revocation workflows and deeper governance telemetry |
| Phase 5: Automation, Heartbeat, And Memory | In Progress | Typed heartbeat tick, automation draft/run, memory search/get/upsert/compact gateways, and contract-governed persisted scheduler/event processing + run-link replay orchestration baseline with retry/dead-letter dispositions, file-backed scheduler state-store durability, and queue diagnostics + run-action controls (`dismiss`, `retry_now`, `requeue`) are implemented | Harden production-grade scheduler queue/storage backends, memory persistence lifecycle controls, and retry/dead-letter policy tuning/diagnostics |
| Phase 6: Polar Web UI Control Plane | In Progress | Control-plane config API, chat-management backend, task-board runtime/live-update gateways, automation/heartbeat gateway run-to-task linkage wiring, task replay ingestion endpoint, persisted scheduler/event run-link source ingestion baseline, contract-governed usage telemetry list/summary + telemetry alert proxy baseline, and control-plane scheduler queue diagnostics + run-action proxying (including `retry_now` and dead-letter `requeue`) are implemented | Deliver operator Web UI surfaces and telemetry dashboard/alert integration on top of shipped backend diagnostics |
| Phase 7: Production Hardening | In Progress | Multiple hardening sweeps and policy-bypass regressions are in place | Complete security/SLO/canary rollout milestones and production hardening checklists |

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
2. Harden proactive schedule/event runners by extending the shipped file-backed scheduler state-store baseline with production-grade queue/storage backends.
3. Harden structured memory write/recall flows with provider-backed persistence and compaction policy controls.
4. Deepen idempotency, retry, and dead-letter controls with queue observability and operator diagnostics.

Exit criteria:

1. Automation and heartbeat runs are fully typed and auditable.
2. Heartbeat local-model-first routing and fallback policies are active.
3. Memory retrieval/write/compaction contracts are enforced and observable.
4. Failure and retry behavior is deterministic.

## Phase 6: Polar Web UI Control Plane

1. Complete task-board operator surfaces on top of shipped assignment/status contract backends.
2. Ship operator management surfaces for channels, extensions, automations, policies, and runs.
3. Surface persisted scheduler/event run execution and replay diagnostics in operator UI workflows.
4. Expand shipped usage/cost telemetry list/summary + alert APIs into operator-visible dashboards and actionable diagnostics.

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
