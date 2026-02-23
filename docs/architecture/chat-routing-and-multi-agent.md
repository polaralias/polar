# Chat Routing And Multi-Agent Design

Last updated: 2026-02-22

## Unified Chat Contract

All endpoints map to one canonical message shape:

1. `sessionId`
2. `userId`
3. `channel` (`web`, `telegram`, `slack`, `discord`, `other`)
4. `message` (text, attachments, metadata)
5. `context` (thread references, locale, routing hints)

Endpoint adapters are transport-specific only. They do not own business logic.

## Routing Model

1. Entry point is always the primary chat agent.
2. Policy resolves a model lane for the turn (`local`, `worker`, `brain`).
3. Primary agent decides one of:
   - direct response
   - single-agent delegation
   - multi-agent fan-out/fan-in delegation
4. Delegation targets are selected by capability fit, policy fit, profile constraints, and budget state.
5. All delegated results return to the primary agent for final synthesis.

## Model Policy Behavior

1. Routine heartbeat and low-risk automation checks default to `local` model lane.
2. Interactive coding, synthesis, and ambiguous tasks escalate to `worker` or `brain` lanes.
3. Provider/profile/model fallback is automatic and policy-driven.
4. Manual mid-task model hopping is not the default path.
5. Every lane and fallback decision is logged with typed reason codes.

## Agent Profiles, Pinning, And Defaults

Each session can bind to a pinned `Agent Profile` containing:

1. Default model lane policy and fallback policy.
2. System prompt and behavior constraints.
3. Enabled skill set.
4. Allowed MCP server bindings.
5. Enabled Claude plugins.
6. Heartbeat and automation defaults.
7. Safety mode and approval settings.

Profiles can be:

1. Global default.
2. Workspace default.
3. Session override.

Resolution order is `session override -> workspace default -> global default`.

## Sub-Agent Scope Rules

1. Sub-agents run with explicit capability scope and inherited policy constraints.
2. One agent should own one primary domain of responsibility.
3. Temporary sub-agents are allowed for bounded parallel work and are explicitly traced.
4. Cross-domain privilege expansion requires explicit policy approval.

## Handoff Contract

Every agent handoff is an explicit object with:

1. Source agent id.
2. Target agent id.
3. Reason and intent.
4. Typed input payload.
5. Capability scope.
6. Model policy snapshot and budget context.
7. Trace correlation metadata.

No raw prompt-based handoff is accepted without a typed envelope.

## Deterministic Failure Behavior

1. If validation fails before handoff, the handoff is rejected with a typed error.
2. If delegated execution fails, the failure payload is returned to the primary agent with full trace context.
3. If a model fails, fallback is attempted according to policy before user-visible failure.
4. The user receives a deterministic response path, never a silent fallback claiming success.