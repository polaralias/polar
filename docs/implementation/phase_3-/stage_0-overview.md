- MCP support through local deployment and remote maintain high security approach - Group chat support (adding orchestrator to group chats) - Logger chat support, an additional chat for logging requests, e.g. querying clickup API, writing clickup description. This is a key value add, but needs a clear and easy way of querying the orchestrator if something isn't working, and stopping actions if identified as problematic (potentially through the group chat support? Or it could be serverside access, the user should be able to say "oh that log entry didnt look right", and the orchestrator should be able to say "this sync failed you can check the log but it said xyz") - Finalise support across channels (slack/whatsapp/telegram - others) - Synced sessions across devices and channels - Finalise integrations for context provisioning (vector db setup for everything in slack, everything in gmail, everything in outlook, availability from calendars/annual leave providers (timetastic or others)) - Finalise off the shelf skills and mcps that are offered. native additions for certain mcp servers, or local cli skills (clickup api vs mcp/github cli vs mcp etc) - Support multiple connections and integrations for a single service (e.g. 2 mcp servers for clickup, one for docs only, one for write to space xyz only, or one notion instance and another) - tool identification must be paramount with suitable intent checking (saying "add this to work notion" fails with current mcp tool find implementations even though the connector is called "work notion")

---

## 1. Your Phase 3 list: alignment and sharp edges

### MCP support (local + remote, high security)

This is absolutely Phase 3, and you’re already set up for it.

Key thing to lock in early:

* **MCP servers are never trusted authorities**, even when remote.
* Treat MCP exactly like any other connector:

  * Gateway enforces capabilities
  * Runtime owns identity, revocation, audit
  * MCP auth is transport only, not permission

One subtle value add here: **MCP connection profiles**.

* Each MCP server instance is its own principal with:

  * name
  * scope label (eg “ClickUp docs only”)
  * explicit capability grants
* This directly supports your later “multiple MCPs for one service” goal.

---

### Group chat support (orchestrator in group chats)

This is a big UX unlock, but also a trust hazard if not framed right.

The rule you already have scales cleanly:

* **Group chat = awareness and intent clarification**
* Never implicit execution from third-party text

Phase 3 scope that works well:

* Orchestrator can:

  * summarise threads
  * surface action candidates
  * ask the user for confirmation in-DM or control UI
* Orchestrator cannot:

  * act purely because “someone in the group said so”

This pairs extremely well with your later “logger chat”.

---

### Logger chat (this is a very strong differentiator)

This is one of the best ideas in your list, and it fits Polar’s inspectability story perfectly.

Think of it as:

* A **human-readable projection of the audit log**
* With conversational affordances

Key properties:

* Every non-trivial action emits a log event summarised into the logger chat
* Log entries have:

  * correlation ID
  * “what I tried to do”
  * “what happened”
  * link to full audit record

Critical capability:

* User can say things like:

  * “That didn’t look right”
  * “Stop doing this”
  * “Why did this fail?”

Which maps cleanly to:

* revoke capability
* disable skill
* inspect audit
* explain failure using stored error context

This is where **Phase 1 audit work really pays off**.

---

### Finalise channels (Slack, WhatsApp, Telegram)

Correctly Phase 3, but I’d constrain scope:

* Channels are **thin adapters**
* No logic, no memory, no policy
* Pairing, allowlists, identity binding only

Value add here:

* Make channel adapters *boringly consistent*
* Same affordances everywhere:

  * reply
  * approve
  * deny
  * “open in control UI”

---

### Synced sessions across devices and channels

This is harder than it sounds, but worth it.

Important distinction:

* **Conversation ≠ session**
* Session is a runtime concept, not a channel one

Phase 3-appropriate version:

* One “active session” per user
* Channels attach to it
* Logger chat is session-global

You do *not* need full CRDT or offline merge yet.

---

### Context provisioning (Slack, Gmail, Outlook, calendars)

This is where Phase 3 can explode if you’re not careful.

I’d recommend a strong constraint:

