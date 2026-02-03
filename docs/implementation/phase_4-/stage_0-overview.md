## Phase 4 headline

**Trusted autonomy, automation envelopes, and long-term reliability.**

Or more bluntly:

> “Polar can do things without you watching, and you’re still comfortable with that.”

---

## 1. Automation envelopes (this is the core of Phase 4)

You already sketched the proactivity tiers. Phase 4 is where **Tier 3 becomes real**.

Key idea:

* Actions only run inside **explicit, inspectable envelopes**
* Nothing “emerges” implicitly from prompts or conversations

An automation envelope defines:

* Trigger(s)
* Allowed tools and capability subsets
* Allowed targets (projects, spaces, calendars, repos)
* Time bounds
* Rate limits
* Escalation and halt conditions

Examples:

* “Keep ClickUp statuses in sync with Slack reactions for project X”
* “Every weekday morning, summarise overnight emails from these senders”
* “Auto-file GitHub issues that match this pattern into backlog Y”

Crucially:

* Envelopes are **first-class objects**
* They can be paused, edited, revoked, and audited
* They never grant new authority beyond what the user already approved

---

## 2. Reliability and self-healing (quiet but critical)

Phase 4 is where Polar needs to stop feeling brittle.

This is not about cleverness, it’s about *boring resilience*.

Things that belong here:

* Retry strategies with backoff and caps
* Partial failure handling (some tools succeed, others fail)
* State reconciliation (“this sync failed last time, here’s why”)
* Drift detection for automations (“this envelope hasn’t run cleanly in 7 days”)

This ties directly into:

* Logger chat
* Audit trails
* “Explain what went wrong” capabilities

---

## 3. Long-term memory with decay and intent

Phase 3 ingests context.
Phase 4 decides **what stays relevant over months**.

Important distinction:

* Memory is not just storage, it’s **policy-governed retention**

Phase 4 additions:

* Memory expiry and decay rules
* Promotion and demotion (ephemeral → project → profile)
* “This used to be true, but probably isn’t anymore” handling
* User-visible memory inspection and pruning

This avoids the classic assistant failure mode of being confidently wrong six months later.

---

## 4. Multi-user and delegation (but carefully)

Not “team chatbots everywhere”.

Phase 4-appropriate scope:

* Delegation with explicit bounds:

  * “You can let Polar coordinate with my partner on calendar only”
  * “This automation can act on behalf of this shared workspace”
* Clear ownership:

  * Who approved this
  * Who can revoke it
  * Who gets notified when it runs

Still consistent with your invariant:

* Polar never speaks for a user without their words, unless inside a declared envelope.

---

## 5. Ecosystem hardening and trust signals

This is where Polar becomes safe to extend.

Phase 4 concerns:

* Skill and MCP signing
* Provenance metadata surfaced to the user
* Safe update flows with permission diffs
* Emergency stop that truly halts everything

You already laid the groundwork in Phase 1. Phase 4 is making it *visible and user-comprehensible*.

---

## 6. What Phase 4 explicitly is *not*

To keep scope clean:

* Not “AGI planner mode”
* Not unsupervised goal generation
* Not blanket background automation
* Not social delegation without consent

Phase 4 autonomy is **bounded, revocable, explainable autonomy**.