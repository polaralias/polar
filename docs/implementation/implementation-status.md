# Architecture-to-Implementation Status Matrix
Last updated: 2026-02-28

This file is the working source of truth for architecture-to-code alignment in this repository.

Status legend:
- `Implemented`: behavior exists in runtime code and has direct tests.
- `Partial`: some behavior exists, but scope, wiring, or tests are incomplete.
- `Missing`: behavior described in docs is not implemented in code.
- `Doc drift`: doc currently claims behavior that does not match the runtime reality.

## Matrix

| Subsystem/Claim | Doc source | Status | Code pointers | Tests | Notes/Follow-ups |
| --- | --- | --- | --- | --- | --- |
| Canonical ingress adapters normalize web/telegram/slack/discord into one envelope | `docs/architecture/runtime-topology.md` | Implemented | `packages/polar-adapter-channels/src/index.mjs`, `packages/polar-runtime-core/src/chat-ingress-gateway.mjs` | `tests/adapter-channels-normalization.test.mjs`, `tests/runtime-core-chat-ingress-gateway.test.mjs` | Session identity is stable; reply metadata treated as routing hints. |
| Session/chat service supports append/history/search/retention | `docs/architecture/runtime-topology.md` | Implemented | `packages/polar-runtime-core/src/chat-management-gateway.mjs` | `tests/control-plane-service.test.mjs`, `tests/runtime-core-chat-management-gateway.test.mjs` | F0 unblocked `control-plane-service` suite on 2026-02-28. |
| Orchestrator owns routing, workflow proposal/execution, and thread state | `docs/architecture/runtime-topology.md` | Implemented | `packages/polar-runtime-core/src/orchestrator.mjs`, `packages/polar-runtime-core/src/routing-policy-engine.mjs` | `tests/runtime-core-orchestrator-routing.test.mjs`, `tests/runtime-core-orchestrator-thread-ownership.test.mjs` | Deterministic routing and thread ownership are code-owned. |
| Model policy/budget lane selection + reasoned fallback | `docs/architecture/runtime-topology.md` | Partial | `packages/polar-runtime-core/src/model-policy-engine.mjs`, `packages/polar-runtime-core/src/provider-gateway.mjs`, `packages/polar-runtime-core/src/budget-gateway.mjs` | `tests/runtime-core-provider-gateway.test.mjs`, `tests/runtime-core-budget-gateway.test.mjs`, `tests/runtime-core-budget-enforcement.test.mjs` | Fallback/cooldown exists in provider gateway; lane policy integration is not end-to-end authoritative yet. |
| Memory service with retrieval + compaction-aware persistence | `docs/architecture/runtime-topology.md` | Partial | `packages/polar-runtime-core/src/memory-gateway.mjs`, `packages/polar-runtime-core/src/memory-provider-sqlite.mjs` | `tests/runtime-core-memory-gateway.test.mjs` | Core memory gateway exists; advanced compaction and product workflows are not fully mature. |
| Contract/policy engine rejects unknown/invalid IO | `docs/architecture/runtime-topology.md` | Implemented | `packages/polar-runtime-core/src/contract-registry.mjs`, `packages/polar-runtime-core/src/middleware-pipeline.mjs` | `tests/runtime-core-contract-middleware.test.mjs` | Fail-closed behavior and typed errors are enforced. |
| Unified tool execution path for native/skill/MCP/plugin via extension gateway | `docs/architecture/runtime-topology.md` | Implemented | `packages/polar-runtime-core/src/extension-gateway.mjs`, `packages/polar-runtime-core/src/skill-installer-gateway.mjs`, `packages/polar-runtime-core/src/mcp-connector-gateway.mjs`, `packages/polar-runtime-core/src/plugin-installer-gateway.mjs` | `tests/runtime-core-extension-gateway.test.mjs`, `tests/runtime-core-mcp-connector-gateway.test.mjs`, `tests/runtime-core-plugin-installer-gateway.test.mjs` | Core path exists and is policy-gated by capability scope. |
| Automation/heartbeat engine runs through policy + middleware | `docs/architecture/runtime-topology.md` | Implemented | `packages/polar-runtime-core/src/automation-gateway.mjs`, `packages/polar-runtime-core/src/heartbeat-gateway.mjs`, `packages/polar-runtime-core/src/scheduler-gateway.mjs` | `tests/runtime-core-automation-gateway.test.mjs`, `tests/runtime-core-heartbeat-gateway.test.mjs`, `tests/runtime-core-scheduler-gateway.test.mjs` | Deterministic skip/retry/dead-letter behavior covered. |
| Task board service links runs and supports deterministic transitions | `docs/architecture/runtime-topology.md` | Implemented | `packages/polar-runtime-core/src/task-board-gateway.mjs`, `packages/polar-runtime-core/src/task-board-run-linker.mjs` | `tests/runtime-core-task-board-gateway.test.mjs`, `tests/runtime-core-task-board-run-linker.test.mjs` | Run linkage and replay keys are idempotent. |
| Management API + Web UI as control-plane surface | `docs/architecture/runtime-topology.md` | Partial | `packages/polar-control-plane/src/index.mjs`, `packages/polar-web-ui/src/main.js` | `tests/control-plane-service.test.mjs`, `tests/channels-thin-client-enforcement.test.mjs`, `tests/control-plane-direct-execution-approvals.test.mjs` | Core API/UI exists; direct `executeExtension` now recomputes capability scope server-side and enforces approval policy at the same extension-gateway choke point used by orchestration. |
| Audit/telemetry pipeline gives end-to-end lineage | `docs/architecture/runtime-topology.md` | Implemented | `packages/polar-runtime-core/src/middleware-pipeline.mjs`, `packages/polar-runtime-core/src/durable-lineage-store.mjs`, `packages/polar-runtime-core/src/orchestrator.mjs`, `packages/polar-runtime-core/src/usage-telemetry-gateway.mjs`, `packages/polar-runtime-core/src/handoff-telemetry-gateway.mjs` | `tests/runtime-core-contract-middleware.test.mjs`, `tests/runtime-core-usage-telemetry-gateway.test.mjs`, `tests/runtime-core-handoff-routing-telemetry.test.mjs`, `tests/runtime-core-lineage-telemetry.test.mjs` | Durable append-only lineage is now queryable by `workflowId`/`runId`/`threadId`; extension step lineage includes both `extensionId` and `capabilityId`. |
| Deployment modes (single-node/split/isolated execution) are productized | `docs/architecture/runtime-topology.md` | Missing | No deployment manifests or runtime mode switch layer in repo | No tests | Currently documented as target topology, not implemented deployment packaging. |
| Data boundaries have durable stores (chat, policy, extension, memory, automation, tasks, usage, audit) | `docs/architecture/runtime-topology.md` | Partial | `packages/polar-runtime-core/src/*-gateway.mjs`, sqlite stores for scheduler/budget/memory | Mixed gateway tests; no single store integration test | Several stores are in-memory by default; durable audit store not present. |
| Model can propose, code decides routing/state/workflow/permissions | `docs/architecture/deterministic-orchestration-architecture.md` | Implemented | `packages/polar-runtime-core/src/orchestrator.mjs`, `packages/polar-runtime-core/src/routing-policy-engine.mjs`, `packages/polar-runtime-core/src/workflow-engine.mjs` | `tests/runtime-core-orchestrator-routing.test.mjs`, `tests/runtime-core-orchestrator-repair-phrasing.test.mjs`, `tests/runtime-core-workflow-template-enforcement.test.mjs` | LLM suggestions are constrained; core decisions are deterministic code paths. |
| Thin clients do not orchestrate locally | `docs/architecture/deterministic-orchestration-architecture.md` | Implemented | `packages/polar-web-ui/src/views/chat.js`, `packages/polar-web-ui/src/api.js`, `packages/polar-bot-runner/src/index.mjs` | `tests/channels-thin-client-enforcement.test.mjs` | Web and Telegram call backend orchestrate/execute/reject/repair endpoints; web `repair_question` A/B now routes to `handleRepairSelection`. |
| Canonical message contract includes reply metadata without session partitioning | `docs/architecture/deterministic-orchestration-architecture.md` | Implemented | `packages/polar-adapter-channels/src/index.mjs`, `packages/polar-runtime-core/src/chat-ingress-gateway.mjs` | `tests/adapter-channels-normalization.test.mjs` | Thread/reply IDs are metadata hints and not session identity. |
| Micro-thread state tracks pending/in-flight/approval/error loop context | `docs/architecture/deterministic-orchestration-architecture.md` | Implemented | `packages/polar-runtime-core/src/orchestrator.mjs`, `packages/polar-runtime-core/src/routing-policy-engine.mjs` | `tests/runtime-core-open-loops-repair.test.mjs`, `tests/runtime-core-orchestrator-thread-ownership.test.mjs` | `lastError`, `pendingQuestion`, `inFlight`, `awaitingApproval`, `openOffer` are present. |
| Routing priority rules (override > fit answer > status nudge > new request > filler) are deterministic | `docs/architecture/deterministic-orchestration-architecture.md` | Implemented | `packages/polar-runtime-core/src/routing-policy-engine.mjs` | `tests/runtime-core-orchestrator-routing.test.mjs`, `tests/runtime-core-open-loops-repair.test.mjs` | Matches documented precedence. |
| Inline reply anchoring only when policy says and anchor is valid | `docs/architecture/deterministic-orchestration-architecture.md` | Implemented | `packages/polar-runtime-core/src/routing-policy-engine.mjs`, `packages/polar-bot-runner/src/index.mjs` | `tests/channels-thin-client-enforcement.test.mjs` | F1 enforces strict Telegram anchor gating: invalid/non-numeric `anchorMessageId` no longer falls back to current message. |
| Template-first workflows reject unknown templates and invalid args pre-execution | `docs/architecture/deterministic-orchestration-architecture.md` | Implemented | `packages/polar-runtime-core/src/workflow-engine.mjs`, `packages/polar-runtime-core/src/workflow-templates.mjs` | `tests/runtime-core-workflow-template-enforcement.test.mjs`, `tests/runtime-core-orchestrator-workflow-validation.test.mjs` | Legacy `<polar_workflow>` path is ignored. |
| Workflow proposals are blocked states requiring approve/reject where needed | `docs/architecture/deterministic-orchestration-architecture.md` | Implemented | `packages/polar-runtime-core/src/orchestrator.mjs` | `packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs` | Plan approval and auto-run split is enforced by code. |
| Capability scope projection and policy checks enforce permissions | `docs/architecture/deterministic-orchestration-architecture.md` | Implemented | `packages/polar-runtime-core/src/capability-scope.mjs`, `packages/polar-runtime-core/src/extension-gateway.mjs` | `tests/runtime-core-capability-scope-enforcement.test.mjs`, `tests/runtime-core-extension-gateway.test.mjs` | Empty/invalid scope is denied. |
| Deterministic execution header prevents failure summarization | `docs/architecture/deterministic-orchestration-architecture.md` | Implemented | `packages/polar-runtime-core/src/orchestrator.mjs` | `tests/runtime-core-orchestrator-thread-ownership.test.mjs` | Header is prepended before narrative. |
| Unified chat contract and transport-only adapters | `docs/architecture/chat-routing-and-multi-agent.md` | Implemented | `packages/polar-adapter-channels/src/index.mjs`, `packages/polar-runtime-core/src/chat-ingress-gateway.mjs` | `tests/adapter-channels-normalization.test.mjs` | Adapters are normalization boundaries, not orchestration logic. |
| Entry point is primary server orchestrator for routing outcomes | `docs/architecture/chat-routing-and-multi-agent.md` | Implemented | `packages/polar-runtime-core/src/orchestrator.mjs`, `packages/polar-control-plane/src/index.mjs` | `tests/channels-thin-client-enforcement.test.mjs` | Web/Telegram route through control plane orchestrator. |
| Model policy lane decisions are logged with reason codes | `docs/architecture/chat-routing-and-multi-agent.md` | Partial | `packages/polar-runtime-core/src/provider-gateway.mjs`, `packages/polar-runtime-core/src/usage-telemetry-gateway.mjs` | `tests/runtime-core-usage-telemetry-gateway.test.mjs` | Fallback telemetry exists; explicit lane reason-code framework is incomplete end-to-end. |
| Profile resolution order session -> workspace -> global | `docs/architecture/chat-routing-and-multi-agent.md` | Implemented | `packages/polar-runtime-core/src/profile-resolution-gateway.mjs` | `tests/runtime-core-profile-resolution-gateway.test.mjs`, `tests/control-plane-service.test.mjs` | Resolution logic exists and is tested directly. |
| Sub-agent least-privilege forwarding clamps untrusted `forward_skills` | `docs/architecture/chat-routing-and-multi-agent.md` | Implemented | `packages/polar-runtime-core/src/capability-scope.mjs`, `packages/polar-runtime-core/src/orchestrator.mjs` | `tests/runtime-core-orchestrator-delegation-scope.test.mjs`, `tests/runtime-core-capability-scope-enforcement.test.mjs` | Rejected forwarded skills are clamped out. |
| Typed handoff envelope with capability scope and policy snapshot | `docs/architecture/chat-routing-and-multi-agent.md` | Partial | `packages/polar-runtime-core/src/handoff-gateway.mjs`, `packages/polar-runtime-core/src/routing-policy-engine.mjs` | `tests/runtime-core-handoff-gateway.test.mjs` | Handoff gateway is implemented, but orchestrator delegation still uses workflow tool path rather than full handoff gateway integration. |
| Open loop state model tracks pending/in-flight/offer/approval + recent offers | `docs/architecture/open-loops-and-change-of-mind.md` | Implemented | `packages/polar-runtime-core/src/routing-policy-engine.mjs` | `tests/runtime-core-open-loops-repair.test.mjs` | Ring buffer and reversal TTL behavior exist. |
| Status nudges attach to most recent in-flight/blocked thread | `docs/architecture/open-loops-and-change-of-mind.md` | Implemented | `packages/polar-runtime-core/src/routing-policy-engine.mjs` | `tests/runtime-core-open-loops-repair.test.mjs`, `tests/runtime-core-orchestrator-routing.test.mjs` | Priority over pending question in other thread is tested. |
| Change-of-mind (reject then affirm) is deterministic without extra LLM step | `docs/architecture/open-loops-and-change-of-mind.md` | Implemented | `packages/polar-runtime-core/src/routing-policy-engine.mjs` | `tests/runtime-core-open-loops-repair.test.mjs` | `nah` then `actually yes` returns to prior offer thread. |
| Repair triggers only for ambiguous low-information turns with multiple plausible loops | `docs/architecture/routing-repair-and-disambiguation.md` | Implemented | `packages/polar-runtime-core/src/routing-policy-engine.mjs`, `packages/polar-runtime-core/src/orchestrator.mjs` | `tests/runtime-core-open-loops-repair.test.mjs`, `tests/runtime-core-orchestrator-repair-phrasing.test.mjs` | Rare/conditional trigger in code. |
| Repair output uses fixed A/B IDs; LLM cannot invent authority | `docs/architecture/routing-repair-and-disambiguation.md` | Implemented | `packages/polar-runtime-core/src/routing-policy-engine.mjs`, `packages/polar-runtime-core/src/orchestrator.mjs` | `tests/runtime-core-orchestrator-repair-phrasing.test.mjs` | Correlation and thread mapping are code-owned. |
| Repair button selection events route deterministically with no LLM interpretation | `docs/architecture/routing-repair-and-disambiguation.md` | Implemented | `packages/polar-runtime-core/src/orchestrator.mjs`, `packages/polar-bot-runner/src/index.mjs`, `packages/polar-web-ui/src/views/chat.js`, `packages/polar-web-ui/vite.config.js` | `tests/channels-thin-client-enforcement.test.mjs` | Telegram and web callback paths map A/B selections to backend `handleRepairSelection` API without local LLM interpretation. |
| Repair telemetry/audit events are emitted for trigger/selection/outcome | `docs/architecture/routing-repair-and-disambiguation.md` | Implemented | `packages/polar-runtime-core/src/orchestrator.mjs`, `packages/polar-runtime-core/src/durable-lineage-store.mjs` | `tests/runtime-core-lineage-telemetry.test.mjs` | Orchestrator now emits first-class `repair.triggered`, `repair.selection`, and `repair.outcome` lineage events with deterministic reason codes. |
| Capability risk metadata (risk/side effects/egress) is required at install-time | `docs/architecture/approvals-and-grants.md` | Implemented | `packages/polar-runtime-core/src/skill-registry.mjs`, `packages/polar-runtime-core/src/skill-installer-gateway.mjs`, `packages/polar-runtime-core/src/mcp-connector-gateway.mjs` | `tests/runtime-core-skill-registry-install-enforcement.test.mjs` | Missing metadata blocks install/enable. |
| Read and internal-write actions auto-run; external-write/destructive require approvals | `docs/architecture/approvals-and-grants.md` | Implemented | `packages/polar-runtime-core/src/orchestrator.mjs`, `packages/polar-runtime-core/src/approval-store.mjs` | `packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs` | Destructive actions require per-action approval by default. |
| Approval grants are scoped by principal, capability, targets, constraints, TTL | `docs/architecture/approvals-and-grants.md` | Implemented | `packages/polar-runtime-core/src/approval-store.mjs` | `packages/polar-runtime-core/tests/approval-store.test.mjs` | Target/constraint deterministic matching implemented. |
| Plan approval applies once for multi-step flow (no per-step prompt) | `docs/architecture/approvals-and-grants.md` | Implemented | `packages/polar-runtime-core/src/orchestrator.mjs` | `packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs` | Multi-step external workflow executes after one approval. |
| Runtime enforcement point is extension gateway policy evaluation | `docs/architecture/approvals-and-grants.md` | Implemented | `packages/polar-runtime-core/src/extension-gateway.mjs`, `packages/polar-runtime-core/src/orchestrator.mjs`, `packages/polar-control-plane/src/index.mjs` | `tests/runtime-core-extension-gateway.test.mjs`, `packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`, `tests/control-plane-direct-execution-approvals.test.mjs` | F2 wired built-in approval checks in extension execution, added run-scoped destructive approval handling, and aligned direct control-plane execution with orchestrator scope/policy behavior. |
| SkillRegistry is runtime source of truth for blocked/pending metadata states | `docs/architecture/skill-registry-and-installation.md` | Implemented | `packages/polar-runtime-core/src/skill-registry.mjs`, `packages/polar-runtime-core/src/skill-installer-gateway.mjs`, `packages/polar-control-plane/src/index.mjs` | `tests/runtime-core-skill-registry-install-enforcement.test.mjs`, `tests/runtime-core-skill-installer-gateway.test.mjs`, `tests/control-plane-skill-install-hitl.test.mjs` | Registry now tracks proposal/review state and lifecycle authority snapshots used by control-plane capability projection. |
| Install-time metadata enforcement blocks enable if any capability missing risk metadata | `docs/architecture/skill-registry-and-installation.md` | Implemented | `packages/polar-runtime-core/src/skill-registry.mjs`, `packages/polar-runtime-core/src/skill-installer-gateway.mjs`, `packages/polar-runtime-core/src/mcp-connector-gateway.mjs` | `tests/runtime-core-skill-registry-install-enforcement.test.mjs` | Enforced for skill and MCP paths. |
| Metadata completion requires per-capability explanation | `docs/architecture/skill-registry-and-installation.md` | Implemented | `packages/polar-runtime-core/src/skill-registry.mjs` | `tests/runtime-core-skill-registry-install-enforcement.test.mjs` | Explanation minimum length is validated. |
| Install-time manifest generation is available and HITL-gated | `docs/architecture/skill-registry-and-installation.md` | Implemented | `packages/polar-runtime-core/src/skill-installer-gateway.mjs`, `packages/polar-control-plane/src/index.mjs` | `tests/runtime-core-skill-installer-gateway.test.mjs`, `tests/control-plane-skill-install-hitl.test.mjs` | Proposal/review/enable APIs are explicit; reject/approve transitions are deterministic and tested. |
| Runtime does not regenerate manifests automatically during execution | `docs/architecture/skill-registry-and-installation.md` | Implemented | `packages/polar-runtime-core/src/orchestrator.mjs`, `packages/polar-runtime-core/src/skill-installer-gateway.mjs` | Indirect coverage in orchestration/installer tests | No runtime auto-call to install analyzer path. |
| CapabilityScope projection uses registry+policy projection, not prompt strings | `docs/architecture/skill-registry-and-installation.md` | Implemented | `packages/polar-runtime-core/src/capability-scope.mjs`, `packages/polar-control-plane/src/index.mjs` | `tests/runtime-core-capability-scope-enforcement.test.mjs`, `tests/control-plane-skill-install-hitl.test.mjs` | Scope projection now accepts registry authority states and gives them precedence over extension snapshots when provided. |
| Installed skills are available to orchestrator and sub-agents via same scope machinery | `docs/architecture/skill-registry-and-installation.md` | Implemented | `packages/polar-runtime-core/src/capability-scope.mjs`, `packages/polar-runtime-core/src/orchestrator.mjs` | `tests/runtime-core-skill-registry-install-enforcement.test.mjs`, `tests/runtime-core-orchestrator-delegation-scope.test.mjs` | Works when extension is enabled and allowlisted. |
| Every tool/handoff/automation/heartbeat/lifecycle path has before+after middleware | `docs/architecture/tooling-contract-middleware.md` | Implemented | `packages/polar-runtime-core/src/middleware-pipeline.mjs`, gateway modules | `tests/runtime-core-contract-middleware.test.mjs`, `tests/runtime-core-handoff-gateway.test.mjs`, `tests/runtime-core-automation-gateway.test.mjs`, `tests/runtime-core-heartbeat-gateway.test.mjs`, `tests/runtime-core-extension-gateway.test.mjs` | Non-bypassable at gateway boundary. |
| Contract registry blocks unknown actions and validates input/output schemas | `docs/architecture/tooling-contract-middleware.md` | Implemented | `packages/polar-runtime-core/src/contract-registry.mjs` | `tests/runtime-core-contract-middleware.test.mjs` | Strict schema enforcement is active. |
| Strictness modes (`observe`/`enforce`/`hardened`) are configurable runtime modes | `docs/architecture/tooling-contract-middleware.md` | Missing | No strictness mode switch in middleware/registry interfaces | No tests | Current behavior is effectively enforce/fail-closed. |
| Provider endpoint strategy and broad provider matrix are codified end-to-end | `docs/architecture/llm-providers.md` | Partial | `packages/polar-runtime-core/src/provider-gateway.mjs`, `packages/polar-adapter-native/src/index.mjs`, `packages/polar-web-ui/src/views/config.js` | `tests/runtime-core-provider-gateway.test.mjs`, `tests/adapter-native-http.test.mjs` | Doc is largely research/notes; runtime supports key modes but not full matrix exactly as documented. |
| OpenClaw heartbeat/memory concepts adopted as typed policy/state | `docs/architecture/openclaw-concepts-adoption.md` | Partial | `packages/polar-runtime-core/src/heartbeat-gateway.mjs`, `packages/polar-runtime-core/src/memory-gateway.mjs`, `packages/polar-web-ui/src/views/config.js` | `tests/runtime-core-heartbeat-gateway.test.mjs`, `tests/runtime-core-memory-gateway.test.mjs` | Several concept mappings exist; some table items remain aspirational. |
| pi-mono imports are isolated to adapter boundary | `docs/architecture/pi-mono-adoption-strategy.md` | Implemented | `scripts/check-pi-mono-imports.mjs`, `packages/polar-adapter-pi/*` | `tests/check-pi-mono-imports.test.mjs` | Boundary enforcement test is in place. |
| pi-mono foundation is wrapped, with Polar-owned contracts/middleware in core | `docs/architecture/pi-mono-adoption-strategy.md` | Partial | `packages/polar-adapter-pi/src/index.mjs`, `packages/polar-runtime-core/src/contract-registry.mjs`, `packages/polar-runtime-core/src/middleware-pipeline.mjs` | `tests/adapter-pi.test.mjs`, `tests/runtime-core-contract-middleware.test.mjs` | Adapter exists; core runtime does not rely on pi runtime loop by default path. |
| Skills/MCP/plugins share one contract-validated policy execution path | `docs/extensions/skills-mcp-plugins.md` | Implemented | `packages/polar-runtime-core/src/extension-gateway.mjs`, installer/connector gateways | `tests/runtime-core-extension-gateway.test.mjs`, `tests/runtime-core-mcp-connector-gateway.test.mjs`, `tests/runtime-core-plugin-installer-gateway.test.mjs` | Unified execution path is present. |
| Chat-first extension management (chat + API + Web UI) is available | `docs/extensions/skills-mcp-plugins.md` | Partial | `packages/polar-web-ui/src/views/config.js`, `packages/polar-control-plane/src/index.mjs` | No explicit chat-command tests | API/UI coverage exists; explicit chat command workflow is not established in runtime. |
| SKILL.md install flow enforces provenance, permission deltas, and review before enable | `docs/extensions/skills-mcp-plugins.md` | Implemented | `packages/polar-runtime-core/src/skill-installer-gateway.mjs`, `packages/polar-runtime-core/src/skill-registry.mjs`, `packages/polar-control-plane/src/index.mjs` | `tests/runtime-core-skill-registry-install-enforcement.test.mjs`, `tests/runtime-core-skill-installer-gateway.test.mjs`, `tests/control-plane-skill-install-hitl.test.mjs` | F3 adds explicit manifest proposal/review/enable transitions and pending proposal listing in control-plane APIs. |
| Dev-only MCP harness integrations are blocked from end-user runtime surfaces | `docs/extensions/skills-mcp-plugins.md` | Missing | No explicit runtime denylist for dev-only MCP connectors | No tests | Policy-level documentation exists but hard enforcement path is not implemented. |
| Plugin install follows same governance (descriptor parse, auth, policy, audit) | `docs/extensions/skills-mcp-plugins.md` | Implemented | `packages/polar-runtime-core/src/plugin-installer-gateway.mjs`, `packages/polar-adapter-extensions/src/plugin-connector.mjs` | `tests/runtime-core-plugin-installer-gateway.test.mjs` | Permission delta and trust checks are enforced. |
| Release gates: full contract/middleware coverage and no bypass paths | `docs/operations/quality-and-safety.md` | Partial | Runtime gateways + middleware + contracts across `packages/polar-runtime-core/src` | Multiple runtime-core tests; see command list in audit log | Many gates are met, but known bypass/drift risks remain (lineage durability; policy/telemetry gaps). |
| Security baseline: extension credentials encrypted at rest | `docs/operations/quality-and-safety.md` | Partial | `packages/polar-runtime-core/src/crypto-vault.mjs`, `packages/polar-runtime-core/src/control-plane-gateway.mjs` | `tests/runtime-core-control-plane-gateway.test.mjs` | Encryption exists for config secrets; broader credential lifecycle hardening still evolving. |
| Operational observability minimum telemetry fields are fully available | `docs/operations/quality-and-safety.md` | Partial | Usage/handoff telemetry modules + middleware audit sink | `tests/runtime-core-usage-telemetry-gateway.test.mjs`, `tests/runtime-core-handoff-routing-telemetry.test.mjs`, `tests/runtime-core-contract-middleware.test.mjs` | Not all requested fields are unified under one durable lineage query model. |
| Incident SOPs (provider failover, vault recovery, extension kill-switch) are actionable from runtime surfaces | `docs/operations/incident-response-and-drills.md` | Partial | Provider fallback (`provider-gateway`), vault (`crypto-vault`), extension lifecycle (`extension-gateway`) | `tests/runtime-core-provider-gateway.test.mjs`, `tests/runtime-core-extension-gateway.test.mjs` | Runbook is mostly process guidance; not all drills have automated checks. |
| Incident drill scenarios (blackout, store corruption, multi-agent loop panic) are codified as automated drills | `docs/operations/incident-response-and-drills.md` | Missing | No dedicated drill harness scripts | No tests | Add repeatable drill harness and pass/fail criteria. |
| Product doc claims current assistant architecture and completion status | `docs/product/ai-assistant.md` | Doc drift | Current runtime in `packages/polar-runtime-core/src/orchestrator.mjs`, `packages/polar-bot-runner/src/index.mjs` | `tests/channels-thin-client-enforcement.test.mjs`, orchestrator suites | Doc still describes legacy `createPiAgentTurnAdapter`/`<polar_workflow>` path and outdated completion claims. |
| Product automation classes and safety/idempotency behaviors | `docs/product/automations.md` | Partial | `packages/polar-runtime-core/src/automation-gateway.mjs`, `packages/polar-runtime-core/src/heartbeat-gateway.mjs`, `packages/polar-runtime-core/src/scheduler-gateway.mjs` | `tests/runtime-core-automation-gateway.test.mjs`, `tests/runtime-core-heartbeat-gateway.test.mjs`, `tests/runtime-core-scheduler-gateway.test.mjs` | Core engine exists; chat-first authoring UX and version rollback UX remain partial. |
| Web UI core management areas (chat/tasks/profiles/extensions/channels/automation/audit) are complete | `docs/product/web-ui-and-chat-management.md` | Partial | `packages/polar-web-ui/src/views/*.js`, `packages/polar-control-plane/src/index.mjs` | `tests/channels-thin-client-enforcement.test.mjs` | Current UI has dashboard/chat/tasks/telemetry/scheduler/config; channel mgmt + moderation + full extension lifecycle UIs are incomplete. |
| Real-time UI updates for tasks/long-runs/failures | `docs/product/web-ui-and-chat-management.md` | Missing | `packages/polar-web-ui/src/main.js` uses polling, no streaming channel | No tests | Add websocket/SSE update layer and deterministic event model for UI. |
| Implementation logging is append-only with evidence-oriented `Done` entries | `docs/implementation/implementation-log.md` | Implemented | `docs/implementation/implementation-log.md` | No automated tests | Practice is followed in recent entries; still human-process dependent. |

