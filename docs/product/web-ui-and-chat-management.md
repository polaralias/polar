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

Pinned settings include:

1. Primary and fallback model policy.
2. System prompt.
3. Enabled skills.
4. Connected MCP servers.
5. Enabled Claude plugins.
6. Heartbeat defaults.
7. Safety and approval mode.

## Real-Time Management Expectations

1. Task board updates stream in real time from agent and user actions.
2. Long-running tasks show live execution and ownership transitions.
3. Failures are visible with deterministic error class and remediation path.
4. Cost-impact surfaces are visible before enabling high-frequency automations.