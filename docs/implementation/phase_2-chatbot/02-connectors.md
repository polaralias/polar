# Phase 2 - Stage 2: Connectors (Typed Integrations)

## Goal
Build the first set of "Real" integrations using the **Connector** pattern. Connectors are **Gateway Services** that enforce policy before executing code.

## 1. Connector Architecture
Connectors are distinct form the Agent Worker. The Worker *requests*, the Gateway *decides & executes*.

### Requirements
*   **Strict Zod Schema**: Input and Output must be validated.
*   **Structured Constraints**: Capabilities define complex rules, not just resource IDs.
    *   *Example*: `fs.read` -> `{ allow_roots: ["/tmp"], max_size: 1024 }`
*   **Enforcement Middleware**:
    *   **Token Verification**: Check Macaroon-style constraints.
    *   **Sanitization**: Input validation.
    *   **Redaction**: Output filtering (remove secrets/body).
    *   **Rate Limits**: Per-user/session enforcement.
*   **Human Approval**: Support `requires_confirmation` flag in the capability.

### Credentials
*   Stored in **Runtime Secrets Store**.
*   Never exposed to the Agent.
*   Gateway injects credentials at the last mile (SDK call).

## 2. Implementation: HTTP Connector
A generic but safe HTTP client.

*   **Tools**: `http.request`.
*   **Capability**: `net.egress`.
*   **Constraints**:
    *   `allow_hosts`: List of hostnames (e.g., `["*.github.com"]`).
    *   `allow_methods`: List (e.g., `["GET"]`).
    *   `allow_headers`: Allowlist of headers.
*   **Rule**: Skills with sensitive access (e.g., Email) should generally NOT have wild card `net.egress`.

## 3. Implementation: First Major Integration
Choose **ONE** to implement first:

### Option A: Google Calendar & Gmail
*   **Tools**: `gcal.list`, `gcal.create`, `gmail.search`.
*   **Capability**: `google.calendar`, `google.mail`.
*   **Constraints**:
    *   `allow_calendars`: List of IDs.
    *   `allow_labels`: List of Gmail labels.
    *   `deny_body`: `true` (metadata only).
    *   `requires_confirmation`: `true` for `gcal.create`.

### Option B: GitHub
*   **Tools**: `github.issues.list`, `github.issues.get`.
*   **Capability**: `github.repo`.
*   **Constraints**:
    *   `allow_repos`: List (`owner/name`).
    *   `read_only`: `true`.

## 4. Setup Wizard UX
Create a UI flow for configuring connectors.

*   **Authentication**: Input API Key or trigger OAuth.
*   **Discovery**: "Test Connection" button.
*   **Constraint Configuration**:
    *   "Restrict to these repositories:" (Multi-select).
    *   "Require approval for writes?" (Toggle).
*   **Grant Mapping**: Saves structured constraints to `PolicyStore`.

## Acceptance Criteria
- [ ] Gateway runs as a separate logical boundary (enforcing constraints).
- [ ] HTTP connector respects host allowlists.
- [ ] Sensitive outputs (secrets) are redacted from logs and agent context.
- [ ] Users can configure "Require Approval" for specific tools/connectors.
- [ ] Audit logs record the *sanitized* request and the decision.

## Deferred from Phase 1 (Hardening)
- **Advanced Egress (DNS/IP)**: Implement deep network enforcement at the DNS and IP levels to prevent DNS rebinding attacks or direct IP exfiltration.
- **Egress Allowlists**: Refine the manifest-based allowlist system to support granular domain and path-level approvals for all external tool-driven traffic.
