# Dynamic And Proactive Automations

Last updated: 2026-02-22

## Product Intent

Automations are first-class workflows configured in natural language and executed through the same policy, contract, and audit system as interactive chat.

## Automation Classes

1. Scheduled and event-driven automations.
2. Heartbeat automations (periodic assistant checks).
3. Proactive runs initiated by triggers without a direct message.

## Chat-First Automation Setup

Users create or modify automations directly in chat.

Setup flow:

1. User describes an outcome and timing.
2. Runtime converts intent into a structured automation draft.
3. Input contract validates schedule, scope, model lane, and actions.
4. User confirms or edits the draft.
5. Automation policy is persisted and activated.

## Heartbeat Policy

Heartbeat is configured as structured policy, not markdown file state.

Policy fields include:

1. Cadence and active-hour windows.
2. Run scope (agent/profile/session).
3. Delivery visibility rules (`OK`, alerts, indicators).
4. Model lane defaults (`local` by default for routine checks).
5. Queue/backpressure skip rules.
6. Cost and approval constraints.

Optional markdown import/export is supported for interoperability, but canonical state remains typed runtime policy.

## Proactive Automations

Polar can initiate tasks when a trigger fires.

Supported trigger classes:

1. Time-based schedules.
2. External event triggers.
3. State and threshold triggers.
4. Heartbeat cadence triggers.

Proactive runs always include:

1. Declared execution reason.
2. Bound agent profile and capability scope.
3. Full tool-call and handoff middleware.
4. Typed result output and run summary.
5. Usage and cost telemetry.

## Safety And Governance

1. Automations run with least privilege.
2. High-risk actions require explicit approval policies.
3. Each run is idempotent by run id.
4. Retries and dead-letter handling are deterministic.
5. Failed automations do not silently self-heal without traceable events.
6. Heartbeat routines can be auto-paused when no active checks are configured.

## Management Requirements

1. Pause and resume automation.
2. Manual run and dry-run simulation.
3. Version history and rollback.
4. Run logs, artifacts, and error diagnostics.
5. Linked task board updates for each automation run.