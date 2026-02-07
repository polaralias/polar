# Phase 2 - Stage 2: Connectors (Typed Integrations)

## Phase 1 Foundation
This stage utilizes the infrastructure established in Phase 1:
- **Gateway Enforcement**: Request interception logic and token validation.
- **Tool Introspection**: Mechanism for workers to query allowed methods.
- **Rate Limiting**: Framework for per-session and per-token request caps.

## Goal
Build the first set of "Real" integrations using the **Connector** pattern. This stage addresses a **CRITICAL GAP from Phase 1: Egress Control (HTTP host allowlists)**.

## Implementation Status (as of February 7, 2026)
**Status**: Complete

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
- [x] Gateway runs as a separate logical boundary (enforcing constraints).
- [x] HTTP connector respects host allowlists.
- [x] Sensitive outputs (secrets) are redacted from logs and agent context.
- [x] Users can configure "Require Approval" for specific tools/connectors.
- [x] Audit logs record the *sanitized* request and the decision.
- [x] First major typed integration is implemented (`github.repo` issues list/get with runtime-injected credentials).

## Pending Implementation Gaps (as of February 7, 2026)
- No blocking gaps remain for Stage 2 acceptance.
- Connector-level `requires_confirmation` configuration is implemented in policy and UI grant workflows.
- `github.repo` is implemented as the first typed provider integration; Google connector expansion is deferred to later stages.

## Deferred from Phase 1 (Hardening)
- **Advanced Egress (DNS/IP)**: Implement deep network enforcement at the DNS and IP levels to prevent DNS rebinding attacks or direct IP exfiltration.
- **Egress Allowlists**: Refine the manifest-based allowlist system to support granular domain and path-level approvals for all external tool-driven traffic.
