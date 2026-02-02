# Phase A: Skills & Templates

## Goal
Turn the manifest concept into the thing that makes Polar feel like an assistant. Enable safe local skill installation and execution via strictly defined templates.

## 1. Skill Package Format (Local-First)
A skill directory (zip or folder) contains:
*   `polar.skill.json` (manifest, strict schema)
*   `templates/` (worker templates definitions, JSON)
*   `prompts/` (optional prompt fragments)
*   `ui/` (optional UI metadata, not executable code)
*   `bin/` (optional: CLI wrapper metadata, not binaries by default)

**Constraint:** No arbitrary code execution in Stage 1. If code is supported later, it must run in a sandboxed worker container.

## 2. Worker Templates
Make templates the unit of execution.
Example templates: `calendar.list_upcoming`, `gmail.search`, `homeassistant.turn_on_light`.

A template defines:
*   `id`, `description`
*   Input schema (Zod/JSON schema)
*   Output schema
*   Required capabilities (connector/action/resource constraints)
*   Tool sequence (one or more tool calls)
*   Optional guardrails (max results, time window, field allowlist)

**Constraint:** Templates must be declarative. No “do anything” template.

## 3. Skill Lifecycle & Installer
### Lifecycle
1.  **Install** (validate manifest and template schemas)
2.  **Disable** by default until permissions granted
3.  **Grant Permissions** (user consent flow)
4.  **Enable**
5.  **Run Templates** (runtime spawns a worker constrained to that template)
6.  **Upgrade** (diff, re-consent if expanded)
7.  **Revoke/Disable/Uninstall**

### Installer Responsibilities (Quarantined)
The installer performs **only**:
*   Schema validation
*   Provenance checks (hash/signature)
*   Registration into runtime skill store
*   Extraction into skill directory

It does **not**:
*   Call connectors
*   Run CLIs
*   Fetch remote deps

## 4. UI Implementation
### Permissions UX
Show:
*   Requested capabilities per template
*   Granted capabilities per template/skill
*   Diffs on upgrades
*   One-click revoke (triggers revocation mechanics)

### Skill Management UI
*   Browse installed skills
*   See templates and requested permissions
*   Test a template with safe inputs
*   Upgrade/downgrade with diffs

## 5. Implementation Steps
1.  **Skill Manifest & Schema**: Finalize the strict schema for `polar.skill.json` and templates.
2.  **Installer**: Implement the safe installer logic (validation, registration).
3.  **Template Runner**: Implement the runtime service to execute templates (spawn worker, enforce partial capabilities).
4.  **UI - Skill Management**: Build the views for installing, enabling, disabling, and viewing skills.
5.  **UI - Permission Grant**: Build the user consent flow for granting capabilities.
6.  **Job Tracking**: Add template execution endpoint and tracking.

## Acceptance Criteria
- [ ] User can install a skill (validates manifest).
- [ ] Skill is initially disabled.
- [ ] User can view requested permissions and grant them.
- [ ] User can run a specific template:
    - [ ] Runtime spawns worker.
    - [ ] Worker is constrained to the template's tool sequence.
- [ ] Revoking permissions immediately blocks writes and bounds reads.
