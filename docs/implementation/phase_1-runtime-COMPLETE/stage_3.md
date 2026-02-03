# Platform Build Documentation

## Stage 3: Memory System (Typed, Scoped, Governed)

### Purpose of this stage

Stage 3 introduces **memory as infrastructure**, not as agent behaviour.

At the end of this stage, the platform supports:

* Explicit, typed memory
* Controlled write proposals
* Deterministic retrieval
* Clear ownership, scope, and deletion
* Auditability of all memory changes

Memory becomes a **security boundary**, not a convenience feature.

---

## Stage 3 Goals (explicit)

By completion of Stage 3, the system must:

1. Treat memory as **runtime-owned state**

   * Agents cannot write memory directly
   * Agents cannot read memory arbitrarily

2. Support **multiple memory types**

   * With different lifetimes, scopes, and access rules

3. Make memory **inspectable and deletable**

   * User can see what exists
   * User can remove it
   * Deletions are enforced and audited

4. Avoid LLM dependence at retrieval time

   * Deterministic retrieval first
   * LLMs only used optionally at write-time or bounded rerank

---

## Stage 3 Deliverables

### Required artefacts

* `docs/memory-model.md`
* `docs/memory-lifecycle.md`
* `docs/memory-security.md`
* `docs/stage-3-complete.md`

---

## Stage 3 Work Breakdown

---

### 1. Define the Memory Model (spec before code)

**File:** `docs/memory-model.md`

This document defines what memory *is* and *is not*.

#### Memory is:

* Structured data stored by the runtime
* Explicitly typed
* Scoped by subject and purpose
* Governed by policy

#### Memory is NOT:

* Prompt stuffing
* Hidden agent state
* Free-form text blobs with unclear provenance
* Automatically “remembered” conversations

---

### 2. Memory Types (mandatory separation)

**File:** `docs/memory-model.md`

Define the minimum required memory types.

#### Required types

1. **Profile memory**

   * Stable user preferences and facts
   * Examples: timezone, preferred language, working hours
   * Long TTL or permanent
   * High sensitivity

2. **Project memory**

   * Context tied to a named project or task
   * Examples: requirements, decisions, constraints
   * Medium TTL
   * Scoped to project + agents involved

3. **Session memory**

   * Short-lived context
   * Examples: temporary notes, intermediate summaries
   * TTL minutes to hours
   * Automatically expired

4. **Tool-derived memory**

   * Facts extracted from tool calls
   * Must include provenance
   * TTL depends on source

Each type has:

* Default TTL
* Default access scope
* Deletion semantics

**Acceptance criteria**

* Memory type alone determines baseline access and retention
* You cannot store profile data in session memory accidentally

---

### 3. Memory write path (proposal-based, runtime-owned)

**File:** `docs/memory-lifecycle.md`

Memory writes must follow this flow.

#### Step 1: MemoryProposal (from agent or worker)

A structured proposal containing:

* proposed memory type
* subject (user, project, entity)
* content (structured, bounded)
* source (user message id, tool call id)
* sensitivity hint
* suggested TTL
* requesting agent/skill id

#### Step 2: Runtime validation

Runtime enforces:

* allowed memory types per agent/skill
* size limits
* forbidden content classes (eg secrets)
* scope correctness

#### Step 3: Optional LLM compaction (bounded)

If enabled:

* Runtime sends proposal to a compactor worker
* Compactor returns:

  * canonicalised content
  * tags
  * embedding suggestion
* Runtime remains final authority

#### Step 4: Persist + audit

Runtime:

* stores memory
* assigns memory id
* records audit event

**Acceptance criteria**

* Agents cannot force memory writes
* Memory always has provenance
* All writes are auditable

---

### 4. Memory retrieval path (deterministic first)

**File:** `docs/memory-lifecycle.md`

Retrieval is **query-based**, not free recall.

#### Default retrieval flow

1. Agent issues `MemoryQuery`

   * type(s)
   * subject/project
   * query text or filters
2. Runtime:

   * enforces ACL
   * applies TTL rules
   * applies metadata filters
3. Runtime returns:

   * bounded set of memory items
   * summaries or references, not raw dumps

#### Retrieval surfaces (by audience)

* **Agent Memory API**: bounded snippets/summaries only, no full raw blobs by default.
* **User/Admin Memory API (UI)**: full-fidelity content for inspection, subject to user auth and redaction controls.

#### Optional second stage (explicit)

* Agent may request:

  * rerank
  * summarise
* Runtime invokes LLM on *already filtered* set

**Acceptance criteria**

* Retrieval cost is predictable
* No agent can “ask everything you know”
* Memory leakage across scopes is impossible by default

---

### 5. Memory security and access control

**File:** `docs/memory-security.md`

Define memory ACLs explicitly.

#### Access rules

* Main agent: broad read **within attached session/project scopes**, no write
* Workers: limited read/write based on template
* Skills: scoped access only
* Installer: no memory access

#### Scope clarifications

* Main agent can read session memory for current session and project memory only for explicitly attached projects.
* Profile memory is readable only if user enabled it and only for allowed categories (eg preferences, not sensitive notes).
* Tool-derived raw data is not readable unless explicitly permitted.

#### Explicit prohibitions

* No cross-user access
* No cross-project access unless explicitly granted
* No memory write during tool execution without proposal

**Acceptance criteria**

* Memory access decisions are policy-driven
* Memory obeys the same deny-by-default principles as tools

---

### 6. Memory UI (extend control plane)

Extend UI with a **Memory section**.

#### Required views

* Memory list by type
* Filter by project, source, date
* Inspect memory item (content + provenance)
* Delete memory item
* TTL countdown / expiry indicator

#### Required behaviours

* Deletion is immediate and enforced
* Deletion generates audit event
* UI never shows memory outside user scope

**Acceptance criteria**

* User can answer: “What does the system remember about me?”
* User can remove memory without restarting system

---

### 7. Audit extensions for memory

Audit must record:

* memory proposal attempted
* memory write accepted/rejected
* memory read (high-level, not content)
* memory deletion
* memory expiration

**Acceptance criteria**

* Memory lifecycle is reconstructible from audit alone
* You can trace any memory back to its origin

---

### 8. Hardening tasks (code)

Required enforcement to add:

* Maximum memory sizes
* Rate limits on proposals
* TTL enforcement job
* Memory encryption at rest (even local)

Add tests for:

* Invalid proposal rejection
* Scope violation on read
* TTL expiry enforcement
* Deletion correctness

---

## Stage 3 Exit Checklist

**File:** `docs/stage-3-complete.md`

Example items:

* [ ] Memory types defined and enforced
* [ ] Agents cannot write memory directly
* [ ] Deterministic retrieval implemented
* [ ] Memory ACLs enforced
* [ ] Memory UI complete
* [ ] Memory audit events complete
* [ ] No LLM required for basic retrieval

---

## What is explicitly *not* in Stage 3

To prevent scope creep:

* Long-term “learning” agents
* Cross-user shared memory
* Automatic self-reflection loops
* External vector DB dependency (optional later)
* Memory-driven planning logic

---

## Conceptual outcome of Stage 3

After Stage 3:

* Memory is **predictable, inspectable, and safe**
* You avoid the “LLM hallucinated memory” trap
* You have a foundation for multi-agent coordination without leaks
