# Platform Build Documentation

## Stage 7: Ecosystem Hardening (Signing, Updates, Supply Chain)

### Purpose of this stage

Stage 7 ensures the platform remains **safe over time**, not just at first install.

At the end of this stage, the system supports:

* Cryptographically verifiable skills
* Safe updates with permission diffs
* Supply-chain integrity guarantees
* Long-term auditability and recovery

This is the stage that prevents your platform from becoming the next “agent malware ecosystem”.

---

## Stage 7 Goals (explicit)

By completion of Stage 7, the system must:

1. Protect against **malicious or compromised skills**
2. Make **updates explicit, reviewable, and reversible**
3. Preserve **user trust over long runtimes**
4. Close remaining supply-chain attack vectors

No convenience feature in this stage may weaken earlier invariants.

---

## Stage 7 Deliverables

### Required artefacts

* `docs/skill-signing.md`
* `docs/update-model.md`
* `docs/supply-chain-threats.md`
* `docs/recovery-and-revocation.md`
* `docs/stage-7-complete.md`

---

## Stage 7 Work Breakdown

---

### 1. Skill signing and provenance

**File:** `docs/skill-signing.md`

Define how skill authenticity is established.

#### Principles

* Skill identity ≠ author identity
* Trust is local and explicit
* Unsigned does not mean forbidden, but it means **untrusted**

#### Required concepts

* Skill bundle hash
* Optional author signature
* Local trust store
* Trust levels:

  * trusted
  * locally trusted
  * untrusted

#### Runtime rules

* Runtime records:

  * hash
  * signature (if present)
  * trust decision
* Runtime never auto-trusts remote content

**Acceptance criteria**

* A modified skill bundle is detected
* Trust decisions are visible and auditable
* Trust does not imply permission

---

### 2. Update model (skills and core)

**File:** `docs/update-model.md`

Updates must be **explicit state transitions**, not silent replacements.

#### Skill updates

* New version installed alongside old
* Permission diff computed
* User must approve:

  * new permissions
* Old version can be rolled back
* If permissions are unchanged, update is allowed with visible notice (no re-approval).
* If permissions are decreased, update is allowed with notice.
* If permissions are increased or scope broadened, explicit re-consent is required.

#### Core/runtime updates

* Versioned schema migrations
* Capability format backward compatibility rules
* Upgrade requires:

  * audit snapshot
  * rollback plan

**Acceptance criteria**

* Updating a skill never silently increases authority
* Downgrades are possible
* Audit shows update history

---

### 3. Permission diffs as first-class objects

Permission changes must be treated like code changes.

#### Required behaviours

* Diff shows:

  * added capabilities
  * removed capabilities
  * scope widening or narrowing
* Diff is human-readable
* Diff is stored in audit

**Acceptance criteria**

* User can answer “what changed?”
* Permission creep is visible

---

### 4. Supply-chain threat model

**File:** `docs/supply-chain-threats.md`

Explicitly document threats such as:

* Malicious skill author
* Compromised distribution channel
* Dependency substitution
* Time-of-check/time-of-use attacks
* Update rollback attacks

Map each threat to:

* Mitigation
* Detection
* Recovery

**Acceptance criteria**

* No threat is waved away with “we trust X”
* Every mitigation has an enforcement point

---

### 5. Revocation and emergency response

**File:** `docs/recovery-and-revocation.md`

This is critical and often skipped.

#### Required revocation mechanisms

* Skill disable
* Permission revoke
* Capability invalidation
* Agent termination
* Session termination

#### Emergency mode

* Disable all skills
* Freeze tool execution
* Preserve audit and memory
* Allow read-only inspection

**Acceptance criteria**

* A compromised skill can be neutralised immediately
* System can enter a “safe halt” state without data loss

---

### 6. Long-term audit and retention

Audit is now a **compliance artefact**, not just logs.

#### Requirements

* Audit schema versioned
* Export formats defined
* Redaction tooling (user-controlled)
* Retention policies configurable

#### Redaction semantics (non-contradictory with immutability)

* Audit events are never edited or deleted.
* Redaction is expressed as append-only `REDACTION` events referencing prior `event_id`s.
* UI applies view-layer masking based on redaction events.
* Optional: store sensitive payloads separately for true deletion while keeping immutable metadata.

**Acceptance criteria**

* Audit can survive upgrades
* Audit is usable months later

---

### 7. Hardening tasks (final pass)

Add final guards:

* Refuse unsigned updates unless explicitly allowed
* Detect capability token format drift
* Verify installer sandbox integrity
* Lock down any remaining “debug” pathways

Add tests for:

* Tampered skill bundle
* Permission escalation via update
* Rollback correctness
* Emergency mode behaviour

---

## Stage 7 Exit Checklist

**File:** `docs/stage-7-complete.md`

Example items:

* [ ] Skill signing implemented
* [ ] Permission diffs enforced on update
* [ ] Supply-chain threat model complete
* [ ] Emergency revocation works
* [ ] Audit retention documented
* [ ] No silent updates anywhere
* [ ] No Stage 1–6 invariant violated

---

## What is explicitly *not* in Stage 7

Even here, scope is bounded:

* Public marketplace
* Reputation systems
* Automated trust scoring
* Federated registries

Those are *optional futures*, not foundations.

---

## Conceptual outcome of Stage 7

After Stage 7:

* You have a **full agent platform**, not a framework
* Security properties hold over time
* Extensibility no longer implies risk
* Users can trust both the present and future behaviour of the system

At this point, the architecture is complete.
