# OpenClaw Concept Adoption Strategy

Last updated: 2026-02-22

## Decision

Selected route: adopt and extend selected OpenClaw concepts as Polar-native capabilities.

Not selected: runtime lift or direct wrapping of OpenClaw core due security posture mismatch, file-centric control brittleness, and schema-governance gaps against Polar invariants.

## Decision Matrix

| Concept | Decision | Polar Implementation Direction |
| --- | --- | --- |
| Periodic heartbeat runs | Adopt | Keep heartbeat as a first-class automation trigger class with typed run contracts and policy controls. |
| `HEARTBEAT_OK` ack contract and suppression | Adopt | Keep deterministic ack token handling and delivery suppression rules in code-level middleware. |
| `HEARTBEAT.md` as primary heartbeat control | Reject | Use chat/API/UI-configured `HeartbeatPolicy` as source of truth; support markdown import/export only for compatibility. |
| Skip heartbeats when checklist is effectively empty | Adapt | Skip routine heartbeat runs when no active checks/automations are configured in structured policy state. |
| Active-hours and queue-aware heartbeat gating | Adopt | Keep active-hours windows and inflight-queue backpressure checks before heartbeat execution. |
| Local model for routine heartbeat checks | Adopt | Default heartbeat and low-risk automation loops to local model lane; escalate only when policy requires. |
| `MEMORY.md` + daily markdown logs as canonical memory | Reject | Use structured memory records with typed metadata and retention policies; optional markdown mirrors are non-canonical. |
| `memory_search` and `memory_get` constrained retrieval pattern | Adopt | Provide scoped memory retrieval tools with strict path/scope contracts and explicit degraded/unavailable responses. |
| Pre-compaction memory flush reminder | Adopt | Trigger silent pre-compaction memory persistence flow through typed background run pipeline. |
| Automatic model/profile fallback with cooldowns | Adopt | Use deterministic provider/profile/model fallback with explicit reason codes and cooldown tracking. |
| Manual mid-task model hopping | Reject | Keep model selection policy-driven; manual override remains explicit and traceable, not default workflow. |
| One-agent-one-job isolation guidance | Adopt | Preserve isolated agent profiles, scope boundaries, and capability-limited sub-agent delegation. |
| Dashboard-first visibility of sessions/usage/automation health | Adopt | Include operational visibility in Polar Web UI (runs, costs, failures, queues, policy denials). |
| Broad skill ecosystem with source caution | Adapt | Keep easy installs but require provenance checks, permission diffing, trust classification, and approval workflows. |
| PLAN/MEMORY markdown maintenance as core workflow | Adapt | Keep planning and memory as structured entities; expose markdown export/import views for portability. |
| Large agent fleets as default pattern | Reject | Encourage minimal focused agent set with policy quotas and cost budgets. |

## Polar Extensions Beyond OpenClaw

1. Mandatory before/after middleware on all tool calls, handoffs, heartbeat ticks, and automation steps.
2. Mandatory typed input and output contracts for every callable operation.
3. Unified trust and risk model across native tools, skills, MCP tools, and plugins.
4. Chat-first configuration model with deterministic state transitions and audit trails.
5. Task board as a first-class object linked to chat actions, automation runs, and agent ownership.

## Architecture Linkage

This decision doc extends and does not replace:

1. `docs/architecture/pi-mono-adoption-strategy.md`
2. `docs/architecture/runtime-topology.md`
3. `docs/architecture/tooling-contract-middleware.md`