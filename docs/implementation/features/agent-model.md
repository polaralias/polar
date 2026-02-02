# Agent Model

## Overview

In the Polar platform, an "agent" is a controlled execution pattern, not an autonomous actor. It represents a reasoning process (usually LLM-backed) that is bound to a specific role and capability ceiling, and is supervised entirely by the runtime.

## Defining an Agent

An agent is:
* **A reasoning process:** A logic unit (LLM, state machine, or code) that processes information and proposes actions.
* **Bound to a role:** A classification that defines its purpose and maximum possible authority.
* **Bound to a capability ceiling:** A strict set of permissions derived from its role and session context.
* **Spawned and supervised by the runtime:** The runtime controls its creation, execution, and termination.

An agent is **NOT**:
* **A security boundary:** Agents do not hold credentials or enforce policy; the runtime and gateway do.
* **A credential holder:** Agents never see raw API keys or secrets.
* **A policy authority:** Agents cannot grant permissions or change system policy.
* **A self-spawning entity:** Agents cannot create other agents without explicit runtime mediation.

## Agent Roles

Every agent in Polar must be assigned exactly one role upon creation. The role determines the default capability set and lifecycle characteristics.

### 1. Main Agent
* **Purpose:** Primary interface for the user within a session.
* **Responsibilities:** Understanding user intent, high-level planning, and delegating specific tasks to worker agents.
* **Constraints:** No direct tool access. It must propose delegations to the runtime.
* **Lifetime:** Bound to the user session.

### 2. Worker Agent
* **Purpose:** Task-specific execution unit.
* **Responsibilities:** Performing a narrow task (e.g., searching files, analyzing data, calling a specific tool).
* **Constraints:** Tool access is restricted to the capabilities granted for the specific task. Short-lived by default.
* **Lifetime:** Terminated upon task completion or timeout.

### 3. Coordinator Agent
* **Purpose:** Orchestrator for complex, multi-step workflows.
* **Responsibilities:** Managing sequences of worker tasks and aggregating results.
* **Constraints:** No direct tool access. Delegates work via the runtime.
* **Lifetime:** Bound to the workflow duration.

### 4. External Agent
* **Purpose:** Integration with agents living outside the Polar runtime (A2A).
* **Responsibilities:** Providing specialized expertise or cross-platform collaboration.
* **Constraints:** Never trusted by default. Interacts via the A2A gateway. No direct tool access; actions are executed locally by the runtime if approved.
* **Lifetime:** Managed by external service; session-bound in Polar.

## Role Constraints Table

| Role | Tool Access | Memory Access | Can Delegate | Default Lifetime |
| --- | --- | --- | --- | --- |
| **Main** | None | Reads session/profile | Yes (via Runtime) | Session |
| **Worker** | Scoped (Capability-based) | Scoped (Task-based) | No | Task |
| **Coordinator** | None | Summaries | Yes (via Runtime) | Workflow |
| **External** | None (Proxy only) | Restricted | No | External |

## Agent Identity and Principles

### Principal Type: `agent`
Agents are first-class principals in the Polar policy model.
* `principal_id`: Unique identifier for the agent instance.
* `role`: One of the defined roles above.
* `session_id`: The session the agent belongs to.
* `skill_id`: (Optional) If the agent is provided by a specific skill.

### Invariants
1. **No Authority Escalation:** An agent can never hold more authority than the user who spawned the session.
2. **Explicit Authority:** Every action proposed by an agent must be backed by a capability token minted by the runtime.
3. **Identity Binding:** All agent activity is attributed to the agent's identity and the parent session in the audit log.
