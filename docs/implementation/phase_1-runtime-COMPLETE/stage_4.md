# Platform Build Documentation

## Stage 4: Multi-Agent Coordination and A2A Interoperability

### Purpose of this stage

Stage 4 introduces **multiple agents as a controlled execution pattern**, not as autonomous actors.

At the end of this stage, the platform supports:

* Multiple cooperating agents
* Explicit coordination models
* External agent interoperability (A2A)
* Delegation without permission leakage

Crucially: **coordination is an orchestration concern, not an LLM concern**.

---

## Stage 4 Goals (explicit)

By completion of Stage 4, the system must:

1. Support **multiple agents per session**

   * Each agent has a clear role
   * Each agent has bounded authority

2. Make coordination **explicit and inspectable**

   * No “implicit” agent spawning
   * No hidden message passing

3. Support **A2A-style interoperability**

   * External agents can be delegated tasks
   * External agents cannot bypass local policy

4. Preserve all prior stage invariants

   * No agent gains new privileges
   * Runtime remains the sole authority

---

## Stage 4 Deliverables

### Required artefacts

* `docs/agent-model.md`
* `docs/coordination-model.md`
* `docs/a2a-design.md`
* `docs/stage-4-complete.md`

---

## Stage 4 Work Breakdown

---

### 1. Define the Agent Model (spec before code)

**File:** `docs/agent-model.md`

This document defines what an “agent” means in your platform.

#### An agent is:

* A reasoning process (LLM-backed or otherwise)
* Bound to a role
* Bound to a capability ceiling
* Spawned and supervised by the runtime

#### An agent is NOT:

* A security boundary
* A credential holder
* A policy authority
* A self-spawning entity

---

### 2. Agent Roles (mandatory classification)

**File:** `docs/agent-model.md`

Define explicit agent roles.

#### Required roles

1. **Main agent**

   * User-facing
   * Planning and delegation only
   * No direct tool access

2. **Worker agent**

   * Task-specific
   * Short-lived by default
   * Tool access via capabilities only

3. **Coordinator agent (optional)**

   * Manages complex workflows
   * Still has no direct tool access
   * Delegates work via runtime

4. **External agent**

   * Lives outside the runtime
   * Communicates via A2A
   * Never trusted by default

Each role has:

* Allowed actions
* Forbidden actions
* Default lifetime

**Acceptance criteria**

* Every agent instance has exactly one role
* Role determines maximum possible authority

---

### 3. Agent lifecycle and supervision

**File:** `docs/coordination-model.md`

Define the lifecycle clearly.

#### Lifecycle phases

1. Spawn (runtime-controlled)
2. Execute (bounded)
3. Return result or error
4. Terminate or suspend
5. Audit closure

#### Supervision rules

* Runtime may terminate agents at any time
* Runtime may revoke capabilities mid-execution
* Agent crashes do not affect runtime stability

**Acceptance criteria**

* An agent cannot outlive its session without explicit runtime approval
* Termination is auditable

---

### 4. Coordination patterns (explicit, finite)

**File:** `docs/coordination-model.md`

Define supported coordination models.

#### Required patterns

1. **Fan-out / fan-in**

   * Main agent requests multiple workers
   * Runtime aggregates results

2. **Pipeline**

   * Output of worker A feeds worker B
   * Runtime enforces data passing rules

3. **Supervisor**

   * Coordinator agent proposes next steps
   * Runtime executes approved steps

#### Explicitly forbidden

* Recursive agent spawning
* Agent-to-agent tool calls
* Hidden shared memory between agents

**Acceptance criteria**

* All coordination flows can be reconstructed from audit logs
* No coordination logic lives inside LLM prompts alone

---

### 5. A2A interoperability model

**File:** `docs/a2a-design.md`

This defines how external agents interact safely.

#### A2A principles

* Treat external agents as untrusted clients
* Never share credentials
* Never delegate open-ended authority

#### Supported A2A operations

* Submit task request
* Receive bounded result
* Optional: request clarification

#### External agent principal and identity binding

* Represent external agents as a first-class principal:

  * `principal_type: external_agent`
  * stable `external_agent_id`
  * always bound to a specific `user_id` and `session_id` (or delegation id)
* Authentication is transport-layer (eg mTLS, OAuth client credentials, or API key + signature).
* Every A2A request includes nonce + signature for anti-replay and is mapped to an internal principal before policy evaluation.

#### AgentCard-equivalent metadata

* External agents publish an identity/capability manifest (AgentCard-like) declaring:

  * agent identity
  * supported protocol/version
  * advertised capabilities/message types
  * supported auth schemes
* Runtime stores the manifest and uses it only for routing and UI visibility, never for granting authority.

#### Capability handling

* External agents receive:

  * pre-filtered inputs
  * no direct tool access
* If an external agent must act:

  * runtime executes actions locally
  * external agent never touches tools

**Acceptance criteria**

* External agent compromise cannot escalate privileges
* A2A traffic is auditable and attributable
* External agents are bound to user/session scope before any action is evaluated

---

### 6. Multi-agent memory interaction rules

Integrate with Stage 3 memory.

#### Rules

* Agents cannot write shared memory directly
* All memory proposals go through runtime
* Memory reads are scoped per agent role

Examples:

* Worker can read project memory but not profile memory
* Coordinator can read summaries, not raw tool data

**Acceptance criteria**

* No memory leakage across agents
* Memory access respects both agent role and skill scope

---

### 7. UI extensions for multi-agent visibility

Extend control UI.

#### Required views

* Active agents list
* Agent role, lifetime, current task
* Agent termination controls
* Coordination graph (basic DAG view)

#### Required behaviours

* User can see which agents exist
* User can stop agents
* User can trace which agent caused which action

**Acceptance criteria**

* User can answer: “Which agent did this?”
* User can intervene in runaway coordination

---

### 8. Audit extensions for agents

Audit must record:

* agent spawn
* agent termination
* coordination events
* A2A requests and responses

**Acceptance criteria**

* Full agent lifecycle is reconstructible
* External vs internal agents are clearly distinguished

---

## Stage 4 Exit Checklist

**File:** `docs/stage-4-complete.md`

Example items:

* [ ] Agent roles defined and enforced
* [ ] Runtime controls all spawning
* [ ] Coordination patterns documented and implemented
* [ ] External agents sandboxed
* [ ] UI shows agent activity
* [ ] Audit records all coordination events
* [ ] No Stage 1–3 invariant violated

---

## What is explicitly *not* in Stage 4

To prevent runaway complexity:

* Autonomous self-directed agents
* Self-modifying agent graphs
* Agent-owned memory
* Agent-owned credentials
* Cross-session agent persistence

---

## Conceptual outcome of Stage 4

After Stage 4:

* You have **controlled multi-agent systems**
* Coordination is observable and debuggable
* Interop is possible without trust

This is the point where your platform becomes *architecturally superior* to most existing agent frameworks, because coordination is explicit, not emergent.
