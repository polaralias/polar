# Web UI And Chat Management

Last updated: 2026-02-22

## Web UI Decision

Polar will ship and maintain a Polar-owned Web UI as the management control plane.

We may reuse selected internal component patterns from foundation libraries, but runtime management behavior is defined by Polar contracts and policy APIs.

## Core UI Areas

1. Chat workspace:
   - live conversations
   - historical session navigation
   - search and filtering
2. Task board:
   - task status lanes (`todo`, `in_progress`, `blocked`, `done`)
   - assignment (`user`, `agent`, specific agent profile)
   - linkage to chats, runs, and artifacts
3. Agent profiles:
   - create/edit profiles
   - pin defaults per workspace or session
   - manage model/system prompt presets
4. Extension management:
   - install and configure skills
   - connect and manage MCP servers
   - install and configure Claude plugins
5. Channel management:
   - connect Telegram, Slack, Discord, and additional endpoints
   - monitor adapter health and delivery status
6. Automation and heartbeat management:
   - configure schedules and proactive triggers
   - configure heartbeat policy and visibility
   - review run history and failures
7. Audit, usage, and policy:
   - policy decisions and denials
   - tool-call traces and handoff lineage
   - model usage, fallback events, and budget status

## Chat Management Requirements

1. Session-level metadata and tagging.
2. Conversation retention controls.
3. Export and archival controls.
4. Moderation and safety review workflows.
5. Thread continuity across channel endpoints.
6. Memory recall tools and durable memory edit workflows.

## Agent Pinning UX

Operators can pin agent defaults at multiple scopes:

1. Global platform profile.
2. Workspace profile.
3. Session-specific override.

Pinned settings are exclusively governed by the unified Control Plane state (upserted interactively via the Web UI or a portable `polar.config.json` startup bootstrap) and include:

1. Pinned LLM Provider and Model identities (e.g., Anthropic for writing, Gemini for research) to enforce role-based execution domains.
2. Primary and fallback model policy.
3. System prompt.
4. Enabled skills.
5. Connected MCP servers.
6. Enabled Claude plugins.
7. Heartbeat defaults.
8. Safety and approval mode.
9. Strictly bounded `allowedHandoffTargets` to prevent downstream privilege escalation across delegated sub-agent roles.

## Real-Time Management Expectations

1. Task board updates stream in real time from agent and user actions.
2. Long-running tasks show live execution and ownership transitions.
3. Failures are visible with deterministic error class and remediation path.
4. Cost-impact surfaces are visible before enabling high-frequency automations.