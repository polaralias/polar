# Phase 2: The Assistant Experience

## Vision
We are transitioning from a secure runtime kernel to a fully functional AI assistant. The goal of Phase 2 is to enable the "Chatbot" experience—interactive, skill-driven, and multi-channel—while ensuring strict security through a **Planner-Worker Architecture**.

## Phase 1 Prerequisites
Phase 2 builds on the secure foundation established in Phase 1. See [PHASE1_ALIGNMENT.md](./PHASE1_ALIGNMENT.md) for detailed cross-reference.

**Key Phase 1 Capabilities Used:**
- **Agent Spawning**: `spawnAgent` with depth tracking, role constraints, session limits
- **Capability Tokens**: `mintCapabilityToken` / `verifyCapabilityToken` with policy version binding
- **Introspection**: Gateway validates every tool call against runtime
- **Emergency Mode**: `POST /system/emergency` blocks all tool execution
- **Audit Chaining**: SHA-256 hash-chained append-only logs
- **Memory System**: Encrypted at rest, size-limited, provenance-tracked

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

### [Stage 1: Skills & Templates](./01-skills-and-templates.md)
**Goal**: Enable safe, local-first skill installation using `SKILL.md` and `polar.skill.json`.
**Deliverables**: Skill Installer (Full-Archive Verification), Skill Runner (Worker), Permission UI.

### [Stage 2: Connectors (Typed Integrations)](./02-connectors.md)
**Goal**: Build the first "Real" integrations using the Gateway Pattern.
**Deliverables**: HTTP Connector (Egress Control), Gateway Enforcement Logic, Google/GitHub Connector.

### [Stage 3: Proactive Automation](./03-proactive-automation.md)
**Goal**: Enable the assistant to act on events, not just user messages.
**Deliverables**: Event Store, Automation Envelopes, Proactive Tiers (0-3).

### [Stage 4: Channels](./04-channels.md)
**Goal**: Interact with Polar via external messaging platforms.
**Deliverables**: Channel Adapter, Pairing Flow, Telegram/Slack Integration.

### [Stage 5: CLI Wrappers](./05-cli-wrappers.md)
**Goal**: Safely integrate local tools and OS-native apps.
**Deliverables**: `cli.run` tool, Executable Allowlists, CLI Connector.

### [Stage 6: Integrations Expansion](./06-integrations-expansion.md)
**Goal**: Deepen the capability set with high-value integrations.
**Deliverables**: Gmail, Advanced Home Assistant, File Workflows.

### [Stage 7: Ecosystem Hardening](./07-ecosystem.md)
**Goal**: Prepare for distribution and untrusted skills.
**Deliverables**: Full-Archive Signing, Update Diffs, Emergency Mode.

### [Stage 8: LLM Brain & Configuration](./08-llm-brain.md)
**Goal**: Establish the core intelligence layer, secure API key management, and provider abstraction.
**Deliverables**: `LLMService`, Provider Adapters (OpenRouter/Anthropic), Encrypted Key Vault, Dynamic System Prompt.

### [Stage 9: Personalization](./09-personalization.md)
**Goal**: Allow users to shape the agent's persona and behavior globally.
**Deliverables**: User Preferences Schema, Custom Instruction Injection, "About Me" & "Response Style" Settings, Onboarding Flow & Interview Mode.

### [Stage 10: A2A Interoperability](./10-a2a-interop.md)
**Goal**: Enable the Orchestrator to spawn and manage sub-agents (workers).
**Deliverables**: `worker.spawn` Tool, Worker Lifecycle Manager, A2A Audit Trail, Nested UI Rendering.

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
