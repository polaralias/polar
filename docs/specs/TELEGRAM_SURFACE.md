# Telegram runner surface contract

## Purpose
Telegram runner is a thin surface:
- normalises Telegram events into Polar turns
- persists user messages
- calls `controlPlane.orchestrate(envelope)`
- renders replies
- handles Telegram UX (threading, grouping, reactions, buttons)

It must not:
- call LLM providers directly
- bypass middleware
- write primary storage into markdown files

Source:
- `packages/polar-bot-runner/src/index.mjs`

## Session id mapping
Stable convention (do not change casually):
- `sessionId = "telegram:chat:" + chat.id`

Threading:
- Topic/thread ids can be stored in metadata, but sessionId stays at chat-level.

## Message id mapping
User messages:
- `messageId = "msg_u_" + telegramMessageId`

Assistant messages:
- `messageId = "msg_a_" + telegramMessageId`

Binding internal ids:
- After sending an assistant message, runner may call:
  - `controlPlane.updateMessageChannelId(sessionId, internalId, channelId)`
to bind orchestrator-produced ids to Telegram ids.

## Ingress handling
### Text messages
1) Resolve session context (existing helper)
2) Persist user message via `appendMessage`
3) Call `orchestrate` with envelope `{ sessionId, userId, text, channel:"telegram", metadata:{ replyTo?, threadId?, ... } }`
4) Send reply to Telegram
5) Bind ids (if applicable)

### Attachments
- Persist references and summaries, not raw base64.
- Avoid bloating DB and model context.

## UX invariants
### Grouping/debounce
If grouping is used:
- preserve ordering
- do not drop messages silently
- store merged text once via `appendMessage`

### Buttons and callbacks
Callback payloads must be validated before use.
On approval actions, clear inline markup to prevent duplicate execution.

Known callback types:
- workflow approve/reject
- repair selection handlers

## Reactions and feedback
Current behaviour appends to `REACTIONS.md`. This must be replaced with feedback events stored in SQLite.

Reaction mapping:
- positive: 👍 💯 🔥
- negative: 👎
Everything else is neutral.

Reaction processing must:
- validate structure
- locate target assistant message by message id mapping using `getSessionHistory`
- record a feedback event with payload including:
  - emoji, polarity
  - telegram message id
  - target message text (if found)
  - timestamp

Must not:
- write markdown files
- store full session transcript inside payload

## Bootstrapping
Telegram runner must obtain `controlPlane` via `@polar/platform`.

It must not:
- create `better-sqlite3` instances directly (post-bootstrap refactor)
- import other packages’ `src/` paths

## Tests
Protect behaviour with tests for:
- sessionId mapping stability
- workflow callbacks do not double execute
- reactions are persisted as events (not a file write)
- updateMessageChannelId called for assistant replies (where used)

Run:
- `npm test`

## Agent checklist
- Check `AGENTS.md` first.
- When done, write to `docs/IMPLEMENTATION_LOG.md`.