* Phase 3 = **read-only context ingestion**
* No automatic writes or side effects

Also:

* Don’t aim for “everything indexed”
* Aim for:

  * recent
  * relevant
  * scoped
  * explainable

Calendar and availability are especially valuable early because they’re low ambiguity and high leverage.

---

### Off-the-shelf skills and MCPs

Good, but treat this as **curation**, not coverage.

Phase 3 goal:

* A small, opinionated set of first-party skills:

  * ClickUp
  * Slack
  * Gmail
  * Calendar
* Each demonstrates:

  * capability scoping
  * field filtering
  * good logging
  * clean failure modes

CLI wrappers are fine where necessary, but your instinct to prefer typed APIs is right.

---

### Multiple connections per service + tool identification

This is *exactly* the right time to fix this.

Current MCP tool selection failures are a known sharp edge across the ecosystem.

Phase 3 solution pattern:

* Tools must have:

  * **stable internal IDs**
  * human labels
  * semantic tags (eg `work`, `personal`, `docs-only`)
* Intent resolution should:

  * fail explicitly if ambiguous
  * ask a clarifying question rather than guessing

This also ties back to logger chat:

* “I didn’t know which Notion you meant”

That’s a feature, not a bug.

---

## 2. Things I’d add as Phase 3 value adds

These aren’t in your list, but they fit naturally and pay off quickly.

### A. “Explain why I can’t do this”

You already have the data:

* policy
* capability
* audit
* error codes

Expose it conversationally:

* “I can’t do that because this skill only has read access”
* “This integration is paused”
* “That action is blocked by emergency mode”

This massively improves trust.

---

### B. Soft-pause and scoped disable

Instead of binary revoke:

* pause a skill
* pause a specific integration instance
* pause writes but allow reads

This pairs perfectly with logger chat and group chat interventions.

---

### C. Intent dry-run mode

Before execution:

* “Here’s what I would do”
* “Here are the tools I would call”

This is a great bridge between:

* logger chat
* low-friction approvals
* group contexts

---

## 3. How I’d frame Phase 3 overall

If Phase 1 was:

> “Make it impossible for the assistant to misbehave silently”

Then Phase 3 should be framed as:

> **“Make the assistant observable, interruptible, and usable in real conversations”**

Core Phase 3 pillars:

1. Multi-channel presence (DMs, groups, logger)
2. Strong observability (logs as chat, not files)
3. Clear intent resolution across multiple tools and accounts
4. Safe, explainable context ingestion
5. No new trust assumptions beyond Phase 1

---

## 4. Phase 2 Deferrals (Now Front-Loaded for Phase 3)

These items were identified as missing or deferred during the Phase 2 Gap Analysis and are now primary objectives for Phase 3:

### Real OAuth Connector Implementations (Gmail)
* **Goal**: Move from mock `google.mail` to authentic OAuth2 flows.
* **Scope**:
    * Implement OAuth2 Authorization Code flow in the Gateway.
    * Secure storage of Refresh Tokens in the Runtime.
    * Per-user consent screens and scope management.
    * Proactive token refresh handling.

### Home Assistant Integration
* **Goal**: Expand Polar's reach into the physical environment.
* **Scope**:
    * Develop a new generic "IoT/WebHook" connector pattern.
    * Implement HA-specific skill for light, thermostat, and scene control.
    * Demonstrate secure local-network communication.

### Skill Packs & Experts
* **Goal**: Productize sets of related skills.
* **Scope**:
    * concept of "Expert Bundles" (e.g., "The Executive Assistant", "The DevOps Engineer").
    * UI for discovering and batch-installing related skills.
    * Shared context/memory across a bundle.

### Enhanced Permission Diff UI
* **Goal**: Close the loop on "Safe Updates".
* **Scope**:
    * Create the frontend UI for the `calculatePermissionDiff` backend.
    * Explicitly highlight new capabilities or modified resource paths during skill upgrades.
    * "Approval Gate" for version bumps that increase privilege.
