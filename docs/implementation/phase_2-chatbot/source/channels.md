# Polar Assistant: Channels (Slack, Telegram, WhatsApp, etc.)

Channels are ingress/egress adapters that let users chat with Polar from messaging platforms. Channels are high-risk surfaces and must be locked down with pairing and allowlisting.

## Goals
- Messaging-first assistant experience
- Safe inbound messages (default deny)
- Clear routing to users/sessions
- Identical behaviour to the web UI

## Channel principles
- Inbound messages are untrusted.
- No anonymous execution.
- Pairing required before any inbound messages can trigger actions.
- Per-sender allowlist required.
- Rate limits and size limits enforced.
- Attachments quarantined and never executed.

## Normalised message model
Channels must map platform events into a common structure:
- `channel_id`
- `sender_id`
- `conversation_id` (thread/chat)
- `timestamp`
- `text`
- `attachments` (metadata + blob reference)
- `reply_to` (optional)

The runtime uses this to:
- identify user
- identify session
- apply policy and memory scope

## Pairing model
Recommended pairing flow:
1. User enables channel in UI and requests a pairing code.
2. Runtime generates short-lived pairing code.
3. User sends the code to the bot/account in the channel.
4. Runtime binds `sender_id` and `conversation_id` to the Polar user.
5. Sender is allowlisted.

Pairing and allowlist changes are audited.

## Routing rules
- DMs map to a dedicated session or a per-user default session.
- Group channels require mention or explicit command prefix to trigger.
- Threads map to sessions when possible (Slack threads, etc.).

## Slack implementation outline
- Inbound: Events API
  - verify request signatures
  - ignore events from unknown senders
- Outbound: Web API
- Features:
  - thread → session mapping
  - mention gating in channels
  - attachment size/type constraints
- Secrets: stored in runtime, never in channel adapter logs.

## Telegram implementation outline
- Inbound: webhook or polling
- Outbound: sendMessage
- Features:
  - per-chat allowlist
  - pairing via command
  - strict rate limiting

## WhatsApp implementation outline
Choose one transport:
- WhatsApp Cloud API (Meta)
- Provider (eg Twilio)

Regardless:
- verify webhook signatures
- map phone number to user via pairing
- block media by default or require explicit enabling
- strict attachment quarantining

## Other channels
- Discord: gateway intents + allowlist + mention gating
- Matrix: room allowlists + event filtering
- Email: treat inbound emails as documents; never auto-act without confirmation
- Webhook: signed payloads only; rate limits; minimal surfaces

## Auditing requirements
Audit events for:
- channel enabled/disabled
- pairing requested/completed/failed
- sender allowlisted/removed
- inbound message received (metadata, not full contents by default)
- outbound messages sent

## Testing requirements
- Unknown sender messages are blocked and audited.
- Pairing establishes identity binding and routing.
- Rate limits prevent spam.
- Attachment quarantine works and blocks unsafe types.
