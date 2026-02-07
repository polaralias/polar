# Phase 2: The Assistant Experience

## Vision
We are transitioning from a secure runtime kernel to a fully functional AI assistant. The goal of Phase 2 is to enable the "Chatbot" experience—interactive, skill-driven, and multi-channel—while ensuring strict security through a **Planner-Worker Architecture**.

## Phase 1 Foundations
Phase 2 builds on the secure foundation established in Phase 1. The following implementations are inherited and strictly enforced:

### Security & Identity
- **Capability Tokens**: `@polar/core` provides `mintCapabilityToken` and `verifyCapabilityToken` for cryptographic authorization.
- **Policy Evaluation**: `evaluatePolicy` supports structured constraints (e.g., file paths, host allowlists).
- **Immediate Revocation**: Accomplished via policy version increments and runtime introspection.
- **Audit Chaining**: Every action is recorded in SHA-256 hash-chained append-only logs for tamper-evidence.

### Agent Management
- **Agent Spawning**: `spawnAgent` with depth tracking (`spawnDepth`, `parentAgentId`) to prevent runaway recursion.
- **Role-Based Access Control (RBAC)**: `getRoleCapabilities()` defines strict boundaries:
    - **Planner Roles** (`main`, `coordinator`): Can spawn, access memory, and coordinate.
    - **Worker Roles** (`worker`, `external`): Cannot spawn, cannot access memory, cannot coordinate.
- **Resource Guardrails**: `maxAgentSpawnDepth` (default: 5) and `maxAgentsPerSession` (default: 20) are enforced at spawn time.

### Persistent Systems
- **Memory System**: Encrypted at rest (AES-256-GCM), size-limited (64KB/item), and tracked with full provenance (agentId, skillId, sourceId).
- **Session Lifecycle**: Robust termination via `POST /sessions/:id/terminate` ensuring all child agents are cleaned up.
- **Audit Tooling**: Export functionality support (`JSON`, `NDJSON`, `CSV`) and redaction capabilities (`POST /audit/:id/redact`).

## System Configuration (Phase 1 Defaults)
| Config | Default | Env Var | Description |
|--------|---------|---------|-------------|
| `maxMemoryContentSize` | 64KB | `MAX_MEMORY_CONTENT_SIZE` | Memory proposal limit |
| `maxAgentSpawnDepth` | 5 | `MAX_AGENT_SPAWN_DEPTH` | Recursive spawn limit |
| `maxAgentsPerSession` | 20 | `MAX_AGENTS_PER_SESSION` | Active agents per session |
| `capabilityTtlSeconds` | 120 | `CAPABILITY_TTL` | Capability token lifetime |
| `rateLimitMaxRequests` | 100 | `RATE_LIMIT_MAX` | Requests per minute |

**Key Architectural Shift:**
The "Main Agent" (the interface the user talks to) is strictly a **Planner and Router**. It **DOES NOT** have direct access to external tools (file system, network, MCP servers). Instead, it must request the **Runtime** to spawn specialized, ephemeral **Workers** for specific tasks.

*   **Main Agent (The Planner)**:
    *   Has high-level context and conversation history.
    *   **Capabilities**: `spawn_worker`, `read_policy_summary`, `write_audit_log`.
    *   **Role**: Understands user intent, checks policy summaries, and requests the creation of a worker with specific, minimal capabilities.
*   **Runtime (The Enforcer)**:
    *   Receives `spawn_worker` requests.
    *   Checks the `PolicyStore`.
    *   Mints a cryptographic **Capability Token** (subset of permissions).
    *   Spawns a sandboxed Worker injected with that token.
*   **Workers (The Executors)**:
    *   Short-lived sub-agents running a specific Skill or Tasks.
    *   Have direct access to MCP tools, but *only* those allowed by their Capability Token.
    *   Perform the actual I/O (read calendar, write file, search web).

## Implementation Roadmap

The implementation is broken down into 10 sequential stages. Do not skip stages.

### [Stage 1: Skills & Templates](./stage_1-skills-and-templates.done.md)
**Goal**: Enable safe, local-first skill installation using `SKILL.md` and `polar.skill.json`.
**Deliverables**: Skill Installer (Full-Archive Verification), Skill Runner (Worker), Permission UI.

### [Stage 2: Connectors (Typed Integrations)](./stage_2-connectors.done.md)
**Goal**: Build the first "Real" integrations using the Gateway Pattern.
**Deliverables**: HTTP Connector (Egress Control), Gateway Enforcement Logic, Google/GitHub Connector.

### [Stage 3: Proactive Automation](./stage_3-proactive-automation.done.md)
**Goal**: Enable the assistant to act on events, not just user messages.
**Deliverables**: Event Store, Automation Envelopes, Proactive Tiers (0-3).

