# Memory Security and Access Control

Memory is a primary security boundary in Polar. Access to memory is governed by the same "deny-by-default" and "explicit-grant" principles as system tools.

## Identity and Ownership

*   **Principal**: Every memory item is owned by a User (Subject).
*   **Access Context**: Access is determined by the combination of the **requester identity** (Agent/Skill ID) and the **active context** (Session/Project ID).

## Access Control Matrix (Defaults)

| Actor | Profile Memory | Project Memory | Session Memory | Tool-Derived |
| :--- | :--- | :--- | :--- | :--- |
| **Main Agent** | Read (Explicit Grant) | Read/Write Proposal (Attached) | Read/Write Proposal (Current) | Read (Attached) |
| **Skill/Worker** | None | Scoped Read (Proposal) | Scoped Read (Proposal) | Read/Write Proposal (Owned) |
| **Installer** | None | None | None | None |
| **User (UI)** | Full Control | Full Control | Full Control | Full Control |

### Explicit Permissions
Permissions for memory are defined in the Policy Store:
*   `read:memory:profile`: Allows reading non-sensitive profile fragments.
*   `read:memory:project:<id>`: Allows reading context for a specific project.
*   `propose:memory:session`: Allows suggesting short-lived updates.

## Security Invariants

1.  **No Cross-User Access**: It is impossible for an agent acting for User A to read or write memory belonging to User B.
2.  **No Unmediated Memory**: No component (other than the runtime core) may bypass the proposal/query system to access the underlying storage.
3.  **Isolation by Scope**: Agents attached to Project A cannot query Project B memory unless an explicit cross-project capability is granted.
4.  **Fail-Closed on Expiry**: An item is considered inaccessible the moment `expiresAt` is reached, regardless of whether the cleanup job has purged it yet.
5.  **Audit Integrity**: Unauthorized memory access attempts must be logged as high-priority security events.

## Redaction and Sensitivity

Memory items can be tagged with sensitivity levels:
*   **Low**: General context, safe for most sub-agents.
*   **Moderate**: Contains project specifics; filtered for generic workers.
*   **High**: Sensitive user facts; requires explicit "Thinking" or elevation by the user to be revealed.

The runtime view layer (for agents) automatically hides or masques high-sensitivity content unless the session holding the capability token has the required clearance.

## Deletion Enforcement

When a user deletes a memory item:
1.  It is removed from the active database.
2.  If vector indexes are used, the corresponding document ID is deleted from the index.
3.  The runtime invalidates any cached summaries that might have included that item.
4.  An audit trail registers the deletion, but the *content* of the deleted item is NOT preserved in the audit log (only its ID and type).
