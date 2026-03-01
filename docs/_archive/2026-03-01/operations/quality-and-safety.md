# Quality And Safety Gates

Last updated: 2026-02-22

## Release Gates

A release is promotable only when all of these hold:

1. Contract coverage is 100% for active tools, handoff envelopes, automation steps, and heartbeat runs.
2. Before/after middleware is active for all execution paths.
3. Strict validation mode is enabled in non-development environments.
4. No known bypass path exists for skills, MCP, or plugins.
5. Critical end-to-end tests pass for all supported channel endpoints.
6. Model policy fallback and cooldown tests pass with deterministic reason codes.
7. Automation and heartbeat budget guardrails are active and tested.
8. Extension provenance and permission-delta checks are enforced.
9. UI-affecting changes include dev-only DevTools verification (manual evidence before PR-21/22; CI harness suite pass after PR-21/22).
10. Dev-only harness integrations are blocked from end-user runtime extension and profile surfaces.

## Required Test Categories

1. Contract tests:
   - input and output validation for every callable operation
2. Middleware tests:
   - before and after middleware invocation guarantees across tool, handoff, automation, and heartbeat paths
3. Endpoint parity tests:
   - same behavior across web, Telegram, Slack, and Discord adapters
4. Multi-agent tests:
   - handoff validation, fan-out/fan-in determinism, error propagation
5. Automation tests:
   - schedule correctness, proactive triggers, heartbeat gating, retry and dead-letter behavior
6. Model policy tests:
   - local-lane routing, escalation rules, provider/profile/model fallback, cooldown handling
7. Memory tests:
   - recall scope enforcement, degraded memory provider behavior, compaction pre-flush behavior
8. Extension tests:
   - skill install/upgrade/remove, MCP connection lifecycle, plugin execution safety
9. Harness and eval tests:
   - deterministic scenario replay and escaped-defect regression coverage when replay tooling is available
   - dev-only browser automation checks for UI-affecting behavior (manual or automated depending on harness maturity)

## Security Baselines

1. Secrets are never committed to source control.
2. Extension credentials are encrypted at rest.
3. Trust level and policy checks run before each external call.
4. Session and user identity mapping is explicit and auditable.
5. High-risk operations support approval checkpoints.
6. File-based interoperability artifacts cannot override typed policy state.
7. Dev-only harness credentials and endpoints are isolated from production runtime credentials.
8. Dev-only harness tooling cannot execute production side effects.

## Operational Observability

Minimum telemetry for each run:

1. Correlation id from inbound message to final response.
2. Handoff chain with agent ids and durations.
3. Tool-call registry id, contract version, and validation result.
4. Policy decisions and denial reasons.
5. Automation trigger source and run outcome.
6. Model lane selection, fallback attempts, and terminal reason.
7. Token/cost usage by run and by policy scope.
