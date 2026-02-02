# Coordination Model

## Overview

Coordination in Polar is an **orchestration concern managed by the runtime**, not an emergent behavior of LLMs. This document defines how agents are spawned, managed, and how they interact with each other through explicit patterns.

## Agent Lifecycle

The runtime is the sole authority for agent creation and destruction.

1. **Spawn:**
   * Initiated by the user or a Main/Coordinator agent proposal.
   * Runtime validates the request against policy.
   * Runtime assigns a Role and mints a unique `agent_id`.
   * Runtime initializes the agent's context (memory scope, capability ceiling).

2. **Execute:**
   * Agent processes inputs and proposes actions.
   * Actions requiring tool access must be mediated by the runtime (capability token request).
   * Runtime enforces timeouts and resource limits.

3. **Result/Error:**
   * Agent returns the output to the supervisor (Runtime or delegating agent).
   * Errors are captured and attributed.

4. **Terminate:**
   * Triggered by task completion, timeout, session end, or manual user intervention.
   * Runtime revokes any outstanding tokens.
   * Runtime cleans up ephemeral resources.

5. **Audit Closure:**
   * A final audit event is recorded summarizing the agent's activity and status.

## Supervision Rules

* **Fail-fast:** If an agent attempts to exceed its capability ceiling, it is immediately suspended or terminated.
* **Deterministic Revocation:** The runtime can invalidate an agent's authority instantly.
* **Isolation:** Agent failures (e.g., LLM hallucinations, crashes) are contained and do not compromise the runtime or other agents.

## Coordination Patterns

Polar supports a finite set of explicit coordination patterns. Recursive or non-linear spawning is forbidden.

### 1. Fan-out / Fan-in
* **Description:** A Main agent identifies multiple independent tasks and requests the runtime to spawn worker agents for each.
* **Flow:**
   1. Main Agent Proposes: `[Task A, Task B, Task C]`
   2. Runtime Spawns: `Worker A, Worker B, Worker C`
   3. Workers return results to Runtime.
   4. Runtime aggregates results and provides them to Main Agent.
* **Goal:** Parallel processing of discrete tasks.

### 2. Pipeline
* **Description:** A sequential flow where the output of one worker becomes the input for the next.
* **Flow:**
   1. Main Agent Proposes: `Workflow [Worker 1 -> Worker 2]`
   2. Runtime Spawns `Worker 1`.
   3. `Worker 1` delivers result to Runtime.
   4. Runtime validates and passes result to `Worker 2`.
   5. `Worker 2` completes task.
* **Goal:** Structured multi-step processing with runtime data-passing enforcement.

### 3. Supervisor (Human-in-the-Loop)
* **Description:** A Coordinator agent proposes a plan, which must be approved by the user before execution.
* **Flow:**
   1. Coordinator Proposes: `Plan [Step 1, Step 2, Step 3]`
   2. UI presents Plan to User.
   3. User Approves/Modifies.
   4. Runtime executes approved steps using Workers.
* **Goal:** Complex work requiring high-fidelity oversight.

## Multi-Agent Interaction Invariants

* **No Direct Messaging:** Agents cannot send messages directly to each other; all communication must flow through the runtime message bus and be logged.
* **No Hidden Shared State:** Agents do not share memory unless explicitly granted access to a shared resource by the runtime.
* **Attribution:** Every message in a coordination flow must be attributed to the sending agent and the pattern being used.

## Conflict Resolution

If multiple agents propose conflicting actions:
* Logic-based conflicts are resolved by the Runtime policy (e.g., priority, sequence).
* Ambiguous conflicts are escalated to the User for manual resolution.
