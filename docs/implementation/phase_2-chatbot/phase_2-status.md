### 1. Memory Security & Isolation
- **Scoped Queries**: Workers are now strictly bound to session or project scopes. A worker for "Project A" cannot read memory from "Project B".
- **Sensitivity Enforcement**: Memories are tagged with `low`, `moderate`, or `high` sensitivity. Queries enforce `maxSensitivity` limits.
- **Internal Secret Injection**: Gateway-to-Runtime communication is secured, allowing the gateway to pass worker identities for proper auditing without compromising memory integrity.

### 2. Trusted Connectors (Egress)
- **Host Filtering**: All external HTTP requests are filtered against the skill's manifest. Wildcards (`*.github.com`) are supported.
- **Traceable Egress**: Every external request is logged in the audit trail with the URL, method, and the initiating agent's ID.

### 3. Orchestrator: The Planner
- **Instructional Agents**: The "Main" agent is now a pure planner. It has no direct tool access and must spawn specialized workers for every task.
- **Dynamic Context**: System prompts are compiled on-the-fly, injecting relevant user profile data, recent session history, and summaries.

### 4. Premium Chatbot Interface
- **Visual Excellence**: A modern glassmorphism UI with real-time status indicators for active workers and security integrity.
- **Interactive Lifecycle**: Automatic session management, worker tracking, and auto-scrolling conversation logs.

### 5. Infinite Scaling (Context Compaction)
- **Dialogue Persistence**: All session messages are persisted.
- **Automated Compactor**: A background process summarizes history into "Session Summaries" once the context window exceeds safe limits.

## Repository Changes
- `apps/runtime`: Added message store, compactor, orchestrator, and hardened coordination APIs.
- `apps/gateway`: Implemented HTTP egress control and memory scoping tools.
- `apps/ui`: Overhauled with the new Polar design system and chat platform.
- `packages/core`: Expanded schemas for memory security, HTTP constraints, and coordination events.

## Status
- [x] Skill Package Format (`SKILL.md` + `polar.skill.json`)
- [x] Skill Lifecycle & Installer (Full-Archive Verification)
- [x] Permission UI (CLI Interactive Prompts)
- [x] Skill Execution Flow (Instructions Loading)
- [x] Structured Constraints (HTTP Egress Allowlists)

## Key Invariants Verified
1. **Interactive Consent**: Skills cannot be enabled without explicit user consent via the CLI permission UI.
2. **Instruction Provenance**: `SKILL.md` is hashed as part of the skill archive, ensuring instructions aren't tampered with after installation.
3. **Egress Boundaries**: HTTP constraints support wildcard host matching (`*.domain.com`) and method filtering.
4. **Instruction Access**: Runtime provides a secure API to retrieve instructions for the Planner's system prompt.

## Artefacts Created
- `packages/core/src/skills.ts`: Common logic for parsing instruction-based skills.
- `apps/runtime/src/cli.ts` (Updated): Robust subcommand structure with interactive installer.
- `packages/core/test/phase2_stage1.test.ts`: Automated verification of new security schemas.
- `GET /skills/:id/content`: API for retrieving skill instructions.


## Status
- [x] Gateway Egress Enforcement (`http.request` tool)
- [x] Wildcard Host Matching (`*.github.com`)
- [x] Method-level Enforcement (`GET`, `POST`, etc.)
- [x] Structured Audit for Egress (URL, Method included in logs)
- [x] Generic Connector Schemas (`google.mail`, `github.repo` support)

## Key Invariants Verified
1. **Egress Deny-by-Default**: Any HTTP request to a host not explicitly in the `allowHosts` list is rejected with a 403.
2. **Action-Constraint Binding**: The tool call must match the exact action (e.g., `http.request`) and be within the resource bounds.
3. **Auditable Egress**: Every external request is logged with the target URL, allowing for subsequent security reviews or anomaly detection.

## Artefacts Created
- `apps/gateway/src/index.ts` (Updated): `http.request` tool implementation.
- `packages/core/src/schemas.ts` (Updated): `AuditEventSchema` expanded with egress fields.
- `packages/core/src/policy.ts` (Updated): `matchesHttpConstraint` and `matchesGenericConstraint` implemented.

## Status
- [x] Memory Sensitivity Filtering (`low`, `moderate`, `high`)
- [x] Project Context Isolation (`scopeIds` enforcement)
- [x] Gateway Memory Tool (`memory.query` implementation)
- [x] Cross-Service Identity Binding (Gateway -> Runtime via x-polar-internal-secret)