## Doc Drift Flags

1. `docs/product/ai-assistant.md` describes legacy runner architecture (`createPiAgentTurnAdapter`, `<polar_workflow>`) that is not the current deterministic orchestrator path.
2. `docs/product/web-ui-and-chat-management.md` overstates delivered UI scope (channel mgmt/moderation/realtime) versus current implemented views.
3. `docs/architecture/llm-providers.md` is a large research/reference dump and not fully reflected as enforceable runtime architecture.
4. `docs/extensions/skills-mcp-plugins.md` claims dev-only MCP harness isolation, but runtime enforcement hooks are not explicit.
5. `docs/operations/*` mix process goals and runtime guarantees without explicit code/test traceability in several sections.

## Top 10 Risks

1. `proposeManifest`/`reviewProposal` paths now have direct runtime+control-plane tests, but analyzer output validation still depends on model JSON conformance and should retain hard schema checks in future refactors.
2. Web repair selection flow is code-wired, but still lacks browser-level interaction tests beyond static adapter/UI assertions.
3. Durable lineage is file-backed in-process by default; multi-node/shared-store rollout and retention policies are not yet productized.
4. `generateOutput` is still a low-level API that intentionally bypasses orchestrator UX/thread routing, so caller governance and endpoint exposure remain policy-sensitive.
5. Capability scope projection now supports registry authority precedence in direct control-plane execution; orchestrator still uses extension state snapshots for execution-time scope derivation.
6. Analyzer contract registration remains opt-in (`includeAnalyzer`) and should be re-evaluated once broader end-to-end installer UX surfaces are in place.
7. Product docs (assistant/UI) materially diverge from code, creating planning and execution mistakes.
8. Deployment mode and operational drill docs are ahead of executable automation; resilience claims are not yet mechanically verified.
9. Lane-based model policy reason-code governance is only partially wired across orchestrator and telemetry.
10. Dev-only MCP harness restrictions remain documentation-led; explicit runtime denylist enforcement is still missing.

