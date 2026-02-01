# Update Model

## Overview

Updates in Polar are explicit state transitions. We reject "silent replacement" of code or permissions. Every update must be reviewable, reversible, and auditable.

## Skill Updates

When a new version of a skill is provided to the Runtime:

1.  **Side-by-side Installation**: The new version is staged alongside the old version.
2.  **Permission Analysis**: The Runtime compares the manifest of the current version with the new version.
3.  **Diff Computation**: A human-readable diff of permission changes is generated.
4.  **Consent Flow**:
    - **No Change / Decrease**: The update is applied with a visible notice in the UI.
    - **Increase / Broadening**: The user must explicitly approve the new permissions before the update is finalized.
5.  **Activation**: Once approved (or if no approval is needed), the Runtime swaps the active version.
6.  **Rollback**: The Runtime retains the previous version's metadata and (optionally) the bundle to allow for immediate rollback if issues are detected.

## Core/Runtime Updates

Updating the Polar system itself follows a more rigorous process:

1.  **Audit Snapshot**: An immutable snapshot of the current state and audit log is taken.
2.  **Schema Migration**: Versioned database migrations are applied to the Policy Store and Audit Log.
3.  **Backward Compatibility**: The new runtime must continue to respect capability tokens minted by the previous version until they expire or are rotated.
4.  **Rollback Plan**: Every core update must include a documented procedure for reverting to the previous version and restoring the state from the snapshot.

## Permission Diffs

Permission diffs are first-class objects used in the UI and stored in the audit log.

A diff highlights:
- `Added`: New capabilities or resource types.
- `Removed`: Capabilities no longer requested.
- `Changed`: Modifications to constraints or scopes (e.g., widening `fs.read("/tmp")` to `fs.read("/")`).

## Acceptance Criteria

- [ ] Updating a skill never silently increases authority.
- [ ] Downgrades/Rollbacks are supported and auditable.
- [ ] Audit log captures the full update history and permission diffs.
