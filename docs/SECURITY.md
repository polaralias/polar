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
- Sensitive tools (email body reads, calendar writes, payments, admin actions) require explicit approval.
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
- same approvals
- same audit

Proactive messaging should be:
- user-created (opt-in)
- rate-limited
- quiet-hours aware

## What is not acceptable
- “We’re safe because the model will follow instructions.”
- Any alternate execution path that bypasses the middleware chain.


## Related specs
- Control-plane allowlists: `docs/specs/CONTROL_PLANE_API.md`
- Web UI safety: `docs/specs/WEB_UI_SURFACE.md`
- Automations runner safety: `docs/specs/AUTOMATION_RUNNER.md`
