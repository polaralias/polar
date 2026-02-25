# Runtime Topology

Last updated: 2026-02-22

## Service Model

Polar runs as a self-hosted runtime composed of logical subsystems:

1. Ingress adapters: web chat, Telegram, Slack, Discord, and future endpoint adapters.
2. Session and chat service: canonical conversation state, message normalization, retention controls.
3. Agent orchestrator: primary routing agent and delegated sub-agent lifecycle.
4. Model policy and budget engine: local/worker/brain lane selection, fallback rules, and spend governance.
5. Memory and recall service: structured memory records, retrieval APIs, and compaction-aware persistence.
6. Contract and policy engine: schema validation, policy checks, trust boundaries, approval checks.
7. Tool execution gateway: one execution path for native tools, skills, MCP, and plugins.
8. Automation and heartbeat engine: scheduled, event-driven, and proactive runs with policy gating.
9. Task board service: structured task tracking, ownership, status transitions, and run linkage.
10. Management API and Polar Web UI: operator-facing control plane.
11. Audit and telemetry pipeline: structured traces, metrics, usage, and event lineage.

## Adopted Foundation Libraries

Polar uses selected `pi-mono` packages as foundations, wrapped by Polar runtime boundaries:

1. `@mariozechner/pi-ai`: provider and streaming abstraction.
2. `@mariozechner/pi-agent-core`: turn loop and tool lifecycle execution.
3. `@mariozechner/pi-web-ui`: optional reusable UI components where they fit.

Polar does not treat `pi-coding-agent` or OpenClaw as runtime cores.

Rationale and boundaries:

1. `docs/architecture/pi-mono-adoption-strategy.md`
2. `docs/architecture/openclaw-concepts-adoption.md`

## End-To-End Request Flow

1. A message arrives from web or a channel adapter.
2. The message is normalized into the canonical chat envelope.
3. Session context, agent profile defaults, and chat-configured policy state are resolved.
4. Model policy selects initial execution lane (`local`, `worker`, or `brain`).
5. Memory recall retrieves scoped durable context for the current turn.
6. The primary agent decides whether to answer directly or delegate.
7. Any handoff or tool request passes before-middleware checks.
8. Tool or sub-agent execution runs with explicit capability scope and typed contracts.
9. Result passes after-middleware checks before final synthesis.
10. Final response is normalized and delivered to the originating endpoint.
11. Audit, usage, and task-board events are emitted for every decision and execution step.

## Deployment Modes

1. Single-node mode: all subsystems in one deployment for local and small-team use.
2. Split mode: ingress, orchestration, execution, automation, and UI services scaled independently.
3. Isolated execution mode: extension runners sandboxed from core orchestration runtime.

## Data Boundaries

1. Chat/session store for message history and session metadata.
2. Control Plane storage for Agent Profiles, tracking pinned provider role configurations, strictly governed handoff targets, and dynamically upserted policies (e.g. from the `polar config set` zero-file CLI logic).
3. Extension catalog for installed skills, MCP servers, and plugins.
4. Contract registry for all callable operations.
5. Memory store for structured durable facts and recall indexes.
6. Automation store for triggers, schedules, heartbeat policies, and run outcomes.
7. Task store for task board records and assignment state.
8. Usage and budget store for model consumption and policy enforcement.
9. Audit store for immutable execution and governance logs.