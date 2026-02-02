# Permissions UI Design

The Permissions UI is the user's control plane for governing what Polar can do. In Stage 2, it is expanded to support Skill-based permissions and explicit consent flows.

## Core Views

### 1. Skill Library Page
- **List of Skills**: Shows installed skills with ID, name, version, and status (Active/Disabled/Pending Consent).
- **Skill Detail**:
    - Description.
    - List of worker templates (tools) provided.
    - **Current Permission Status**: Comparison of requested vs granted.
    - **Enable/Disable** toggle.
    - **Revoke/Grant** buttons for individual capabilities.

### 2. Install / Consent Modal
When a new skill is installed or an existing one is upgraded:
- **Diff View**: Clearly shows any new permissions being requested.
- **Justification**: Displays the "justification" field from the manifest for each permission.
- **Explicit Action**: User must click "Grant and Enable" to authorize the new capabilities.

### 3. Permission Manager (Admin View)
- Focused list of all active Grants.
- Categorized by Subject (Skill ID, Session ID, or User).
- **Quick Revoke**: One-click revocation that triggers an audit event.

---

## UI Interactions

### Revocation Flow
1. User clicks "Revoke" on a Skill's permission.
2. UI calls Runtime `POST /permissions/revoke`.
3. Runtime:
    - Updates policy.
    - (Optionally) Increments policy version.
    - Mints an audit event.
4. UI updates status immediately.

### Diff Calculation
- New Skill: All requested permissions are "New".
- Upgrade:
    - **Added**: Permissions in new version not in old.
    - **Modified**: Permissions with broader scope (e.g., `/data` instead of `/data/logs`).
    - **Removed**: Permissions no longer requested.

---

## Invariants in UI
- **No Wildcard Hidden**: UI must never hide `*` grants or broad roots. They should be visually highlighted (e.g., in red or with a warning icon).
- **Audit Proximity**: Every permission change in the UI should link to the corresponding audit entry, helping the user understand *why* they are seeing a change.
