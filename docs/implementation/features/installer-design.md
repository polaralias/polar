# Skill Installer Design

The Skill Installer is a specialized, quarantined worker responsible for bringing new functionality into the Polar environment safely.

## Principles

1.  **Quarantined**: The installer runs with minimal system access. It cannot call general tools, access the network, or read secrets.
2.  **Stateless**: It does not persist its own state; it only returns validated metadata to the Runtime.
3.  **Schema Enforcement**: It is the first line of defense against malformed or malicious manifests.

---

## Installer Scope

The installer is granted a temporary capability token with:
- **Action**: `skill.install`
- **Resource Constraints**:
    - `fs`: Read access to the incoming bundle path.
    - `fs`: Write access to the system `skills/` directory (scoped by Runtime).

---

## Installation Process

1.  **Stage (Runtime)**: Runtime receives a skill bundle (e.g., zip or folder) and places it in a temp directory.
2.  **Spawn (Runtime)**: Runtime spawns the Installer worker.
3.  **Validate (Installer)**:
    - Locates `manifest.json` or `polar.skill.json`.
    - Validates against the `SkillManifestSchema` (Zod).
    - Checks that all `requestedCapabilities` are valid and expressible in the Polar policy model.
4.  **Extract (Installer)**:
    - Copies approved files to a sub-directory in the `skills/` folder named after the skill ID.
    - If `polar.skill.json` was used, it is renamed to `manifest.json` in the destination.
5.  **Report (Installer -> Runtime)**:
    - Returns the parsed manifest and the destination path to the Runtime.
6.  **Register (Runtime)**:
    - Runtime updates the Skill registry and emits an audit event.

---

## Error Handling

| Scenario | Result |
| --- | --- |
| Missing `manifest.json` / `polar.skill.json` | Rejection |
| Invalid JS in worker | Rejection (on spawn, not install) |
| Manifest requested `*` path | Rejection (or flagged for high-risk UI) |
| Version mismatch | Flagged for User |
| Installer process crash | Fail-Closed (no files registered) |

---

## Explicit Non-Goals
- **Dependency Resolution**: Installer does NOT run `npm install`. Skills must be bundled with their dependencies or use only standard Polar libraries.
- **Verification of Code Safety**: The installer validates the *manifest*, not the *code*. Code safety is enforced at runtime by the Gateway and worker process isolation.