## Next 3 Priorities

1. Add reliability drill automation for provider blackout/audit-store degradation/loop containment (F5).
2. Close product/ops doc drift and publish release-gate evidence from implemented runtime behavior (F6).
3. Expand model lane/policy reason-code governance and expose alerting views over lineage decision streams.

## Finalization Write-up (2026-02-28)

Finalization execution is chunked in:
- `docs/implementation/implementation-finalization-plan.md`

This plan is built from audit outputs (`AUDIT-A` to `AUDIT-E`) and refreshed test evidence gathered on 2026-02-28.

F0 outcome evidence (2026-02-28):
- Passing: `node --test tests/control-plane-service.test.mjs`
- Passing: `node --test tests/runtime-core-skill-installer-gateway.test.mjs`
- Passing: `node --test tests/runtime-core-skill-risk-enforcement.test.mjs`

F1 outcome evidence (2026-02-28):
- Passing: `node --test tests/channels-thin-client-enforcement.test.mjs`
- Passing: `node --test tests/runtime-core-open-loops-repair.test.mjs`
- Added adapter/UI assertions:
  - invalid anchor -> non-inline (no Telegram fallback to current message id)
  - web `repair_question` A/B -> `handleRepairSelection` route

F2 outcome evidence (2026-02-28):
- Passing: `node --test tests/runtime-core-extension-gateway.test.mjs`
- Passing: `node --test packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- Passing: `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs`
- Passing (new direct control-plane approval semantics): `node --test tests/control-plane-direct-execution-approvals.test.mjs`
- Additional regression check: `node --test tests/bug-fixes-comprehensive.test.mjs tests/runtime-core-phase-8-advanced-features.test.mjs`

F3 outcome evidence (2026-02-28):
- Passing: `node --test tests/runtime-core-skill-installer-gateway.test.mjs`
- Passing: `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- Passing: `node --test tests/runtime-core-capability-scope-enforcement.test.mjs`
- Passing (new manifest proposal + HITL transition APIs): `node --test tests/control-plane-skill-install-hitl.test.mjs`
- Lifecycle evidence:
  - explicit `proposeSkillManifest` / `reviewSkillInstallProposal` / `listPendingSkillInstallProposals` APIs in control-plane
  - reject path now clears pending proposals and removes pending-install extension state
  - capability projection supports registry authority precedence via `authorityStates`

