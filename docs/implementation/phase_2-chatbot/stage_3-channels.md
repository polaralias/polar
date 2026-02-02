# Phase C: Channels (Chat Gateways)

## Goal
Enable the assistant to work where the user is (Slack, Telegram, WhatsApp) while maintaining strict security boundaries. Channels are just another ingress/egress boundary.

## 1. Unified Channel Interface
Define a single `Channel` interface in the Runtime.

### Interface Methods
*   `connect()` / `disconnect()`
*   `handleInbound(message)` → Creates/Updates a `Session`
*   `sendOutbound(target, message)`
*   `supportsAttachments` + Attachment ingestion hooks

### Runtime Responsibilities
*   Channel config store.
*   Sender allowlists.
*   Pairing state (mapping external ID to Polar Session/User).
*   Routing rules.

## 2. Security Rules (Mandatory)
*   **Disabled by Default**: Channels must be explicitly enabled.
*   **Pairing Required**: Must pair an external user/chat to a Polar session before processing any actions.
*   **Allowlists**: Per-sender allowlist required.
*   **Rate Limits**: Enforce strict rate limits and message size limits.
*   **Attachments**: Quarantined. Stored as blobs, scanned, never auto-executed.
*   **Untrusted Inputs**: Treat inbound messages (especially email) as untrusted documents.

## 3. Implementation Strategy
Implement channels in order of complexity:

### Step 1: Telegram (Simplest)
*   Bot API webhook or long polling.
*   `sendMessage` for outbound.
*   Per-chat allowlist.
*   Command handling for pairing.

### Step 2: Slack
*   Events API (inbound).
*   Web API (outbound).
*   Verify inbound signatures.
*   Map Slack User IDs to Polar User.
*   Thread support (map threads to sessions).

### Step 3: WhatsApp (Optional/Later)
*   WhatsApp Cloud API or Twilio.
*   Verify webhook signatures.
*   Pairing flow via one-time code in UI.

## 4. UI Implementation
*   **Connected Channels Status**: View active channels in the Dashboard.
*   **Pairing Flow**: UI for generating pairing codes or managing paired external users.
*   **Chat UI Update**: Indicate which channel a message came from.

## Acceptance Criteria
- [ ] Telegram Channel implemented and working.
- [ ] Inbound message from unknown sender is **blocked/ignored**.
- [ ] Pairing flow works: User pairs Telegram account -> Message routes to correct session.
- [ ] Outbound messages appear in the external channel.
- [ ] Audit logs capture the channel source and external user ID.
