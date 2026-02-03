# Phase 2 - Stage 4: Channels

## Goal
Interact with Polar through external messaging apps (Slack, Telegram, WhatsApp). Treat these channels as **untrusted ingress points**.

## 1. Channel Adapter Interface
Standardize the internal interface for all channels.

*   **Methods**: `connect()`, `disconnect()`, `send()`.
*   **Events**: `onMessage`, `onReaction`.
*   **Normalization**: Convert platform-specific JSON to internal `InboundMessage` format (`sender_id`, `conversation_id`, `text`, `attachments`).

## 2. Security: Pairing & Allowlists
**Strict Rule**: No channel works "out of the box". It must be paired.

*   **Pairing Flow**:
    1.  User generates `PairingCode` in Web UI.
    2.  User sends code to Bot in Telegram/Slack.
    3.  Runtime links `external_user_id` to `session_id`.
*   **Allowlist**: Only paired users can interact. All others are **ignored** (stealth mode) or blocked.
*   **Rate Limits**: Enforce strict per-user input limits to prevent DoS.

## 3. Implementation Plan
Implement the following channels:

### Telegram
*   **Transport**: Long-polling or Webhook.
*   **Auth**: Bot Token.
*   **Features**: Simple text, Commands (`/start`).

### Slack
*   **Transport**: Events API (Socket Mode for local).
*   **Auth**: App Token / Bot Token.
*   **Features**: Map Threads to Sessions. Mention gating in channels.

## 4. Message Routing & Content Security
*   **Routing**:
    *   DMs -> User's Default Session.
    *   Threads -> Specific Session context.
*   **Attachments**:
    *   **Quarantine**: All files are stored as blobs but NOT processed.
    *   **Policy**: User must explicitly ask to "Analyze this file".
*   **Secrets**: Channel adapters must never log message contents containing secrets.

## Acceptance Criteria
- [ ] Telegram/Slack bot accepts messages only from paired users.
- [ ] Unknown users/unpaired accounts are ignored.
- [ ] Inbound messages are normalized and routed to correct sessions.
- [ ] Attachments are quarantined by default.
- [ ] Rate limits prevent message flooding.
- [ ] "Pairing Code" flow works end-to-end.

## Deferred from Phase 1 (Maturity)
- **Pairing Flow Protocol**: Implement a formalized pairing protocol including support for mTLS or OAuth-based identity binding where supported by the channel.
- **Per-Channel Rate Limits**: Implement granular rate limits and usage quotas per channel and per sender to prevent resource exhaustion.
- **Sender Identity Verification**: Implement cryptographic verification of sender identities to prevent spoofing on platforms that support signed payloads.
