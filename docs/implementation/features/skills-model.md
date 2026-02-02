# Skills Model

This document defines how Polar extends its functionality through Skills while maintaining a "hostile by default" security posture.

## What is a Skill?

A Skill is a package of **worker templates** that provide specific capabilities to the agent. It is the unit of delegation and permission management.

### Properties
- **Isolated**: Skills run in constrained worker processes.
- **Permission-Bound**: No skill can act without explicit, user-granted permissions.
- **Inspectable**: All skill metadata, requested permissions, and activities are visible.
- **Static**: Skills declare their requirements upfront; they cannot "discover" or "claim" new permissions at runtime.

### A Skill is NOT:
- A long-running independently authoritative agent.
- A holder of secrets or long-lived credentials.
- A policy decision-maker.

---

## Skill Manifest Contract

Every skill must include a `manifest.json` that defines its identity and requirements.

### Schema (Conceptual)
```json
{
  "id": "io.polar.skills.file-utils",
  "name": "File Utilities",
  "version": "1.0.0",
  "description": "Basic file operations like searching and summarizing.",
  "workerTemplates": [
    {
      "id": "summarizer",
      "name": "File Summarizer",
      "description": "Reads a file and provides a summary.",
      "input": { "path": "string" },
      "output": { "summary": "string" },
      "requiredCapabilities": ["fs.readFile"]
    }
  ],
  "requestedCapabilities": [
    {
      "connector": "fs",
      "action": "fs.readFile",
      "resource": { "type": "fs", "root": "/data/docs" },
      "justification": "Required to read documents for summarization."
    }
  ]
}
```

### Manifest Rules
1.  **Immutability**: Once installed, a skill's manifest is considered frozen for that version.
2.  **Explicit Grants**: Only permissions listed in `requestedCapabilities` can be granted to the skill.
3.  **Narrow Scoping**: Skills should request the minimum necessary scope (e.g., a specific root directory rather than `/`).

---

## Skill Lifecycle

1.  **Installation**:
    - The `Skill Installer` (a quarantined worker) validates the manifest schema and integrity.
    - Metadata is registered with the Runtime.
    - The skill is initially **Disabled** and has **No granted permissions**.
2.  **Authorization**:
    - The User reviews the `requestedCapabilities` in the UI.
    - The User grants some or all of the requested permissions.
    - Runtime updates the `Policy Store` with grants tied specifically to the Skill ID.
3.  **Enablement**:
    - The Skill is enabled by the User.
4.  **Execution**:
    - When the Agent needs a tool, the Runtime spawns a worker based on a `workerTemplate`.
    - The Runtime mints a capability token for that specific worker instance, narrowed to the intersection of the template's needs and the skill's grants.
5.  **Revocation/Uninstallation**:
    - User can revoke permissions or disable the skill at any time.
    - Runtime immediately invalidates future token minting for that skill.
    - Audit records the lifecycle event.

---

## Permission Diffs

When a skill is upgraded (version bump), the Runtime computes a diff between the old and new `requestedCapabilities`. Any increase in authority requires explicit re-consent from the User.
