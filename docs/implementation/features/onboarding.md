# Onboarding Model

Onboarding in Polar is designed to make unsafe states difficult to reach. It is a mandatory sequence of steps to establish a secure, known-good baseline before the system can be used.

## Required Steps

1.  **Identity Generation:** Create the primary runtime identity and signing keys for capability tokens.
2.  **Encrypted Storage Initialization:** Set up the persistent stores for policy, audit, and session data.
3.  **Initial User/Session:** Create the root user and an initial management session.
4.  **Policy Baseline:** Establish a default 'deny-all' policy for all untrusted agents/skills.
5.  **Connectivity Check:** Verify the runtime can communicate with the gateway.
6.  **Audit Verification:** Confirm the audit logging pipeline is active and writable.

## Interfaces

- **CLI:** `polar init` provides a step-by-step interactive onboarding process.
- **UI:** A wizard-style interface that mirrors the CLI steps, making calls to the runtime's initialization APIs.

## Idempotence

- Re-running onboarding should detect existing state and reuse it by default.
- Destructive actions (like rotating keys) require explicit flags (`--rotate-keys`) or UI confirmation.
- System must not allow tool execution until all mandatory onboarding steps are complete.
