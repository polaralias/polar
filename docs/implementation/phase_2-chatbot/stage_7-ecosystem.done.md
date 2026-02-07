# Phase 2 - Stage 7: Ecosystem Hardening

## Goal
Prepare the system for distribution and third-party skills by implementing cryptographic trust and recovery mechanisms.

## Implementation Status (as of February 7, 2026)
**Status**: Complete

## Phase 1 Foundation
The following features are **already implemented** in Phase 1:

| Feature | Status | Location |
|---------|--------|----------|
| Skill bundle hashing (SHA-256) | ✅ | `installerService.ts` |
| Emergency mode | ✅ | `POST /system/emergency` |
| Permission diff on update | ✅ | `calculatePermissionDiff` |
| Skill uninstall | ✅ | `DELETE /skills/:id` |
| Audit export | ✅ | `GET /audit/export` |
| Signature verification | ✅ | `skillStore.ts` (basic) |

Phase 2 builds on this foundation with additional hardening.

---

## 1. Skill Signing & Provenance (Phase 2 Enhancements)
Implement **full** verification of the **Entire Skill Package**.

*   **Full-Archive Hashing**: Compute SHA-256 (or Merkle root) of `polar.skill.json` + `SKILL.md` + `assets/`.
*   **TOCTOU Protection**: Verify hash on **Load** (not just Install) to detect tampering.
*   **Policy Modes**: 
    *   "Allow Signed Only" (Default for production)
    *   "Developer Mode" (Allow Unsigned Local for testing)

## 2. Update Safety (Phase 2 Enhancements)
*   **Pinning**: Installs are pinned to `(ID, Version, Hash)`.
*   **Permission Diff** (Phase 1 provides base):
    *   If `requested_capabilities` changes → **Re-consent Required**.
    *   If `SKILL.md` hash changes → **"Behavior Changed" Warning**.
*   **Rollback**: Keep previous version bundle for instant revert.
    *   Store in `storage/skills/<id>/versions/<version>/`
    *   Provide `POST /skills/:id/rollback` endpoint.

## 3. Emergency Mode (Phase 1 Provides)
Phase 1 implements the core emergency mode. Phase 2 enhances the UI.

*   **Phase 1 Provides**:
    *   `POST /system/emergency` — Toggle mode
    *   Gateway blocks all tool calls in emergency mode
    *   Skill status set to `emergency_disabled`
    *   New sensitive actions are blocked while mode is active

*   **Phase 2 Adds**:
    *   Kill-switch controls in Overview UI for enabling/disabling emergency mode
    *   Visual status indicators for emergency vs normal mode
    *   Recovery wizard to selectively re-enable `emergency_disabled` skills (`POST /system/emergency/recover`)

## 4. Exportable Audit (Phase 1 Provides)
Phase 1 implements export functionality. Phase 2 ensures compliance.

*   **Phase 1 Provides**:
    *   `GET /audit/export?format=json|ndjson|csv`
    *   Date range, subject, tool filters
    
*   **Phase 2 Adds**:
    *   Continued redaction-safe export handling and operator visibility in UI workflows
    *   Scheduled export to external storage remains optional and deferred

## Acceptance Criteria
- [x] Modifying `SKILL.md` on disk causes a hash mismatch and prevents loading.
- [x] Installing an update triggers a re-consent flow if permissions expand.
- [x] Emergency Mode immediately stops an active worker (token rejection).
- [x] Audit logs export contains redacted tool inputs/outputs.
- [x] Skill uninstall removes from policy and optionally deletes files (Phase 1).
- [x] Audit export supports multiple formats (Phase 1).
- [x] Trust-store and signing policy controls are available in Overview UI.
- [x] Emergency recovery workflow is available in Overview UI.

## Deferred from Phase 1 (Hardening)
- **Skill Rollback**: Implement full version history and rollback capability, allowing users to revert to a known good version of a skill.
- **Update Audit History**: Ensure that skill updates (including the permission diff) are explicitly recorded in the audit trail with version details.
- **Token Replay Hardening**: Implement "First-Use Tracking" for high-sensitivity tokens to prevent reuse even within the JTI lifespan.

## Validation Snapshot
- `pnpm --filter @polar/runtime build` ✅
- `pnpm --filter @polar/gateway build` ✅
- `pnpm --filter @polar/ui build` ✅
- `pnpm --filter @polar/runtime test` ✅

