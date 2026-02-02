# Phase B: Connectors (Real Integrations)

## Goal
Establish the pattern for reliable, typed "Integrations" using connectors. The assistant must call *typed tools*, not follow long text instructions.

## 1. Connector Implementation Pattern
Each connector is exposed as a set of **typed tool endpoints** in the gateway (HTTP or MCP).

### Tool Requirements
*   Strict request schema (Zod/JSON Schema).
*   Strict response schema.
*   Field filtering and resource enforcement.
*   Capability validation and optional introspection.
*   Audit emission.

### Examples
*   **Google Calendar**: `calendar.list_calendars`, `calendar.list_events`, `calendar.create_event`
*   **Gmail**: `gmail.search_threads`, `gmail.get_thread`, `gmail.send_message`
*   **Home Assistant**: `ha.call_service`, `ha.get_states`

## 2. Security & Credentials
### Credential Model
*   Credentials live in the **Runtime Secrets Store**.
*   **Gateway never receives raw OAuth refresh tokens** (unless it's the enforcement boundary).
*   Prefer: Runtime stores secrets -> Gateway requests short-lived access tokens from Runtime.
*   Capabilities never embed secrets.

### Fine-Grained Permissions
Most upstream APIs are coarse (scope-level). Polar must enforce finer boundaries by:
*   **Filtering results**: Deny specific calendar IDs, labels, folders.
*   **Constraining queries**: Enforce time windows, max counts, allowed fields.
*   **Stripping sensitive fields**: Remove body, attendees, notes from responses if not authorized.

## 3. Implementation Steps
1.  **HTTP Connector**: Build a generic HTTP connector with egress allowlist and logging.
2.  **First Integration**: Build a single external integration (Recommended: **GitHub** or **Google Calendar**) using the typed tool pattern.
3.  **Skill Pack**: Build a small skill pack on top of this integration (e.g., "List my PRs" or "Show my agenda").
4.  **Integration Setup UI**:
    *   Setup wizard.
    *   Test connection.
    *   Show accessible resources.
    *   Grant permission scopes clearly.

## Acceptance Criteria
- [ ] HTTP Connector implemented with egress control.
- [ ] One "Real" Integration (GitHub/Google) working via typed tools.
- [ ] "Allow X deny Y" is demonstrable (e.g., allow specific repo, deny others).
- [ ] OAuth flow or API Key entry works securely via Runtime Secrets Store.
- [ ] Audit logs show the exact tool calls made by the connector.
