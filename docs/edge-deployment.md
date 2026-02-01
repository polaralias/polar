# Edge Deployment Pack

Edge deployment treats the edge network as an **intelligent ingress and control layer**, providing performance and initial security filtering before requests reach the Polar Runtime.

## Edge Responsibilities

*   **Static Asset Delivery**: Hosting the React UI via a Global CDN.
*   **Authentication & Authorization (Initial)**: Verifying session cookies, JWTs, or A2A signatures.
*   **Rate Limiting**: Protecting the Runtime from volume-based attacks.
*   **Request Sanitization**: WAF-style filtering for common web vulnerabilities.
*   **Health Checks**: Routing traffic only to healthy Runtime instances.

## Edge Non-Responsibilities

The following must **never** happen at the edge to prevent security leakage or bypasses:
*   **Policy Evaluation**: Granular "Can Agent A do X?" decisions belong in the Runtime.
*   **Capability Minting**: Signing keys must never live on the edge.
*   **Tool Execution**: The Gateway should remain behind the edge in a secure environment.
*   **Direct Memory Access**: Memory retrieval must involve authorization checks in the Runtime.

## Deployment Topology

1.  **User/Agent** → **Edge (CloudFront/Cloudflare)**
2.  **Edge** → **Runtime (Private API)**
3.  **Runtime** ↔ **Gateway**

## Security Invariants

*   **Trust Nothing**: The Runtime must verify that any "authenticated" user passed by the edge is truly authorized within the Polar system.
*   **Fail Closed**: If the edge is bypassed, the Runtime and Gateway should still be unreachable or require full authentication/authorization tokens.
*   **IP Allowlisting**: The Runtime should ideally only accept traffic from the Edge's IP ranges.
