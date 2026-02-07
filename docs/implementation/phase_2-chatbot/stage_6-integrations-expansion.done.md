# Phase 2 - Stage 6: Integrations Expansion

## Goal
Deepen the library of available skills and connectors to provide real user value.

## Implementation Status (as of February 7, 2026)
**Status**: Complete

## 1. Advanced Connectors
Implement complex logic for high-value services.

### Gmail (Advanced)
*   **Field Filtering**: Implemented as snippet/header-first responses. Full body is gated behind connector constraints (`allowBody`).
*   **Drafts**: Implemented as `create_draft` flow only; no direct send path exposed.
*   **Search**: Implemented with strict parser (`parseSafeGmailQuery`) and constrained arguments.

### Home Assistant (Advanced)
*   **Service Allowlist**: Implemented with safe defaults (`light/switch` toggles), explicit deny list for sensitive services, and optional capability constraints.
*   **State Querying**: Implemented via `state.get` with short-lived state caching in gateway.

## 2. File Workflows
Enhance the Filesystem connector.
*   **Summarization**: Implemented as `/tools/fs.workflow` action `summarize_directory`.
*   **Documentation**: Implemented as `/tools/fs.workflow` action `generate_readme`.
*   **Safety**: Workflow file scan respects `.gitignore` patterns and enforces max-file/max-size bounds.

## 3. Skill Packs
Package these connectors into user-facing Skills.
*   **Office Assistant**: Added under `examples/skill-packs/office-assistant`.
*   **Code Helper**: Added under `examples/skill-packs/code-helper` with worker entrypoint using `fs.workflow`.
*   **Home Controller**: Added under `examples/skill-packs/home-controller`.

## Implemented Endpoints and Runtime Wiring
- `POST /tools/google.mail` (gateway): `search`, `get`, `create_draft`, label/body constraints, safe query parsing, audited approvals.
- `POST /tools/home.assistant` (gateway): `state.get`, `services.call`, allowlists/deny lists, entity scoping, caching, audited approvals.
- `POST /tools/fs.workflow` (gateway): `summarize_directory`, `generate_readme` with constrained scanning and summaries.
- Runtime connector credential mapping extended with `home.assistant` (`CONNECTOR_HOME_ASSISTANT_TOKEN`).
- Worker runtime now injects `POLAR_GATEWAY_URL` and `POLAR_AGENT_METADATA` for packaged worker execution.

## Acceptance Criteria
- [x] Gmail connector can read snippets without exposing full bodies.
- [x] Home Assistant connector can toggle a light but denies unlocking a door (by default).
- [x] A "Summarize Folder" skill works end-to-end on a local directory.

## Validation Snapshot
- `pnpm --filter @polar/gateway build` ✅
- `pnpm --filter @polar/runtime build` ✅
- `pnpm --filter @polar/ui build` ✅
- `pnpm --filter @polar/runtime test` ✅
