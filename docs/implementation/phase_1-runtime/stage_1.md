# Platform Build Documentation

## Stage 1: Secure Runtime Foundation (Post–Sprint 1 → “Kernel Complete”)

### Purpose of this stage

Stage 1 turns the Sprint 1 MVP into a **stable, opinionated kernel** that everything else depends on.

At the end of Stage 1, the platform must be:

* Secure by construction
* Deterministic and auditable
* Internally coherent enough that *new features cannot bypass policy*

No new “cool” capabilities are added here. This stage is about **hardening, formalising, and freezing interfaces**.

---

## Stage 1 Goals (explicit)

By completion of Stage 1, the system must satisfy:

1. Runtime is the **only authority**

   * Only runtime can spawn workers
   * Only runtime can mint capability tokens
   * Only runtime can write memory or audit logs

2. Gateway is **pure enforcement**

   * No policy decisions
   * No credential exposure
   * Deterministic allow/deny behaviour

3. Internal contracts are **stable**

   * Worker spawn contract frozen
   * Capability schema frozen
   * Audit schema frozen

4. System can be reasoned about *without reading code*

   * Threat model exists
   * Policy model exists
   * Invariants are documented and enforced by tests

---

## Stage 1 Deliverables

### Required artefacts

* `docs/threat-model.md`
* `docs/architecture.md`
* `docs/policy-model.md`
* `docs/internal-apis.md`
* `docs/stage-1-complete.md` (exit checklist)

These are **not optional**.
They are part of the product.

---

## Stage 1 Work Breakdown

### 1. Formalise system invariants (must be written first)

**File:** `docs/architecture.md`

Document, explicitly and unambiguously:

#### Required invariants

* Agents (LLMs) are untrusted
* Runtime is trusted
* Gateway is trusted but dumb
* Credentials never leave runtime
* Capability tokens are required for *every* side-effect
* Reads are as sensitive as writes
* Audit log is append-only and user-visible

#### Explicit non-goals

* No autonomous agents
* No “self-modifying” skills
* No hidden memory writes
* No implicit permissions

**Acceptance criteria**

* A reader can identify every trust boundary without reading code
* A new contributor can tell where policy must live and where it must not

---

### 2. Freeze the internal API contracts

**File:** `docs/internal-apis.md`

This document defines the *only* legal interactions between components.

#### Runtime APIs (authoritative)

Document:

* session lifecycle
* message ingestion
* worker spawning
* capability minting
* memory proposal handling
* audit append

For each API:

* Inputs
* Outputs
* Error cases
* Security guarantees

Example (conceptual):

* Runtime may reject worker spawn requests even if requested by main agent
* Runtime may narrow requested capabilities
* Runtime never escalates permissions

**Acceptance criteria**

* Gateway and UI can be reimplemented without changing this document
* Contracts are language-agnostic

---

### 3. Harden the policy engine

**File:** `docs/policy-model.md`

Describe policy in human terms, not code.

#### Required concepts

* Subject (user, session, skill, worker)
* Action (read, write, delete, spawn)
* Resource (connector-specific)
* Constraints (fields, paths, IDs, domains)
* TTL / temporal scope

#### Rules

* Deny by default
* Grants are explicit and narrow
* Runtime always computes the *intersection* of requested and granted scope

#### Explicitly forbidden

* Wildcard grants without user acknowledgement
* Implicit inheritance between skills
* Policy decisions in agents or gateway

**Acceptance criteria**

* A permission UI can be built purely from this document
* “Why was this allowed?” can be answered using policy + audit alone

---

### 4. Threat model (non-negotiable)

**File:** `docs/threat-model.md`

This is not theoretical. It must cover:

#### Threat actors

* Malicious prompt injection
* Malicious skill author
* Compromised LLM output
* Curious-but-honest user
* Accidental misconfiguration

#### Threat surfaces

* Worker spawning
* Tool calls
* Memory writes
* Skill installation
* UI actions
* Network egress

#### Mitigations

Map each threat to:

* Invariant
* Enforcement point (runtime, gateway, UI)
* Audit evidence

**Acceptance criteria**

* Every external side-effect has a listed mitigation
* There is no “we trust the model” anywhere

---

### 5. Runtime hardening tasks (code)

This is where Sprint 1 code is *tightened*, not expanded.

#### Required changes

* Assert runtime-only access to:

  * capability minting
  * worker spawning
* Remove any bypass paths
* Add runtime-side validation for:

  * malformed capability requests
  * expired or replayed tokens
* Enforce TTL everywhere

#### Required tests

* Attempt to mint capability from outside runtime fails
* Attempt to call gateway without token fails
* Attempt to reuse expired token fails
* Attempt to exceed granted scope fails

**Acceptance criteria**

* All enforcement points fail closed
* Tests prove failures are deterministic

---

### 6. Audit log guarantees

**File:** `docs/architecture.md` (audit section)
**Code:** runtime audit service

Document and enforce:

* Audit is append-only
* Audit entries are immutable
* Audit includes:

  * who
  * what
  * resource
  * decision
  * capability id
  * parent cause (session/message)

**Acceptance criteria**

* Every gateway call produces exactly one audit entry
* Denied actions are logged as first-class events
* UI can reconstruct “what happened” from audit alone

---

### 7. Stage 1 exit checklist

**File:** `docs/stage-1-complete.md`

This is a literal checklist your agent must satisfy before moving on.

Example items:

* [ ] Runtime cannot be bypassed for worker spawning
* [ ] Gateway has zero policy logic
* [ ] Capability tokens are mandatory everywhere
* [ ] Policy model documented and implemented
* [ ] Threat model written and reviewed
* [ ] Audit UI shows allowed and denied actions
* [ ] No TODOs related to security invariants

No Stage 2 work begins until this file is complete.

---

## What is explicitly *not* in Stage 1

To keep the agent focused, this stage excludes:

* Multi-agent coordination logic
* Skill registry or remote installs
* External APIs (Calendar, GitHub, etc)
* LangGraph, AgentSDK, A2A
* Media, browser, canvas
* Cloud deployment

Those are **Stage 2+ concerns**.

---

## How your coding agent should use this document

1. Treat this as **authoritative**
2. Implement documentation and code together
3. Do not advance stages until all acceptance criteria are met
4. When uncertain, prefer **less capability, more denial**