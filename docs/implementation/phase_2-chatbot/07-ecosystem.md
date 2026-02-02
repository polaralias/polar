# Phase 2 - Stage 7: Ecosystem Hardening

## Goal
Prepare the system for distribution and third-party skills by implementing cryptographic trust and recovery mechanisms.

## 1. Skill Signing & Provenance
Implement a mechanism to verify the **Entire Skill Package**.
*   **Hashing**: Compute SHA-256 (or Merkle root) of `polar.skill.json` + `SKILL.md` + `assets/`.
*   **Signing**: Verify `signature.json` against known public keys.
*   **Verification**: Occurs on Install AND on Load (TOCTOU protection).
*   **Policy**: "Allow Signed Only" (Default) vs "Developer Mode" (Allow Unsigned Local).

## 2. Update Safety
*   **Pinning**: Installs are pinned to `(ID, Version, Hash)`.
*   **Permission Diff**:
    *   If `requested_capabilities` changes -> **Re-consent Required**.
    *   If `SKILL.md` hash changes -> **"Behavior Changed" Warning**.
*   **Rollback**: Keep previous version bundle for instant revert.

## 3. Emergency Mode (The "Kill Switch")
A global switch in the UI/Gateway.
*   **Effect**:
    *   Disable ALL non-system skills.
    *   Revoke ALL active capability tokens (immediate token rejection at Gateway).
    *   Set Gateway to "Read-Only" (deny all write verbs globally).
*   **Use Case**: User suspects a skill is misbehaving or exfiltrating data.

## 4. Exportable Audit
Allow users to take their data.
*   **Format**: JSON/CSV export of the Audit Log.
*   **Redaction**: Exported logs must respect the same redaction rules as internal logs (no secrets).

## Acceptance Criteria
- [ ] Modifying `SKILL.md` on disk causes a hash mismatch and prevents loading.
- [ ] Installing an update triggers a re-consent flow if permissions expand.
- [ ] Emergency Mode immediately stops an active worker (token rejection).
- [ ] Audit logs export contains redacted tool inputs/outputs.
