# Phase 2 - Stage 6: Integrations Expansion

## Goal
Deepen the library of available skills and connectors to provide real user value.

## 1. Advanced Connectors
Implement complex logic for high-value services.

### Gmail (Advanced)
*   **Field Filtering**: Return headers and snippets by default. Full body requires higher privilege.
*   **Drafts**: `gmail.create_draft` instead of sending immediately.
*   **Search**: `gmail.search` with strict query parsing (no injection).

### Home Assistant (Advanced)
*   ** Service Allowlist**: Only allow safe services (`light.turn_on`) by default. Block critical ones (`lock.unlock`, `climate.set_temp`) unless explicitly granted.
*   **State Querying**: `ha.get_state(entity_id)` with caching.

## 2. File Workflows
Enhance the Filesystem connector.
*   **Summarization**: Skill template `summarize_directory`.
*   **Documentation**: Skill template `generate_readme`.
*   **Safety**: Ensure these workflows respect `.gitignore` and max file size limits.

## 3. Skill Packs
Package these connectors into user-facing Skills.
*   "Office Assistant": Calendar + Email.
*   "Code Helper": Git + Filesystem.
*   "Home Controller": Home Assistant.

## Acceptance Criteria
- [ ] Gmail connector can read snippets without exposing full bodies.
- [ ] Home Assistant connector can toggle a light but denies unlocking a door (by default).
- [ ] A "Summarize Folder" skill works end-to-end on a local directory.
