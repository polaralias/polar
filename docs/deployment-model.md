# Deployment Model

Polar is designed to be platform-agnostic while maintaining strict security invariants. This document defines the architectural boundaries between the core runtime logic and the deployment-specific adapters.

## Core Invariants (Immutable)

The following components and behaviors must remain identical across all deployment targets. No environment-specific logic is permitted within these core systems.

*   **Runtime Logic**: The core state machine, request handling, and agent lifecycle management.
*   **Policy Engine**: The evaluation of Zod-based policies and permission checks.
*   **Capability Model**: The minting, signing, and verification of capability tokens.
*   **Audit Semantics**: The requirement that every privileged action is logged before execution (fail-closed auditing).
*   **Memory Semantics**: The typed, scoped, and attributable nature of memory.
*   **Gateway Enforcement**: The requirement that all tool access flows through a gateway that verifies capability tokens.

## Deployment Variables (Adapters)

The following components may vary depending on the target environment (Local, Cloud, or Edge). These are implemented as interchangeable adapters or configuration profiles.

*   **Process Model**: How the runtime, gateway, and UI are orchestrated (e.g., local processes vs. containers in ECS/K8s).
*   **Storage Backend**: Where persistent state (policy, sessions, memory, audit) is stored (e.g., local SQLite vs. managed RDS/Aurora).
*   **Secrets Backend**: How sensitive credentials for skills/connectors are stored and retrieved (e.g., local encrypted file vs. AWS Secrets Manager).
*   **Networking and Ingress**: How traffic reaches the system and how egress is controlled (e.g., localhost vs. ALB/CloudFront with WAF).
*   **Authentication**: How users or external agents identify themselves to the system (e.g., local login vs. OIDC/IAM).

## Security Boundary Consistency

The security of Polar does not depend on the underlying infrastructure. While cloud IAM or network security groups provide defense-in-depth, they **never** substitute for the runtime policy engine.

If a deployment target requires a change to the core security semantics (e.g., bypassing a check because "the network is safe"), that deployment is considered non-compliant with the Polar architecture.

## Strategy for Portability

To achieve this portability, Polar uses:
1.  **Dependency Injection**: Services (Storage, Secrets, Audit) are defined by interfaces.
2.  **Environment Configuration**: Standardized environment variables drive adapter selection.
3.  **The Doctor Subsystem**: A built-in diagnostic tool that validates the environment configuration against the target profile.
