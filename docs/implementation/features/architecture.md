# Polar Architecture

## System Overview

Polar is a secure, inspectable agent runtime. It separates reasoning (Agents) from authority (Runtime) and enforcement (Gateway).

### Core Components

1.  **Runtime**: The authoritative kernel of the system. It manages sessions, evaluates policy, mints capability tokens, and writes the audit log. It is the only component that holds long-term credentials.
2.  **Gateway**: A pure enforcement point. It sits between agents (or their workers) and the resources they need to access. It verifies capability tokens and reports results back to the Runtime for auditing.
3.  **Agents (Minds)**: Untrusted LLM-based entities that reason and plan. They propose actions but cannot execute them directly.
4.  **Skills/Workers (Hands)**: Individual capabilities (e.g., "Read File", "Send Email") that execute within a constrained environment, mediated by the Gateway.

---

## Trust Model and Invariants

### 1. Agents are Untrusted
LLMs are treated as fallible, manipulable, and potentially adversarial. They may propose actions, but they never hold authority to execute them.

### 2. Runtime is the Only Authority
- Only the Runtime can spawn workers.
- Only the Runtime can mint capability tokens.
- Only the Runtime can write to the audit log or persistent memory.
- All policy decisions are made by the Runtime.

### 3. Gateway is Pure Enforcement
- The Gateway has zero policy logic.
- It is "trusted but dumb": it knows how to verify a token's signature and constraints, but it doesn't decide *what* those constraints should be.
- It never sees or stores sensitive credentials (except those required to verify tokens).

### 4. Credentials Never Leave Runtime
- Backend credentials (API keys, secrets) are managed by the Runtime.
- Tokens issued to workers are scoped and temporary, never exposing the underlying credential.

### 5. Capabilities are Mandatory
- Every side-effect (write) and every sensitive read requires a valid, runtime-minted capability token.
- Capability tokens include: ID, Subject, Action, Resource, Constraints, and TTL.

### 6. Read Access is Sensitive
- Polar treats data access (reads) as a privileged action. Reading sensitive data is considered as much of a breach risk as writing data.

---

## Audit Logs

The audit log is the source of truth for all system activity.

### Guarantees
- **Append-Only**: Once written, audit entries cannot be modified or deleted.
- **Immutable**: The log preserves the historical state of the system.
- **User-Visible**: Users must be able to inspect the log to understand what the system did and why.

### Audit Entry Schema
Every gateway call produces exactly one audit entry, containing:
- **Who**: The subject (session/worker) performing the action.
- **What**: The action performed.
- **Resource**: The target resource.
- **Decision**: Allow or Deny.
- **Capability ID**: The ID of the token used (if any).
- **Parent Cause**: The session or message that triggered the action.
- **Timestamp**: When the action occurred.

---

## Explicit Non-Goals
- **No autonomous agents**: Agents cannot act without user-mediated or policy-governed authority.
- **No self-modifying skills**: Skills cannot change their own permissions or code at runtime.
- **No hidden memory writes**: All persistent state changes must flow through the Runtime and be audited.
- **No implicit permissions**: All authority must be explicitly granted via policy.