## Key Invariants Verified
1. **Sensitivity Boundary**: Workers requesting `moderate` sensitivity cannot see `high` sensitivity items, even if they have the right scope.
2. **Scope Isolation**: A worker granted access to `project-A` is hard-blocked from querying `project-B` or `global` profile data at the Gateway level.
3. **Internal Security**: Gateway-to-Runtime calls are authenticated and preserve the original subject (worker agent ID) for audit and policy purposes.

## Artefacts Created
- `apps/runtime/src/memoryStore.ts` (Updated): `SENSITIVITY_ORDER` and multi-field query filtering.
- `apps/gateway/src/index.ts` (Updated): `memory.query` tool with scope validation.
- `apps/runtime/src/index.ts` (Updated): Enhanced `/memory/query` with internal override support.


## Status
- [x] Main Agent System Prompt (Dynamic Compilation)
- [x] Multi-Source Context Injection (Profile + Session + Project)
- [x] Skill-Based Planning (Skills listed in prompt)
- [x] Automatic Main Agent Spawning per Session
- [x] Agent Instructional API (`GET /agents/:id/instructions`)

## Key Invariants Verified
1. **Dynamic Awareness**: The Main Agent's prompt is recompiled with the latest available skills every time it's requested.
2. **Context-Rich Planning**: User profile and recent session logs are injected, allowing for continuity across messages.
3. **Role Separation**: The "Main" agent has no direct tool access; it must spawn workers (capabilities delegation) to perform actions.

## Artefacts Created
- `apps/runtime/src/orchestrator.ts`: Core logic for generating the LLM "Brain" configuration.
- `GET /sessions/:id/prompt`: Service endpoint for retrieving the context-aware system prompt.
- `GET /agents/:id/instructions`: Endpoint for workers to retrieve their specific `SKILL.md` instructions.

## Status
- [x] Premium Design System (Glassmorphism + Dark Mode)
- [x] Three-column Layout (Skills Sidebar + Chat + Worker Tracking)
- [x] Real-time State (Polling for active agents & skills)
- [x] Improved Session Management (Rotation + LocalStorage persistence)
- [x] Dynamic Action Feedback (Polling during message processing)

## Key Invariants Verified
1. **Visual Security**: Constant feedback on session security state and audit status.
2. **Contextual Awareness**: Sidebar always shows which skills the Main Agent can currently leverage.
3. **Worker Transparency**: Users can see exactly when and which workers are spawned in response to their requests.

## Artefacts Created
- `apps/ui/src/styles.css`: Overhauled design system.
- `apps/ui/src/pages/ChatPage.tsx`: New 3-column chat experience.
- `apps/ui/src/api.ts`: Updated for session prompt and agent instructions.


## Status
- [x] Orchestration Patterns (Fan-out, Pipeline, Supervisor)
- [x] Hardened Coordination API (Bearer token support)
- [x] Capability Enforcement (`coordination.propose`)
- [x] Parent-Child Spawn Tracking (Depth Limit enforcement ready)

## Key Invariants Verified
1. **Delegated Authority**: Workers can only coordinate (spawn other workers) if they are explicitly granted the `coordination.propose` capability.
2. **Hierarchy Tracking**: All sub-workers are linked to their initiator, allowing for total resource consumption tracking and depth-based infinite loop prevention.
3. **Session Anchoring**: Coordination events are strictly bound to the active session.

## Artefacts Created
- `apps/runtime/src/orchestrator.ts` (Updated): Included coordination pattern guidance for the main agent.
- `apps/runtime/src/index.ts` (Updated): Secured coordination endpoint with token verification.


## Status
- [x] Session Message Persistence (`messageStore.ts`)
- [x] Context Summarizer (`compactor.ts`)
- [x] Historical Pruning (Marking messages as compacted)
- [x] Memory-Based Context Reclamation (Summaries stored in session memory)

## Key Invariants Verified
1. **Context Continuity**: Older messages are removed from the direct log but their essence is preserved in a "Session Summary" memory item, which the Main Agent always sees.
2. **Infinite Scaling**: By compacting every 10-15 messages, we ensure the agent's context window never overflows, regardless of session length.
3. **Traceability**: All messages (including compacted ones) remain in the `messages.json` store for forensics or retrieval if needed.

## Artefacts Created
- `apps/runtime/src/messageStore.ts`: Persistence layer for session dialogue.
- `apps/runtime/src/compactor.ts`: Logic to analyze and summarize history.
- `runtime/index.ts` (Updated): Auto-log and auto-compact on every message.