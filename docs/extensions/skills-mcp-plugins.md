# Skills, MCP, And Claude Plugins

Last updated: 2026-02-22

## Extension Philosophy

Skills, MCP servers, and Claude plugins are different packaging formats for the same runtime concept: contract-validated capabilities executed through one policy path.

## Chat-First Extension Management

Extension lifecycle is managed through:

1. Chat commands.
2. Management API.
3. Polar Web UI.

The runtime writes typed extension state to persistent stores. Manifest files are inputs, not final authority.

## `SKILL.md` Support

Polar supports importing and installing skill packages that follow the agent skills standard.

Install flow:

1. Read and parse `SKILL.md`.
2. Verify source provenance (trusted source policy, signature/hash, pinned revision when remote).
3. Analyze declared capabilities and requested permissions.
4. Validate template input and output contracts.
5. Register callable operations in the contract registry.
6. Require explicit trust and permission approval before enablement.

Operational controls:

1. Install
2. Enable or disable
3. Upgrade and rollback
4. Remove
5. Re-review trust level and permissions

## Skill Safety Guardrails

1. Skills are treated as untrusted until reviewed.
2. Permission deltas are shown on install and upgrade.
3. High-risk capabilities require explicit approval policies.
4. Sandboxed runtime mode is available for untrusted skills.
5. Skill execution still passes tool middleware and contract checks.

## MCP Server Support

MCP integrations are first-class runtime-managed providers.

Connection flow:

1. Register server endpoint and auth material.
2. Probe and validate server health.
3. Import tool catalog.
4. Map imported operations to local contract wrappers.
5. Apply trust and policy constraints before use.

Each MCP-backed operation is audited exactly like a native tool.

## Dev-Only MCP Harness Integrations

Some MCP integrations are approved only for development harness use (for example Chrome DevTools MCP for automated browser testing).

Rules:

1. Dev-only MCP harness integrations are not user-installable runtime extensions.
2. They run only in development and CI environments with scoped test credentials.
3. They must target explicit non-production endpoints and approved allowlists.
4. Harness outputs are test artifacts and cannot trigger production side effects.
5. Promotion to end-user runtime capability requires explicit trust, policy, and architecture review.

*(Note: These dev-only restrictions are currently documentation-led process guidelines. Explicit runtime denylist enforcement is missing in code.)*

## Claude Plugin Support

Claude plugin installation follows the same governance model:

1. Parse plugin descriptor.
2. Convert callable operations into contract-registry entries.
3. Bind auth credentials securely.
4. Enforce policy and schema validation on every call.
5. Emit standardized tool audit events.

No plugin receives direct execution privileges outside the contract/policy stack.

## Unified Trust Levels

Every extension source is assigned one trust level:

1. `trusted`
2. `reviewed`
3. `sandboxed`
4. `blocked`

Trust level affects capability scope, approval requirements, and runtime isolation.

## Foundation Reuse Boundaries

1. `pi-mono` patterns inform parser and lifecycle implementation details.
2. OpenClaw ecosystem lessons inform source-hardening and visibility expectations.
3. Polar adds mandatory output contracts, trust policy gates, and non-bypassable middleware for production.
