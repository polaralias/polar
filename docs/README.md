# Polar Documentation (Canonical)

Last updated: 2026-02-22

This documentation set is the single source of truth for Polar architecture, product scope, and delivery sequencing.

## Current Direction

1. Runtime foundation: wrap selected `pi-mono` libraries behind Polar governance layers.
2. Concept source: adopt selected OpenClaw patterns as Polar-native features, not as direct runtime lift.
3. Product surface: one chat-first experience with a Polar-owned Web UI for management, visibility, and control.

## Non-Negotiable Runtime Invariants

1. Every tool call has before and after middleware.
2. Every agent handoff has before and after middleware.
3. Every automation step and heartbeat run has before and after middleware.
4. Every callable function uses explicit typed input and output contracts.
5. Unknown or invalid inputs and outputs are rejected, never silently accepted.
6. No extension path bypasses policy, contract validation, or audit logging.

## Documentation Map

1. Project scope and principles: `docs/project-overview.md`
2. Runtime topology: `docs/architecture/runtime-topology.md`
3. pi-mono adoption strategy and boundaries: `docs/architecture/pi-mono-adoption-strategy.md`
4. OpenClaw concept adoption strategy: `docs/architecture/openclaw-concepts-adoption.md`
5. Chat routing and multi-agent flow: `docs/architecture/chat-routing-and-multi-agent.md`
6. Tool, handoff, automation, and heartbeat middleware contracts: `docs/architecture/tooling-contract-middleware.md`
7. Skills, MCP, and Claude plugins: `docs/extensions/skills-mcp-plugins.md`
8. Web UI and chat management: `docs/product/web-ui-and-chat-management.md`
9. Dynamic and proactive automations: `docs/product/automations.md`
10. End-to-end implementation plan: `docs/implementation/implementation-program-overview.md`
11. Implementation done-log: `docs/implementation/implementation-log.md`
12. Quality and safety gates: `docs/operations/quality-and-safety.md`
13. Current status snapshot: `docs/status/current-status.md`
14. Delivery roadmap: `docs/status/roadmap.md`
