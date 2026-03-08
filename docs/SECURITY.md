# Security and safety

Polar’s differentiator is that safety is enforced in code, not “because the system prompt said so”.

## Non-negotiables
- **Contracts everywhere**: typed input/output validation for tools, handoffs, automations.
- **Middleware is non-bypassable**: every call (tool, provider, handoff, automation run) has before/after middleware.
- **Code decides**: routing, permissions, workflow execution, and state transitions are deterministic.
- **Least privilege**: tools and connectors are enabled by capability, not by default.
- **Audit by default**: tool calls, approvals, denials, and automation runs are logged.

## Threat model (practical)
- Prompt injection attempting to exfiltrate secrets or trigger forbidden tool calls.
- Tool misuse (calling destructive actions, reading sensitive data, acting outside scope).
- Automation abuse (spammy proactive messages, over-frequent checks, connector overreach).
- Data leakage (storing sensitive content as “memory” without consent or purpose).

## Policy design
### Capability allowlists
- Every tool belongs to a capability.
- Agents/workflows/jobs declare required capabilities.
- Middleware enforces that only those capabilities are callable.

### Approvals and sensitive operations
- Approval policy is mode-based and enforced in the orchestrator, not delegated to surfaces.
- Destructive workflows always require `dry_run_then_approve`: the dry run preview is shown first, and live execution must be explicitly approved against the same workflow inputs.
- Bulk external writes require the same dry-run approval path when either:
  - a capability is explicitly marked bulk, or
  - the orchestrator infers a bulk write from the planned target count (default threshold: 50).
- Standard non-bulk external writes may auto-start, but only with:
  - a code-bound reject/cancel path,
  - transient run-scoped grants,
  - audit events for start, denial, cancellation, and outcome.
- Approval must be recorded and bound to the request context.

### Budgets and rate limits
- Apply budgets at the provider gateway.
- Apply rate limits at:
  - tool calls
  - automation frequency
  - proactive delivery (notifications/day)

## Data handling
- Store facts that are needed for continuity, not raw logs by default.
- Separate **memory** (facts/summaries) from **events** (reactions, approvals, run outcomes).
- Provide deletion and scoping hooks (per workspace / per user).

## Automations
Automations must go through the exact same pipeline as interactive chat:
- same middleware
- same capability restrictions
- same dry-run / approval policy for destructive or bulk workflows
- same audit

Automation proposals may be auto-created when policy allows, but they must remain immediately rejectable in-thread and rejection must preserve audit history.

Proactive messaging should be:
- user-created (opt-in)
- rate-limited
- quiet-hours aware

## Failure handling
- Tool failures such as `ToolUnavailable` and `InternalContractBug` must degrade gracefully (no crashes, no repeated retries) while returning a deterministic warning payload, and every occurrence must be logged through the audit sink so operators can trace the event without losing lane context.
- Normalization must include capturing the request trace id, threadKey/lane, and failure type so post-mortem dashboards can correlate user-visible degradations with tool stability metrics.

## What is not acceptable
- “We’re safe because the model will follow instructions.”
- Any alternate execution path that bypasses the middleware chain.


## Related specs
- Control-plane allowlists: `docs/specs/CONTROL_PLANE_API.md`
- Web UI safety: `docs/specs/WEB_UI_SURFACE.md`
- Automations runner safety: `docs/specs/AUTOMATION_RUNNER.md`