### [Stage 4: Channels](./stage_4-channels.done.md)
**Goal**: Interact with Polar via external messaging platforms.
**Deliverables**: Channel Adapter, Pairing Flow, Telegram/Slack Integration.

### [Stage 5: CLI Wrappers](./stage_5-cli-wrappers.done.md)
**Goal**: Safely integrate local tools and OS-native apps.
**Deliverables**: `cli.run` tool, Executable Allowlists, CLI Connector.

### [Stage 6: Integrations Expansion](./stage_6-integrations-expansion.done.md)
**Goal**: Deepen the capability set with high-value integrations.
**Deliverables**: Gmail, Advanced Home Assistant, File Workflows.

### [Stage 7: Ecosystem Hardening](./stage_7-ecosystem.done.md)
**Goal**: Prepare for distribution and untrusted skills.
**Deliverables**: Full-Archive Signing, Update Diffs, Emergency Mode.

### [Stage 8: LLM Brain & Configuration](./stage_8-llm-brain.done.md)
**Goal**: Establish the core intelligence layer, secure API key management, and provider abstraction.
**Deliverables**: `LLMService`, Provider Adapters (OpenRouter/Anthropic), Encrypted Key Vault, Dynamic System Prompt.

### [Stage 9: Personalization](./stage_9-personalization.done.md)
**Goal**: Allow users to shape the agent's persona and behavior globally.
**Deliverables**: User Preferences Schema, Custom Instruction Injection, "About Me" & "Response Style" Settings, Onboarding Flow & Interview Mode.

### [Stage 10: A2A Interoperability](./stage_10-a2a-interop.done.md)
**Goal**: Enable the Orchestrator to spawn and manage sub-agents (workers).
**Deliverables**: `worker.spawn` Tool, Worker Lifecycle Manager, A2A Audit Trail, Nested UI Rendering.

## Current Implementation Snapshot (as of February 7, 2026)
| Stage | Status | Notes |
|-------|--------|-------|
| Stage 1 | Complete | Skill manifest hardening, recursive full-archive verification, approval gates, and sanitizer-based redaction are implemented end-to-end. |
| Stage 2 | Complete | Connector approval configuration is available in policy/UI and the first typed integration (`github.repo`) is implemented behind gateway enforcement. |
| Stage 3 | Complete | Durable dedupe-backed event ingestion, envelope persistence, batched Tier-0 notifications, and chat-native setup proposal/confirm flows are implemented. |
| Stage 4 | Complete | Pairing/allowlist, persisted conversation-to-session routing, attachment quarantine analysis workflow, and Slack webhook inbound normalization are implemented. |
| Stage 5 | Complete | CLI allowlist/validation/timeout/output caps and command-array audit fidelity are implemented. |
| Stage 6 | Complete | Advanced Gmail connector controls, Home Assistant allowlist/denylist enforcement, and filesystem workflow tools with skill packs are implemented. |
| Stage 7 | Complete | Trust-store management UX, signing-policy controls, emergency recovery wizard, and existing rollback/re-consent/integrity protections are implemented. |
| Stage 8 | Complete | LLM service/providers/tiers/sub-agents, Intelligence UI, and `/llm/chat` planner tool-execution path are implemented. |
| Stage 9 | Complete | Preferences schema/API/UI, onboarding extraction into structured context, and proactive goal check-in scheduling are implemented. |
| Stage 10 | Complete | Worker spawn/token/gateway enforcement, planner tool loop, nested worker child-action trace, and trace-id linkage across runtime/gateway audit are implemented. |

Detailed summary: [`phase_2-summary.md`](./phase_2-summary.md)

## Core Principles for Phase 2
1.  **Main Agent as Router**: The Main Agent is a privileged planner but a restricted executor. It cannot directly touch external systems.
2.  **Runtime-Minted Capabilities**: Permissions are not static. The Runtime mints ephemeral tokens for each Worker based on the specific `spawn_worker` request and the user's standing policy (PolicyStore).
3.  **The "Reading Is Dangerous" Principle**: Reads are not safe. Even reading a calendar is a privacy breach. Therefore, *all* I/O (read or write) must undergo the Worker Spawning protocol to ensure policy enforcement.
4.  **Strict Gateway Boundary**: The Gateway enforces the token constraints for every tool call made by a Worker.
5.  **No "Do Anything"**: Main Agent never gets generic shell access. Workers only get the specific tools requested (e.g., `calendar.read` vs `calendar.write`).

## Deferred from Phase 1 (Production Hardening)
- **Deployment Profiles (Cloud/Edge)**: Develop specialized configuration profiles and adapters for managed cloud environments (Secrets Manager, RDS) and edge proxy deployment.
- **Audit Schema Versioning**: Implement versioning for the audit log schema to ensure long-term data sustainability and compatibility across platform updates.
- **External Secrets Backends**: Implement support for professional external secrets managers (HashiCorp Vault, AWS Secrets Manager) beyond the local encrypted file adapter.

