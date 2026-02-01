# Control Plane Architecture

The Polar Control Plane is a **read-write client of the runtime**. It is not a privileged subsystem and assumes the same security model as any other tool or agent interacting with the runtime kernel.

## Principles

1.  **Consumer, Not Authority:** The UI talks only to runtime APIs. It should never bypass the runtime to talk directly to the gateway or access low-level secrets.
2.  **Auditability:** All mutations initiated by the control plane are audited.
3.  **State Derivation:** All state displayed in the control plane is derivable from the current runtime state.
4.  **No Magic:** There is no "magic" UI-only behavior. Anything the UI can do, a CLI or another permitted tool could also do through the API.

## Trust Model

- The UI is treated as a client holding a session token.
- Local deployment assumes the user has control over the local environment.
- Hosted deployment will use standardized authentication (NextAuth, etc.) once multi-user support is implemented.

## Interactions

### UI -> Runtime
- Querying state (audit logs, sessions, agent status, memory, etc.)
- Triggering actions (spawning agents, installing skills, granting/revoking permissions)
- Configuring system-wide settings (channels, policy defaults)

### Runtime -> UI
- Pushing real-time updates via WebSockets or long-polling (initially polling).
- Providing diagnostics and health status.
