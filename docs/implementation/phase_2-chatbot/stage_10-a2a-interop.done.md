# Phase 2 - Stage 10: A2A Interoperability & Worker Spawning

## Phase 1 Foundation
This stage builds on the architectural constraints established in Phase 1:
- **`spawnAgent`**: Core agent creation logic with mandatory `parentAgentId` tracking.
- **Spawn Hierarchy**: Enforced depth limits (`maxAgentSpawnDepth`) and session limits (`maxAgentsPerSession`).
- **Role Isolation**: Strictly defined `getRoleCapabilities()` where workers are forbidden from spawning or coordinating.
- **Coordination Framework**: `proposeCoordination` logic which ensures child agents are properly attributed to their parent and session.

## Goal
Establish the core **Planner-Worker Protocol**. The Main Agent (Orchestrator) acts as a high-level planner that cannot directly access external tools. To perform actions, it must request the Runtime to spawn specialized, ephemeral **Workers** with restricted capability tokens.

## Implementation Status (as of February 7, 2026)
**Status**: Complete

## 1. The `worker.spawn` Tool
The Main Agent is given exactly one tool to interact with the outside world (besides audit/policy reads): `worker.spawn`.

### Tool Definition
```typescript
{
  name: "worker.spawn",
  description: "Spawns a specialized, ephemeral worker to perform a specific task with limited capabilities. This is the ONLY way to access external tools.",
  parameters: {
    goal: { type: "string", description: "Clear natural language goal for the worker." },
    capabilities: { 
      type: "array", 
      items: { type: "string" },
      description: "List of explicit capabilities required (e.g., 'calendar.read', 'fs.write'). Must be minimal." 
    },
    context: { type: "string", description: "Background info or data needed." },
    skill: { type: "string", description: "Optional: The ID of a specific skill to load for this worker." },
    model_preference: { type: "string", enum: ["fast", "smart"], default: "smart" }
  }
}
```

## 2. Worker Lifecycle & Policy Enforcement

The security of the platform relies on the **Runtime** enforcing policy at the moment of worker creation.

1.  **Request**: 
    Main Agent calls:  
    `worker.spawn(goal="Read schedule", capabilities=["calendar.read"], params={calendarId: "123"})`

2.  **Runtime Interception**:
    *   **Policy Check**: The Runtime checks the `PolicyStore`.
        *   Does the User allow `calendar.read` globally?
        *   Are there constraints (e.g., "only calendar 123")?
    *   **Token Minting**:
        *   If approved, the Runtime mints a cryptographic **Capability Token**.
        *   This token encodes the *exact* subset of permissions allowed for this specific worker instance (e.g., `allow_actions: ["calendar.list_events"], allow_resources: ["123"]`).
    *   **Denial**: If the policy rejects the request, the Runtime returns an error to the Main Agent w/o spawning the worker.

3.  **Instantiation**:
    *   Runtime creates a new `AgentProcess` (isolated).
    *   Injects the **Capability Token** into the worker's environment.
    *   **Model Selection**: Maps `smart`/`fast` to configured providers.

4.  **Execution Loop**:
    *   Worker receives the `goal` and `context`.
    *   Worker attempts to use MCP tools strategies.
    *   **Gateway Check**: Every tool call passes the Capability Token to the Gateway. The Gateway allows/denies based on the signed token.

5.  **Return**:
    *   Worker calls `task.complete(result="...")`.
    *   Result flows back to Main Agent.
    *   Worker is destroyed (ephemeral).

## 3. Visibility & Logging

### A2A Audit Trail
*   **Trace ID**: Use a distributed trace ID to link Planner -> Worker.
*   **UI Representation**:
    *   The Chat UI renders `worker.spawn` and planner tool outcomes as distinct nested "Action Blocks".
    *   Users can expand blocks to inspect planner arguments, result payloads, worker capability grants, and downstream worker tool actions.
    *   Worker downstream actions are sourced from audited gateway/runtime events correlated by worker agent id and propagated trace identifiers.

### Logging
*   **Events**: Log `worker_spawned` with the list of granted capabilities.
*   **Attribution**: Worker actions are attributed to the `worker_id` but linked to the parent `session_id`.

## 4. Safety Constraints

Phase 1 provides the foundation for worker safety. Phase 2 builds on these controls.

### Inherited from Phase 1
*   **Spawn Depth Limit**: `maxAgentSpawnDepth` (default: 5) prevents runaway recursive spawning.
*   **Session Agent Limit**: `maxAgentsPerSession` (default: 20) prevents resource exhaustion.
*   **Role-Based Restrictions**: 
    *   Workers (`role: "worker"`) cannot spawn children or coordinate.
    *   External agents (`role: "external"`) have the same restrictions.
    *   Only `main` and `coordinator` roles can spawn workers.
*   **Spawn Hierarchy Tracking**: Each agent tracks `spawnDepth` and `parentAgentId`.

### Phase 2 Additions
*   **Read-Only Default**: Unless `write` capabilities are explicitly requested and granted, workers should default to a safe, read-only state.
*   **Capability Token Binding**: Worker tokens are bound to (Skill ID + Session ID + Spawn Instance).
*   **Ephemeral Destruction**: Workers are destroyed on task completion; no state persists.

## Acceptance Criteria
- [x] Main Agent has NO direct tools (fs, http, etc.) — only `worker.spawn`.
- [x] Runtime successfully validates `capabilities` list against `PolicyStore`.
- [x] Runtime mints a Capability Token that limits the Worker's access.
- [x] Gateway rejects Worker tool calls if they exceed the Capability Token scopes.
- [x] Planner chat UI renders expandable action blocks for tool execution and worker spawn metadata (goal/capabilities/model/read-only profile).
- [x] UI renders the spawning event and worker downstream runtime tool actions in a nested view (via session worker trace endpoint + polling).
- [x] Runtime planner loop executes `worker.spawn`, `memory.query`, `memory.propose`, and `policy.check` tool calls with audited allow/deny outcomes.
- [x] Runtime/gateway audit flow propagates trace linkage (`messageId`/`parentEventId`) for worker downstream events.

## Pending Implementation Gaps (as of February 7, 2026)
- None blocking for Phase 2 Stage 10 completion.

## Deferred from Phase 1 (Maturity)
- **Advanced Coordination Logic**: Implement official Supervisor and Pipeline executor logic, allowing for complex multi-worker workflows.
- **Coordination DAG Visualization**: Build a visual graph representation of active and historical agent spawn chains in the UI.
- **End-to-End Trace Propagation**: Ensure total traceability across nested agent calls by propagating trace IDs and parent event IDs through all IPC and network boundaries.
