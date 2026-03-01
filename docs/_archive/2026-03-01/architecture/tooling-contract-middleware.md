# Tooling Contract Middleware

Last updated: 2026-02-22

## Core Rule

There is no direct tool call, no direct handoff, and no direct automation step.

Every execution path is wrapped by both before and after middleware.

## Covered Execution Types

1. Tool calls.
2. Agent handoffs.
3. Automation steps.
4. Heartbeat ticks.
5. Extension lifecycle actions (install/upgrade/remove/enable/disable).

## Tool Call Pipeline

1. Before middleware:
   - identity and session validation
   - capability and policy check
   - trust level check (`native`, `skill`, `MCP`, `plugin`)
   - input schema validation and normalization
   - rate/idempotency checks
2. Execution:
   - run tool with scoped credentials and explicit timeout budget
3. After middleware:
   - output schema validation
   - output sanitization and redaction
   - deterministic error mapping
   - audit emission with contract metadata

## Agent Handoff Pipeline

1. Before middleware:
   - handoff permission check
   - target agent availability check
   - handoff input schema validation
   - scope and budget constraints check
2. Execution:
   - delegated agent run under scoped capabilities
3. After middleware:
   - handoff output schema validation
   - response normalization for upstream agent
   - audit and lineage update

## Automation And Heartbeat Pipeline

1. Before middleware:
   - trigger validation (schedule/event/manual)
   - policy checks (active hours, approvals, budget, queue state)
   - typed run-plan validation
2. Execution:
   - run with resolved profile, model lane, and scoped capabilities
3. After middleware:
   - typed outcome validation
   - retry/dead-letter eligibility mapping
   - task board and audit updates

## Contract Registry

All callable operations are registered with:

1. Stable action id.
2. Versioned input schema.
3. Versioned output schema.
4. Trust class and risk class.
5. Default timeout and retry policy.

If a callable operation is not registered, it cannot run.

## Strictness Levels

1. `observe`: validate and log violations without blocking (development only).
2. `enforce`: block invalid inputs and outputs.
3. `hardened`: enforce plus deny unknown fields and unknown actions.

Production target is `hardened`.

## Determinism Guarantees

1. No untyped input enters a tool, sub-agent, automation step, or heartbeat run.
2. No untyped output reaches an upstream agent or end user.
3. Every rejection is explicit, typed, and auditable.
4. Every middleware decision is represented in trace logs.
5. Extension-provided capabilities cannot bypass middleware.

## Integration Notes

1. Polar enforces middleware at Polar gateway boundaries, not only inside wrapped frameworks.
2. Wrapped framework validation is necessary but not sufficient.
3. Polar adds mandatory output validation for every tool and handoff payload.
4. Polar does not allow runtime modes where validation is bypassed.