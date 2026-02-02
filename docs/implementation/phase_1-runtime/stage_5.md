# Platform Build Documentation

## Stage 5: Control Plane Maturity (UI, Onboarding, Channels)

### Purpose of this stage

Stage 5 turns the secure platform into something humans can **understand, configure, and trust**.

At the end of this stage, the platform supports:

* A complete local and hosted control plane
* Clear onboarding and diagnostics
* Safe inbound communication channels
* First-class visibility into permissions, agents, memory, and activity

This stage is about **operational clarity**, not new agent intelligence.

---

## Stage 5 Goals (explicit)

By completion of Stage 5, the system must:

1. Be **self-explanatory to a user**

   * What it can do
   * What it is currently doing
   * What it is allowed to do

2. Support **safe inbound interaction**

   * No open inbound message surfaces
   * Explicit pairing and allowlisting

3. Detect and surface **misconfiguration**

   * Before it causes security issues
   * With actionable remediation steps

4. Preserve all prior stage invariants

   * UI never bypasses runtime
   * UI never mutates state without audit

---

## Stage 5 Deliverables

### Required artefacts

* `docs/control-plane.md`
* `docs/onboarding.md`
* `docs/channels-model.md`
* `docs/doctor.md`
* `docs/stage-5-complete.md`

---

## Stage 5 Work Breakdown

---

### 1. Control Plane Architecture (spec first)

**File:** `docs/control-plane.md`

Document the control plane as a **read-write client of the runtime**, not a privileged subsystem.

#### Control plane principles

* UI talks only to runtime APIs
* No direct access to gateway or secrets
* All mutations are audited
* All state displayed is derivable from runtime state

#### Required sections

* UI → runtime trust model
* Authentication assumptions (local vs hosted)
* Multi-user considerations (even if single-user initially)

**Acceptance criteria**

* UI can be fully replaced without changing runtime logic
* No “magic” UI-only behaviour exists

---

### 2. Onboarding flow

**File:** `docs/onboarding.md`

Onboarding must make unsafe states difficult.

#### Required onboarding steps

1. Generate runtime identity and signing keys
2. Initialise encrypted storage
3. Create initial user and session
4. Set default deny-all policy
5. Verify gateway connectivity
6. Confirm audit logging active

This should exist as:

* CLI (`init`)
* UI wizard (same steps, same API calls)

#### Explicit rules

* System must not start in a permissive state
* Skipping steps requires explicit acknowledgement

#### Idempotence semantics

* Re-running onboarding reuses existing keys/identity by default.
* Destructive actions require explicit flags or UI confirmation:

  * `--rotate-keys` to replace signing keys
  * `--new-session` to create a new initial session
* UI wizard mirrors the same logic and shows current state before changes.

**Acceptance criteria**

* Fresh install cannot execute tools until onboarding completes
* Onboarding is idempotent

---

### 3. Doctor / diagnostics subsystem

**File:** `docs/doctor.md`

The doctor is a **security tool**, not a convenience feature.

#### Required checks

* Policy integrity (deny-by-default still intact)
* Capability signing key validity
* Audit log writable and append-only
* Expired capabilities not being reused
* Gateway enforcement active
* Memory TTL jobs running
* Orphaned agents detected

#### Output requirements

* Clear severity levels
* Exact remediation steps
* Machine-readable output option

**Acceptance criteria**

* Doctor catches misconfigurations introduced manually
* Doctor fails closed in CI or startup if critical issues exist

---

### 4. Channels and inbound message security

**File:** `docs/channels-model.md`

This defines how messages enter the system safely.

#### Channel principles

* Inbound messages are untrusted
* Identity must be established
* No anonymous execution
* Channels do not bypass session model

#### Channel lifecycle

1. Channel configured (Slack, email, webhook, etc)
2. Pairing flow initiated
3. Sender identity verified
4. Sender added to allowlist
5. Messages routed to session

#### Required controls

* Per-channel enable/disable
* Per-sender allowlist
* Rate limits
* Content size limits

**Acceptance criteria**

* Unknown senders cannot trigger actions
* Channels cannot be used to escalate permissions

---

### 5. UI maturity requirements

Extend UI to cover **all governed subsystems**.

#### Required sections

* Overview dashboard (system status)
* Sessions and conversations
* Active and historical agents
* Skills and permissions
* Memory browser
* Audit timeline
* Channels configuration
* Diagnostics status

#### Required behaviours

* Every destructive action requires confirmation
* Every state change is visible in audit
* UI reflects runtime truth, not cached assumptions

**Acceptance criteria**

* User can explain system behaviour using UI alone
* No “hidden” activity exists outside UI visibility

---

### 6. Safety rails in UI

UI must actively prevent dangerous actions.

#### Examples

* Warn on broad permissions
* Highlight long-lived capabilities
* Flag skills with unused permissions
* Show memory growth warnings

These are **advisory**, not enforcement, but must be present.

**Acceptance criteria**

* UI guides users toward least privilege
* Dangerous configurations are visually obvious

---

### 7. Audit extensions for control plane

Audit must include:

* UI-originated actions
* Onboarding steps
* Doctor findings (snapshots)
* Channel pairing events
* Permission edits

**Acceptance criteria**

* Control-plane actions are first-class audit events
* Audit can distinguish user vs system vs agent actions

---

## Stage 5 Exit Checklist

**File:** `docs/stage-5-complete.md`

Example items:

* [ ] Onboarding blocks unsafe startup
* [ ] Doctor detects misconfigurations
* [ ] UI covers all major subsystems
* [ ] Channels require pairing and allowlists
* [ ] UI actions are fully audited
* [ ] No runtime invariants violated

---

## What is explicitly *not* in Stage 5

To keep focus:

* Cloud deployment automation
* External identity providers (SSO)
* Mobile or desktop companion apps
* Marketplace or skill registry

Those arrive next.

---

## Conceptual outcome of Stage 5

After Stage 5:

* The platform is **operable and inspectable**
* Users can trust what they see
* Security is reinforced by UX, not undermined by it

This is the stage where many agent systems fall apart. Yours should get stronger here.
