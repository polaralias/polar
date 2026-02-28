# Chat Routing And Multi-Agent Design

Last updated: 2026-02-27

> See also: **Deterministic Orchestration Architecture** (`docs/architecture/deterministic-orchestration-architecture.md`) for the authoritative “model proposes, code decides” boundary and the end-state behaviour rules.

## Unified Chat Contract

All endpoints map to one canonical message shape:

1. `sessionId`
2. `userId`
3. `channel` (`web`, `telegram`, `slack`, `discord`, `other`)
4. `message` (text, attachments, metadata)
5. `context` (reply references, locale, routing hints)

Endpoint adapters are transport-specific only. They do not own business logic.

**Important:** reply/thread IDs from transports are treated as *anchoring metadata* and must not partition conversation history. Session identity remains stable per chat.

## Routing Model

1. Entry point is always the primary chat orchestrator (server-side).
2. Policy resolves a model lane for the turn (`local`, `worker`, `brain`).
3. The orchestrator deterministically decides one of:
   - direct response (no tools)
   - workflow proposal (approval required)
   - workflow execution (tools)
   - single-agent delegation
   - multi-agent fan-out/fan-in delegation
4. LLMs may *suggest* intent, slot fills, delegation candidates, and workflow templates, but the orchestrator validates and applies suggestions according to policy.
5. All delegated results return to the primary orchestrator for final synthesis and user response.

## Model vs Code Responsibilities

The LLM may:
- Suggest routing/classification (eg status nudge vs pending answer)
- Suggest a workflow template and arguments
- Write natural-language explanations and summaries

Code must enforce:
- Message attachment/thread selection and reply anchoring rules
- State transitions and workflow lifecycle (including approvals)
- Capability scope, tool allowlists, and delegated skill forwarding limits
- Model selection/budget caps
- Error visibility (failures must not be “summarised away”)

If the model can ignore an instruction and the system breaks, the rule belongs in code.

## Model Policy Behavior

1. Routine heartbeat and low-risk automation checks default to `local` model lane.
2. Interactive coding, synthesis, and ambiguous tasks escalate to `worker` or `brain` lanes.
3. Provider/profile/model fallback is automatic and policy-driven.
4. Manual mid-task model hopping is not the default path.
5. Every lane and fallback decision is logged with typed reason codes.

## Agent Profiles, Pinning, And Defaults

Each session can bind to a pinned `Agent Profile` containing:

1. Pinned LLM provider mapping, establishing role-based capabilities (e.g., Anthropic for writing tasks, Gemini for web research).
2. System prompt and behaviour constraints (advisory; not an enforcement mechanism).
3. Enabled skill set.
4. Allowed MCP server bindings.
5. Enabled Claude plugins.
6. Heartbeat and automation defaults.
7. Safety mode and approval settings.
8. Strictly populated `allowedHandoffTargets` boundaries to explicitly govern privilege expansion downstream.

These configurations are fully portable—managed via the operator Web UI or dynamically injected via `polar config set` CLI deployments straight into the Control Plane state.

Profiles can be:

1. Global default.
2. Workspace default.
3. Session override.

Resolution order is `session override -> workspace default -> global default`.

## Sub-Agent Scope Rules

1. Sub-agents run with explicit capability scope and inherited policy constraints.
2. Sub-agents are least-privilege by default; any requested `forward_skills` are treated as untrusted input and clamped by server policy.
3. One agent should own one primary domain of responsibility.
4. Temporary sub-agents are allowed for bounded parallel work and are explicitly traced.
5. Cross-domain privilege expansion requires explicit policy approval.

## Handoff Contract

Every agent handoff is an explicit object with:

1. Source agent id.
2. Target agent id.
3. Reason and intent.
4. Typed input payload.
5. Capability scope (server-owned and validated).
6. Model policy snapshot and budget context.
7. Trace correlation metadata.

No raw prompt-based handoff is accepted without a typed envelope and policy validation.

## Deterministic Failure Behavior

1. If validation fails before handoff, the handoff is rejected with a typed error.
2. If delegated execution fails, the failure payload is returned to the primary orchestrator with full trace context.
3. If a model fails, fallback is attempted according to policy before user-visible failure.
4. The user receives a deterministic response path, never a silent fallback claiming success.