F4 outcome evidence (2026-02-28):
- Passing: `node --test tests/runtime-core-contract-middleware.test.mjs`
- Passing: `node --test tests/runtime-core-usage-telemetry-gateway.test.mjs`
- Passing: `node --test tests/runtime-core-handoff-routing-telemetry.test.mjs`
- Passing (new repair/policy/lineage coverage): `node --test tests/runtime-core-lineage-telemetry.test.mjs`
- Additional regression checks:
  - `node --test tests/runtime-core-handoff-telemetry-gateway.test.mjs`
  - `node --test tests/control-plane-service.test.mjs`
- Telemetry evidence:
  - durable append-only lineage store added (`durable-lineage-store.mjs`) and wired into middleware/orchestrator paths
  - middleware now emits explicit `policy.decision` events with deterministic reason codes
  - orchestrator now emits `repair.triggered` / `repair.selection` / `repair.outcome` events
  - extension execution metadata now carries lineage keys (`workflowId`/`runId`/`threadId`) for step-level audit correlation

F5 outcome evidence (2026-02-28):
- Passing (Drills): `node --test tests/runtime-core-drills-automation.test.mjs`
- Passing (Regression):
  - `node --test tests/runtime-core-provider-gateway.test.mjs`
  - `node --test tests/runtime-core-scheduler-gateway.test.mjs`
  - `node --test tests/runtime-core-scheduler-state-store-sqlite.test.mjs`
  - `node --test tests/runtime-core-chat-ingress-gateway.test.mjs`
- Reliability Features:
  - Standardized `timeoutMs` and `AbortController` in native provider HTTP adapter (`packages/polar-adapter-native/src/index.mjs`)
  - Configurable `defaultExecutionTimeoutMs` envelope in `createExtensionGateway` with `Promise.race` enforcement
  - Configurable `defaultTimeoutMs` in `createProviderGateway` for uniform LLM timeout policy
  - Server-side ingress rate-limiting/backoff in `createChatIngressGateway` with sliding window
  - Verified blackout failover, store degradation (fail-closed), and multi-agent runaway containment (panic exit via timeout)

Use chunk order `F0 -> (F1,F2) -> F3 -> F4 -> F5 -> F6` to keep long-running agent execution resumable with deterministic handoff boundaries.

# Summary of Completed Chunks:
- [x] F0: Registration Verification
- [x] F1: Orchestration Audit & Repair
- [x] F2: Approval Audits & Repair 
- [x] F3: Skill Installation Repair
- [x] F4: Observability Verification
- [x] F5: Reliability Drills (Current Turn)
- [ ] F6: Documentation Finalization
