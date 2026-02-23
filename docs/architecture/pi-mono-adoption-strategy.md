# pi-mono Adoption Strategy

Last updated: 2026-02-22

## Decision

Selected route: wrap core `pi-mono` libraries behind Polar governance layers, not a direct runtime lift of `pi-coding-agent`.

## Review Summary

The `pi-mono` codebase provides strong building blocks, but it does not match Polar's production invariants if adopted as-is.

## What Fits Well

1. `@mariozechner/pi-ai` provides a mature multi-provider LLM abstraction and streaming model.
2. `@mariozechner/pi-agent-core` provides a solid evented turn loop, tool execution lifecycle, and typed tool input schemas.
3. `@mariozechner/pi-coding-agent` exposes before/after-style extension interception for tools (`tool_call` and `tool_result` hooks).
4. `@mariozechner/pi-web-ui` can accelerate baseline UI components where they fit Polar interaction models.
5. `@mariozechner/pi-mom` provides useful channel and event-processing implementation patterns.

## Critical Gaps Against Polar Requirements

1. `pi-coding-agent` explicitly positions no built-in MCP and no built-in sub-agents, which conflicts with Polar core scope.
2. Tool input validation exists, but output contract validation is not enforced as a first-class schema gate.
3. Validation in `pi-ai` can be bypassed in browser-extension CSP environments, which conflicts with Polar's zero-unexpected-I/O posture.
4. There is no first-class handoff contract pipeline for multi-agent delegation envelopes.
5. Channel support in `pi-mono` runtime examples is Slack-focused, while Polar requires Slack, Telegram, Discord, and additional adapters.
6. Claude plugin installation and governance are not first-class runtime features.

## Implementation Route

### Wrap As Foundation

1. Wrap `@mariozechner/pi-ai` as Polar's provider and streaming engine.
2. Wrap `@mariozechner/pi-agent-core` as the execution loop under Polar middleware governance.
3. Reuse selected `@mariozechner/pi-web-ui` components where they fit Polar UX and control-plane requirements.

### Build In Polar (Mandatory)

1. Contract registry with versioned input and output schemas for all tools and handoffs.
2. Mandatory before/after middleware for tool calls and handoffs (non-bypassable).
3. Multi-agent orchestration layer with typed delegation contracts and deterministic failure propagation.
4. Extension gateway unifying `SKILL.md`, MCP servers, and Claude plugins under one trust/policy model.
5. Channel gateway with parity adapters for web, Slack, Telegram, and Discord.
6. Automation and heartbeat runtime using the same middleware and contract checks.
7. Chat-first configuration model so operational behavior is managed in typed runtime state.

## Relationship To OpenClaw Review

OpenClaw concepts are being adapted at the product-pattern level, not imported as a runtime core.

See: `docs/architecture/openclaw-concepts-adoption.md`.

## Non-Selected Route

Not selected: direct adoption of `pi-coding-agent` runtime as Polar's core runtime.

Reason: it would require substantial internal rewiring to satisfy Polar's strict middleware and contract guarantees, while still not natively covering Polar's MCP/sub-agent/plugin scope.