# Sub-agent profiles (task-specific agent pinning)

## Purpose
Enable task-specific “sub-agent profiles” (eg writer, researcher) that the orchestrator can delegate to instead of just loading a single skill.

A sub-agent profile bundles:
- a **profileId** (model policy, allowed skills, context window, system prompt)
- an **agentId** (stable handle, eg `@writer`)
- a **description** (always in context so the model can choose it)
- optional constraints (default forward skills, allowed MCP connections)

This must be code-enforced:
- Delegations cannot bypass middleware.
- The delegated agent must run using the pinned profile config, including pinned model/provider and allowed skills.
- Model-suggested overrides are clamped to allowlist.

## What exists today (repo reality)
- Profile pin resolution exists: session/workspace/global pin policies (`profile-pin:*`) are resolved by runtime.
- Delegation concept exists in orchestrator, but:
  - “multi_agent default config” is not persistable via config types today.
  - pinned provider/model is described but not reliably enforced by code.
  - reaction mapping and anchoring rely on message id bindings.

This spec makes the sub-agent approach durable and configurable.

## Definitions
- **Agent profile**: an entry in an Agent Registry pointing at a `profileId`.
- **Profile**: a control-plane config record with `resourceType="profile"`.
- **Agent Registry**: an allowlisted config record that lists available agent profiles.
- **Pin**: selecting a profile as default for a scope (session/user/global) via `profile-pin:*` policy records.

## Storage strategy (no new resourceType)
Do not add a new config resource type for `multi_agent`.

Store the agent registry as a **policy** record:

- `resourceType: "policy"`
- `resourceId: "agent-registry:default"`

The record value is JSON with schema below.

Rationale:
- `policy` is already a supported resource type.
- It avoids expanding `CONTROL_PLANE_RESOURCE_TYPES` just for registry metadata.
- It can still be allowlisted in Web UI and chat commands.

## Agent registry JSON schema (versioned)
```json
{
  "version": 1,
  "agents": [
    {
      "agentId": "@writer",
      "profileId": "profile:writer:v1",
      "description": "Writes clear, human-sounding docs and messages. Prioritises structure and tone.",
      "defaultForwardSkills": ["skill:writing_helpers"],
      "allowedForwardSkills": ["skill:writing_helpers", "skill:formatting"],
      "defaultMcpServers": ["mcp:docs"],
      "allowedMcpServers": ["mcp:docs", "mcp:web"],
      "tags": ["writing", "docs"]
    }
  ]
}
```

Rules:
- `version` required.
- `agentId` must match `^@[a-z0-9_\-]{2,32}$`.
- `profileId` must reference an existing `profile` config record.
- Descriptions must be short (<= 300 chars).
- Arrays are optional; if omitted, assume empty.

## How agent profiles are presented to the model
The orchestrator must include a stable list of available agent profiles in the system/developer context, similar to how skills are listed.

Format:
- agentId
- description
- optional tags

Do not include:
- provider keys
- internal policy ids
- anything sensitive

## Delegation contract (code-enforced)
When the model (or a routing policy) chooses to delegate:
- It selects an `agentId` from the registry.
- Runtime resolves `agentId → profileId`.
- Runtime runs a nested orchestration turn with:
  - `profileId` pinned for that call only (do not mutate session pin unless user asked)
  - allowed skills = intersection of:
    - parent allowed skills
    - delegated profile allowed skills
    - forward skill allowlist from registry (if present)
  - model policy enforced from delegated profile (providerId + modelId)
- Any `model_override` proposed by the model must be clamped to:
  - the delegated profile allowlist, and/or the global allowlist

## Pinning (session/user/global)
Pinning selects the default profile used for normal orchestration turns.

Existing pin policy ids:
- `profile-pin:session:<sessionId>`
- `profile-pin:workspace:<workspaceId>`
- `profile-pin:global`

Pin policy value:
```json
{ "profileId": "<profileId>" }
```

Chat command `/agents pin <agentId>` must:
1) Resolve agentId → profileId via registry
2) Write the appropriate pin policy record (`session` by default)
3) Confirm to user what is pinned and scope

Unpin removes the policy record.

## Chat-based configuration
Agent registry must be manageable via deterministic chat commands (operator/admin gated):
- `/agents register <agentId> | <profileId> | <description>`
- `/agents unregister <agentId>`
- `/agents` and `/agents show <agentId>` (public read)

Pinning commands can be public for own scope:
- `/agents pin <agentId> [--session|--user]`
Global pin is operator/admin only.

See `docs/specs/CHAT_COMMANDS.md`.

## Web UI configuration
Web UI may expose:
- list agent profiles
- edit agent registry JSON in a safe editor (operator)
- show current effective pins

Web UI must not allow arbitrary policy edits beyond allowlisted ids.

## Acceptance criteria
- Agent registry is stored in `policy:agent-registry:default`.
- Orchestrator always has agent list in context.
- Delegation enforces pinned delegated profile model policy and allowed skills.
- Chat commands can register/unregister agents and pin/unpin for session/user/global (with gating).
- Tests cover:
  - registry schema validation
  - pin resolve agentId → profileId
  - delegation clamps model override

## Agent checklist
- Check `AGENTS.md` first.
- Read the last 150 lines of `docs/IMPLEMENTATION_LOG.md` before starting.
- Write a log entry using the agreed template when done.
