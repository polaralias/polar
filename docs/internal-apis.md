# Internal API Contracts

This document defines the authoritative interfaces between Polar components. These contracts are frozen as of Stage 1.

## Runtime APIs

The Runtime is the authoritative kernel. Its APIs are used by the UI and the Gateway (for auditing).

### 1. Session Management
- **POST `/sessions`**
  - **Description**: Creates a new agent session.
  - **Effect**: Initializes a session with a unique ID and a default subject.
  - **Output**: `{ session: { id: string, subject: string } }`

### 2. Message Ingestion
- **POST `/sessions/:id/messages`**
  - **Description**: Proposes a message/action from an agent within a session.
  - **Input**: `{ message: string }`
  - **Security**: Evaluates the proposed action against policy. If allowed, mints a capability token and calls the Gateway.
  - **Output**: Result of the tool call or error.

### 3. Permission Management
- **GET `/permissions`**
  - **Description**: Retrieves the current system policy.
- **POST `/permissions`**
  - **Description**: Updates the system policy.
  - **Input**: `{ policy: PolicyStoreSchema }`
  - **Security**: Must be called by an authorized administrator (User).

### 4. Audit Log Access
- **GET `/audit`**
  - **Description**: Queries the audit log.
  - **Input**: Query parameters (from, to, subject, tool, decision, limit).
  - **Output**: `{ events: AuditEvent[] }`

### 5. Internal Audit Ingestion
- **POST `/internal/audit`**
  - **Description**: Allows the Gateway to report the outcome of a tool execution.
  - **Input**: `AuditEventSchema`
  - **Security**: Only callable by the Gateway. Performance and integrity are critical here.

### 6. Restricted APIs (Internal Use Only)
- **POST `/workers/spawn`**
  - **Description**: Spawns a new worker process.
  - **Security**: **Must NOT be exposed to external network.** Only callable by the Runtime itself.
- **POST `/capabilities/mint`**
  - **Description**: Mints a capability token.
  - **Security**: **Must NOT be exposed to external network.** Only callable by the Runtime internals.

---

## Gateway APIs

The Gateway is an enforcement sidecar or service.

### 1. Health
- **GET `/health`**
  - **Output**: `{ ok: true }`

### 2. Tool Execution (Conceptual)
The Gateway exposes individual tool endpoints. Each must follow this pattern:
- **Header**: `Authorization: Bearer <capability_token>`
- **Check**:
  1. Verify token signature with Runtime public key.
  2. Verify `expiresAt > now`.
  3. Verify action and resource match the request.
  4. Verify constraint fields match.
- **Side Effect**: Perform the action.
- **Audit**: Submit an audit event to Runtime `/internal/audit`.

---

## Security Guarantees
- **Deny by Default**: Any request missing a token or having an invalid token is rejected.
- **No Escallation**: Runtime never mints a token with more authority than the session's parent policy allow.
- **Audit-or-Fail**: If the audit event cannot be sent to the Runtime, the Gateway must Fail-Closed (if configured for strict auditing).
