# Agent registry and pinning APIs

## Purpose
Define the control-plane APIs needed to support:
- deterministic chat commands for agent registry and pinning
- orchestrator lookup and enforcement
- Web UI allowlisting

This spec does not introduce a new config resource type. Registry is stored as a policy record.

## Storage
- Registry: `resourceType="policy"`, `resourceId="agent-registry:default"`
- Pins: existing profile-pin policies:
  - `profile-pin:session:<sessionId>`
  - `profile-pin:workspace:<workspaceId>`
  - `profile-pin:global`

## Control-plane methods (recommended)
Add explicit methods to avoid “generic policy editing”:
- `getAgentRegistry() -> { version, agents[] }`
- `upsertAgentRegistry({ registry })` (operator/admin)
- `listAgentProfiles() -> agents[]` (safe fields only)
- `getAgentProfile({ agentId }) -> agent` (safe fields only)
- `registerAgentProfile({ agentId, profileId, description, ...optional })` (operator/admin)
- `unregisterAgentProfile({ agentId })` (operator/admin)

Pin helpers:
- `pinProfileForScope({ scope, sessionId?, userId?, workspaceId?, profileId })`
- `unpinProfileForScope({ scope, sessionId?, userId?, workspaceId? })`
- `getEffectivePinnedProfile({ sessionId, userId, workspaceId? }) -> { scope, profileId } | null`

Notes:
- The underlying implementation can still use config store upsert/get for policy records.
- The explicit methods must validate schema and restrict resourceIds to allowlisted patterns.

## Chat commands mapping
- `/agents register ...` -> `registerAgentProfile`
- `/agents unregister ...` -> `unregisterAgentProfile`
- `/agents` -> `listAgentProfiles`
- `/agents show <agentId>` -> `getAgentProfile`
- `/agents pin <agentId> [--session|--user|--global]`
  - resolve agentId → profileId via registry
  - call `pinProfileForScope`
- `/agents unpin ...` -> `unpinProfileForScope`
- `/agents pins` -> `getEffectivePinnedProfile`

## Orchestrator access
Orchestrator needs:
- `getAgentRegistry()` (or `listAgentProfiles()` plus optional detail lookup)
- A strict schema validator to prevent prompt injection via registry content.

Orchestrator must never accept arbitrary agent definitions from model output.

## Acceptance criteria
- Control plane provides allowlist-friendly methods above.
- Registry validation rejects invalid agentId/profileId formats.
- Pinning uses existing profile-pin policy ids.

## Agent checklist
- Check `AGENTS.md` first.
- Read the last 150 lines of `docs/IMPLEMENTATION_LOG.md` before starting.
- Write a log entry using the agreed template when done.
