# Platform Build Documentation

## Stage 2: Skills, Installers, and Permissioned Extensibility

### Purpose of this stage

Stage 2 introduces **controlled extensibility**.

At the end of this stage, the platform supports:

* Installing skills safely
* Declaring and enforcing permissions per skill
* Surfacing permission diffs and consent in UI
* Running skills as constrained worker templates

This is where the system becomes *useful* while remaining **hostile by default**.

---

## Stage 2 Goals (explicit)

By completion of Stage 2, the system must:

1. Support **local skill installation**

   * No remote registry yet
   * No auto-updates
   * Everything explicit and inspectable

2. Treat skills as **permission-bound units**

   * Skills declare what they want
   * Runtime decides what they get
   * Gateway enforces the result

3. Make permission changes **visible and auditable**

   * Clear diffs on install and upgrade
   * User can revoke at any time
   * Revocation invalidates capabilities

4. Preserve all Stage 1 invariants

   * No new bypass paths
   * No new trust in LLMs
   * No policy logic in gateway or skills

---

## Stage 2 Deliverables

### Required artefacts

* `docs/skills-model.md`
* `docs/installer-design.md`
* `docs/permissions-ui.md`
* `docs/stage-2-complete.md`

---

## Stage 2 Work Breakdown

---

### 1. Define the Skills Model (spec before code)

**File:** `docs/skills-model.md`

This document defines what a “skill” *is* in your system.

#### A skill is:

* A **package of worker templates**
* With a **manifest**
* That declares **required capabilities**
* And optional **UI affordances**

#### A skill is NOT:

* A long-running agent
* A holder of credentials
* A policy decision-maker
* A free-form code execution environment

---

### 2. Skill Manifest (authoritative contract)

**File:** `docs/skills-model.md`

Define a strict manifest schema.

#### Required fields

* `id`
* `name`
* `version`
* `description`
* `workerTemplates`
* `requestedCapabilities`

#### Capability declarations must include:

* connector (fs, http, calendar, etc)
* action (read, write, delete)
* resource constraints (paths, domains, IDs)
* optional field constraints
* justification (human-readable)

Example (conceptual, not code):

* “Read-only access to `/projects/foo/**` to summarise files”

#### Rules

* No wildcards without explicit justification
* No implicit permissions
* Version bumps that increase permissions require re-consent

**Acceptance criteria**

* Manifest can be validated without executing skill code
* Permissions UI can be generated from manifest alone

---

### 3. Skill Installer (quarantined worker)

**File:** `docs/installer-design.md`

The installer is a **dedicated worker**, not part of the runtime core.

#### Installer properties

* Runs in a tight sandbox
* No network by default
* No credentials
* Limited filesystem access to:

  * incoming skill bundle
  * skills directory
  * temp workspace

#### Installer responsibilities

* Validate manifest schema
* Reject unknown or malformed fields
* Ensure requested capabilities are expressible in policy model
* Register skill metadata with runtime

#### Explicit non-responsibilities

* Installer does NOT grant permissions
* Installer does NOT test skills against real connectors
* Installer does NOT auto-fetch dependencies

**Acceptance criteria**

* A malformed skill cannot be installed
* A skill requesting impossible permissions is rejected
* Installer cannot access secrets or tools

---

### 4. Permission Grant Flow (runtime-owned)

This is the most important part of Stage 2.

#### Flow

1. Skill is installed (metadata only)
2. Runtime computes requested permissions
3. User is shown:

   * requested vs existing permissions
   * human-readable explanations
4. User explicitly grants or denies
5. Runtime stores grants
6. Capability minting is now possible for that skill

#### Key rules

* No auto-grant
* No inherited permissions
* No silent escalation

#### Revocation semantics (implementable)

* “Immediate revocation” means: tool calls are denied as soon as the gateway sees a revoked token/subject/policy version.
* Recommended default: gateway validates signature **and** consults a runtime introspection endpoint (with short caching) for:

  * token `jti` revoked
  * subject/skill disabled
  * grant or policy version bumped
  * signing key (`kid`) rotated
* Optional alternative: very short TTL + refresh (revocation effective within TTL, not immediate).

**Acceptance criteria**

* A skill can exist installed but unusable
* Denying permissions does not uninstall the skill
* Revoking permissions immediately invalidates future tool calls

---

### 5. Worker templates per skill

Skills do not run arbitrary agents. They expose **worker templates**.

#### Worker template definition

* name
* description
* input schema
* output schema
* required capabilities (subset of skill’s grants)

#### Runtime enforcement

* When spawning a worker:

  * runtime checks template belongs to skill
  * runtime checks requested caps ⊆ granted caps
  * runtime mints narrowed capability token

**Acceptance criteria**

* Worker cannot exceed template permissions
* Template permissions cannot exceed skill grants
* Main agent cannot bypass templates

---

### 6. Permissions and Skills UI (expand Stage 1 UI)

**File:** `docs/permissions-ui.md`

Extend the UI with:

#### Skills page

* List installed skills
* Version
* Status (installed / enabled / disabled)
* Requested permissions
* Granted permissions

#### Permission diff view

* On install
* On upgrade
* On manual edit

#### Controls

* Enable/disable skill
* Revoke permissions
* Uninstall skill

**Acceptance criteria**

* User can answer: “What can this skill do?”
* User can revoke access without restarting system
* Audit shows permission changes as events

---

### 7. Audit extensions for skills

Extend audit model to include:

* skillId
* workerTemplate
* permissionVersion

Audit must record:

* skill installation
* permission grants
* permission revocations
* denied tool calls due to revoked permissions

**Acceptance criteria**

* You can reconstruct the full lifecycle of a skill from audit alone

---

### 8. Hardening tasks (code)

Required checks to add:

* Skill code cannot access runtime internals
* Skills cannot register new tools directly
* Skill worker crashes do not affect runtime
* All skill-originated tool calls go through gateway

Add tests for:

* Permission escalation attempt
* Template mismatch
* Revoked permission enforcement

---

## Stage 2 Exit Checklist

**File:** `docs/stage-2-complete.md`

Example items:

* [ ] Skill manifest schema frozen
* [ ] Installer rejects malformed skills
* [ ] Permission grant flow requires explicit consent
* [ ] Worker templates enforce least privilege
* [ ] UI clearly displays skill permissions
* [ ] Audit records skill lifecycle events
* [ ] No Stage 1 invariant violated

---

## What is explicitly *not* in Stage 2

To keep scope controlled:

* Remote skill registry
* Skill signing and trust chains
* Automatic updates
* External APIs beyond filesystem or HTTP
* Multi-agent coordination logic
* Memory system beyond Stage 1

Those arrive later.

---

## Conceptual outcome of Stage 2

After Stage 2:

* You have a **secure plugin system**
* You can add real functionality safely
* You have laid the groundwork for an ecosystem *without* opening supply-chain holes

This is the stage where your platform diverges sharply from OpenClaw and similar systems in terms of security posture.
