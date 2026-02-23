# Project Overview

Last updated: 2026-02-22

## Mission

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