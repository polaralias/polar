# Channels and Inbound Message Security

Channels define how messages from external sources (Slack, Discord, Email, Webhooks, etc.) enter the Polar system safely.

## Core Principles

1.  **Untrusted Sources:** All inbound messages are untrusted until identity is established and authorization is granted.
2.  **Explicit Pairing:** No channel is active without explicit pairing and configuration.
3.  **No Anonymous Execution:** Every message must be attributable to a verified sender identity.
4.  **Session Binding:** Channels route messages into sessions; they do not bypass the runtime session model.

## Channel Lifecycle

1.  **Configuration:** User adds a channel integration (e.g., provides a Slack token).
2.  **Pairing:** A pairing handshake is initiated to verify sender identity.
3.  **Allowlisting:** The sender is added to an explicit allowlist for that channel.
4.  **Routing:** Authorized messages are routed to the target session/agent.

## Controls

- **Enable/Disable:** Individual channels can be toggled instantly.
- **Allowlists:** Fine-grained control over who/what can send messages.
- **Rate Limiting:** Protect against flooding and DoS.
- **Size Limits:** Enforce constraints on message body size.
