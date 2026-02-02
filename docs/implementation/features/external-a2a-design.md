# A2A Interoperability Design

## Overview

Polar embraces Agent-to-Agent (A2A) interoperability while maintaining a strict "zero trust" stance toward external entities. This document defines how external agents interact with the Polar runtime.

## Principles

1. **External Agents are Untrusted Clients:** They are treated as external principals requesting services, never as trusted extensions of the kernel.
2. **Identity Binding:** Every external agent must be bound to a specific user and session.
3. **No Direct Tool Access:** External agents never receive capability tokens for local tools. They request actions; Polar executes them.
4. **Anti-Replay & Integrity:** All A2A communication must be authenticated and protected against tampering or replay.

## External Agent Identity

Polar represents external agents as a first-class principal type:

```typescript
type ExternalAgentPrincipal = {
  type: 'external_agent';
  id: string;          // Stable identifier for the external agent
  provider: string;    // e.g., 'openai', 'anthropic', 'bespoke-service'
  sessionId: string;   // Bound Polar session
  userId: string;      // Bound Polar user
};
```

### Authentication
* **Transport Layer:** mTLS, OAuth 2.0 (Client Credentials), or Signed API Keys.
* **Message Layer:** Every request must include a nonce and a cryptographic signature.

## Agent Manifest (AgentCard)

External agents must provide a manifest (similar to an AgentCard) that describes their identity and capabilities. Polar stores this for routing and UI display.

**Manifest Fields:**
* `id`: Unique agent identifier.
* `version`: Protocol version.
* `capabilities`: Declared message types and task types the agent can handle.
* `auth_requirements`: Supported authentication schemes.
* `policy_hints`: (Non-binding) Suggested permissions for the agent.

## Communication Flow

All A2A traffic flows through the `A2AGateway` in the Polar Runtime.

1. **Request:** External agent sends a task request to the Polar A2A endpoint.
2. **Authentication:** A2AGateway verifies the signature and maps the request to an `ExternalAgentPrincipal`.
3. **Policy Evaluation:** The Runtime Policy Engine evaluates the request:
   * Is this external agent allowed to perform this task in this session?
   * Does it have the necessary grants?
4. **Execution:**
   * If approved, the Runtime executes the task (or delegates to a local Worker).
   * **Crucially:** The external agent never touches the tool directly.
5. **Response:** Polar returns the results (filtered or redacted based on policy).

## Capability Handling for A2A

* **Input Filtering:** Polar strips sensitive metadata or unrelated context before sending data to an external agent.
* **Action Proxying:** If an external agent "calls a tool," it is actually proposing an action to Polar. Polar evaluates the proposal and executes it using local credentials if permitted.

## UI & Audit

* **Visibility:** The Polar UI clearly distinguishes between local agents and external A2A agents.
* **Consent:** Use of an external agent often requires explicit user consent, especially if data is leaving the local environment.
* **Audit:** All A2A requests, responses, and signature verifications are logged in the audit trail.

## Security Invariants

* **Credential Leakage:** No local credentials (API keys, tokens) are ever sent to external agents.
* **Scope Escape:** An external agent cannot access resources outside its bound session or user scope.
* **Audit Immutability:** External agents cannot modify or delete audit records related to their activity.
