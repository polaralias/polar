# Agent registry and pinning APIs

## Purpose
Define the control-plane APIs needed to support:
- deterministic chat commands for agent registry, agent configuration, and pinning
- orchestrator lookup and enforcement
- CLI/on-disk YAML configuration
- Web UI allowlisting

This spec does not introduce a new config resource type. Registry is stored as a policy record.

## Storage
- Registry: `resourceType="policy"`, `resourceId="agent-registry:default"`
- Pins: existing profile-pin policies:
  - `profile-pin:session:<sessionId>`
  - `profile-pin:workspace:<workspaceId>`
  - `profile-pin:global`

Agent configuration is operator-facing and may be exported/imported as YAML, but the canonical persisted data still lives in:
- registry policy records
- profile config records

## Control-plane methods (recommended)
Add explicit methods to avoid “generic policy editing”:
- `getAgentRegistry() -> { version, agents[] }`
- `upsertAgentRegistry({ registry })` (operator/admin)
- `listAgentProfiles() -> agents[]` (safe fields only)
- `getAgentProfile({ agentId }) -> agent` (safe fields only)
- `registerAgentProfile({ agentId, profileId, description, ...optional })` (operator/admin)
- `unregisterAgentProfile({ agentId })` (operator/admin)

Combined configuration helpers:
- `getAgentConfiguration({ agentId }) -> { version, agent, forwarding, profile }`
- `applyAgentConfiguration({ configuration }) -> { status, agent, profileConfig }` (operator/admin)
- `exportAgentConfigurationYaml({ agentId }) -> { agent, yamlText }`
- `applyAgentConfigurationYaml({ yamlText }) -> { status, agent, profileConfig }` (operator/admin)

Pin helpers:
- `pinProfileForScope({ scope, sessionId?, userId?, workspaceId?, profileId })`
- `unpinProfileForScope({ scope, sessionId?, userId?, workspaceId? })`
- `getEffectivePinnedProfile({ sessionId, userId, workspaceId? }) -> { scope, profileId } | null`

Notes:
- The underlying implementation can still use config store upsert/get for policy records.
- The explicit methods must validate schema and restrict resourceIds to allowlisted patterns.
- Legacy `@generic_sub_agent` inputs should be normalized to the shipped fallback `@general`.
- Applying combined configuration must keep registry metadata and delegated profile config in sync.

## YAML-backed config flow
Expected operator flow:
1. Read/export a combined agent config document.
2. Edit YAML on disk or in a chat/CLI command.
3. Re-apply YAML through the explicit control-plane method.

The platform boot path should:
- seed default YAML files for shipped agents when the directory is empty
- sync YAML documents into the control plane on startup
- write updated YAML back out when agent config changes through chat/CLI/UI

## Chat commands mapping
- `/agents register ...` -> `registerAgentProfile`
- `/agents unregister ...` -> `unregisterAgentProfile`
- `/agents` -> `listAgentProfiles`
- `/agents show <agentId>` -> `getAgentProfile`
- `/agents export-yaml <agentId>` -> `exportAgentConfigurationYaml`
- `/agents apply-yaml <yaml>` -> `applyAgentConfigurationYaml`
- `/agents set-model <agentId> | <providerId> | <modelId>` -> `getAgentConfiguration` + `applyAgentConfiguration`
- `/agents set-tools <agentId> | <skillA,skillB|none>` -> `getAgentConfiguration` + `applyAgentConfiguration`
- `/agents set-prompt <agentId> | <systemPrompt>` -> `getAgentConfiguration` + `applyAgentConfiguration`
- `/agents pin <agentId> [--session|--user|--global]`
  - resolve agentId → profileId via registry
  - call `pinProfileForScope`
- `/agents unpin ...` -> `unpinProfileForScope`
- `/agents pins` -> `getEffectivePinnedProfile`

Equivalent deterministic commands may be surfaced in Telegram first and then mirrored by other chat adapters.

## Orchestrator access
Orchestrator needs:
- `getAgentRegistry()` (or `listAgentProfiles()` plus optional detail lookup)
- A strict schema validator to prevent prompt injection via registry content.

Orchestrator must never accept arbitrary agent definitions from model output.

## Acceptance criteria
- Control plane provides allowlist-friendly methods above.
- Registry validation rejects invalid agentId/profileId formats.
- Pinning uses existing profile-pin policy ids.
- Combined agent configuration round-trips through validated YAML.
- Control-plane allowlists expose only explicit agent config methods, not arbitrary profile/policy mutation.

## Agent checklist
- Check `AGENTS.md` first.
- Read the last 150 lines of `docs/IMPLEMENTATION_LOG.md` before starting.
- Write a log entry using the agreed template when done.
