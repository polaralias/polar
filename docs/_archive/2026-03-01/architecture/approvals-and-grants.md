# Approvals And Grants

Last updated: 2026-02-28

## Purpose
This document defines Polar’s approval model so the platform is usable (no “approve every lookup”) while remaining safe and auditable.

Key idea: **capability risk is declared by tools (via MCP metadata) and enforced in code**. Users approve meaningful plans and side effects, not every tool call.

This document is an addendum to:
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/architecture/chat-routing-and-multi-agent.md`

---

## Non-negotiable principles

1) **Risk metadata must exist**
Every callable tool/capability must have risk metadata:
- `riskLevel`: `read | write | destructive`
- `sideEffects`: `none | internal | external`
- optional: `dataEgress`: `none | network` (eg HTTP upload/post tools)

If metadata is missing at install-time, the skill must be **blocked** until the missing risk is defined per-capability (see Skill Install flow).

2) **Code decides**
The model may propose a plan, but the platform decides:
- which steps can run
- whether approval is required
- which approvals/grants apply
- what to log and show the user

3) **Approvals are scoped**
Approvals are not “approve this one tool call”.
Approvals grant scoped permission for a class of actions, for a target, for a time window.

---

## Risk tiers

### Read
Examples:
- search, lookup, list, fetch, describe
Default behaviour:
- auto-approved
- logged

### Write (internal)
Examples:
- draft an email (not send)
- write a note to an internal scratch space
- generate a file inside a sandbox
Default behaviour:
- auto-approved (configurable)
- logged

### Write (external)
Examples:
- send email
- post to Slack/Teams
- create calendar event
Default behaviour:
- requires approval grant unless an existing grant covers it

### Destructive
Examples:
- delete records
- revoke access
- irreversible changes
Default behaviour:
- requires explicit approval every time (no reusable grants by default)

### Data egress (special case)
Examples:
- HTTP POST/upload tools
Default behaviour:
- explicit approval per action unless a destination allowlist is granted and policy allows it

---

## Approval grants

### ApprovalGrant object
A grant is created when the user approves a plan or action.

Minimum fields:
- `grantId`
- `principal`: `{ userId, sessionId?, workspaceId? }`
- `scope`:
  - `capabilities`: explicit list of `{ extensionId, capabilityId }` (or template id)
  - `targets`: optional, channel/tool specific (eg mailbox, calendar, project)
  - `constraints`: optional (eg domains allowlist, max items)
- `riskLevel`: `write | destructive`
- `ttlSeconds` and `expiresAt`
- `createdAt`, `reason`
- `audit`: correlation ids for workflow/run

Grants are server-owned and stored in an ApprovalStore (in-memory initially, persistent later).

### Matching rules
A tool execution is allowed if:
- the capability is allowed by policy, AND
- either:
  - risk is `read` or `write_internal` and policy says auto-allow, OR
  - there is a matching, unexpired ApprovalGrant, OR
  - the user is currently approving this workflow/action

Grants should be as narrow as practical:
- prefer target-scoped over global (eg “send email from this account”)
- prefer TTL (eg 24 hours) over indefinite

---

## Workflow approval behaviour

### Distinguish “auto-run” vs “plan approval”
A workflow can run without user interruption when:
- all steps are `read` or auto-allowed `write_internal`, AND
- no step triggers `external` side effects or data egress, AND
- policy does not require approval for the template

A workflow requires plan approval when:
- it includes any `write_external` step not covered by an existing grant, OR
- it includes any `destructive` step, OR
- it includes data egress, OR
- it involves delegation/multi-agent fan-out, OR
- policy flags the template as “approval required”

### What the user sees on plan approval
Plan card must show:
- high-level steps
- what will be written/changed (targets and side effects)
- any data egress destinations
- which grants will be created (scope + TTL)
- “Approve” and “Reject” actions

After approval:
- grants are issued (if needed)
- the workflow executes without asking again for each step

---

## Email example (good UX)
- `email.draft` is `write_internal` → auto-run
- `email.send` is `write_external` → requires approval

Flow:
1) Generate draft (auto)
2) Show draft
3) Ask “Send?” (approval) only if user chooses to send

---

## Enforcement points (code)
Enforcement must occur at execution time:
- in `extensionGateway.policy.evaluateExecution(...)`
- using `capabilityScope` + ApprovalStore lookup
- never relying on prompt compliance

---

## Acceptance criteria
- Read tools do not require approval.
- Write-external actions require approval unless a matching grant exists.
- Destructive actions require explicit approval each time by default.
- Missing risk metadata blocks skill install until resolved.
- User sees approvals for plans (multi-step), not single read calls.
