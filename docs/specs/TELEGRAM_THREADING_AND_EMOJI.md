# Telegram threading, reply anchors, and emoji lifecycle

## Purpose
Make Telegram behaviour feel like a real human conversation:
- Conversations remain correctly scoped to topics/threads (forum topics and reply chains).
- Replies are anchored to the most relevant prior assistant message where appropriate.
- Recent user messages in the same thread are merged/handled sensibly without leaking across threads.
- Processing emojis are consistent and get cleaned up reliably (including workflow proposal states and attachments).

Scope:
- Telegram runner only (`packages/polar-bot-runner/src/index.mjs`) plus any minimal control-plane/orchestrator changes required to support anchoring and mapping.

Non-goals:
- This doc does not change the overall storage model (SQLite remains source of truth).
- This doc does not introduce external agent SDKs.

## Definitions
- **Chat**: Telegram `chat.id`
- **Topic**: Telegram `message_thread_id` (forum topics)
- **Reply chain**: Telegram `reply_to_message.message_id`
- **Session**: Polar session representing a chat (`telegram:chat:<chatId>`) unless explicitly migrated.
- **ThreadKey**: A stable key used to partition “conversation lanes” inside one chat.

## Session and thread rules
### SessionId
Keep stable and chat-scoped:
- `sessionId = "telegram:chat:" + chatId`

### ThreadKey (must be used for buffering and anchoring)
Derive per inbound message:
1) If `message_thread_id` exists:
- `threadKey = "topic:" + chatId + ":" + message_thread_id`
2) Else if message is a reply (has `reply_to_message.message_id`):
- `threadKey = "reply:" + chatId + ":" + reply_to_message.message_id`
3) Else:
- `threadKey = "root:" + chatId`

Store `threadKey` in message metadata for both user + assistant messages.

## Buffering and merge behaviour (critical)
Current behaviour buffers by session only. That causes cross-topic merges.

### New buffering key
Any debounce/group buffer MUST be keyed at least by:
- `bufferKey = sessionId + "|" + threadKey + "|" + userId`

Rules:
- Never merge messages from different threadKey values.
- Never merge messages across different users.
- If attachments arrive, they may be buffered with text only if they share the same bufferKey and within debounce window.

Recommended debounce behaviour:
- If multiple messages arrive from the same user in the same thread within N ms, merge into one turn with newline separation and preserve order.
- Persist exactly one `appendMessage` for the merged content.

## Reply behaviour (topics + inline reply)
### Always stay in the topic
If `message_thread_id` is present on inbound message, all outbound messages for that turn MUST be sent with:
- `message_thread_id: inbound.message_thread_id`

This is explicit, not implicit.

### Inline replies (reply_to_message_id)
Inline replies should be used when:
- The backend selects an anchor (see “Anchor selection”), AND
- A resolvable Telegram numeric `message_id` exists for that anchor

When used, send:
- `reply_to_message_id: <numeric message_id>`
- `allow_sending_without_reply: true` (recommended so missing anchor does not fail send)

If anchor cannot be resolved to a numeric Telegram id:
- Do not set `reply_to_message_id`
- Still post in the correct `message_thread_id` topic if applicable

## Anchor selection and id mapping
### Problem to solve
Backend may return internal message IDs. Telegram requires numeric `message_id` for reply anchoring.

### Required capability: internal ↔ channel id mapping
For any assistant message that is sent to Telegram:
- The runner MUST call `controlPlane.updateMessageChannelId(sessionId, internalId, telegramMessageId)` (or equivalent) immediately after send.

Both of these must be true:
- The internal assistant message exists in session history.
- Session history supports retrieving the stored channel id later (either as a top-level field or metadata).

### Orchestrator outputs must include assistantMessageId for all assistant messages
For any orchestrator output that causes the runner to send assistant text (including workflow proposals and repair questions), orchestrator MUST provide:
- `assistantMessageId` (internal ID) so runner can bind it to Telegram `message_id`.

If that is not currently true for `workflow_proposed` and `repair_question`, it must be fixed.

### Anchor resolution algorithm
When orchestrator suggests an anchor (eg internal id):
1) If anchor is already numeric: use it
2) Else resolve internal id → channel id:
   - Prefer a dedicated API if present
   - Otherwise scan `controlPlane.getSessionHistory(sessionId)` to find message where `messageId == anchorInternalId` and read `channelMessageId` / `metadata.telegram.message_id`
3) If resolved numeric channel id found: inline reply to it
4) Else: no inline reply

## Reaction feedback events (and why mapping matters)
Reaction updates arrive with:
- target `message_id` (Telegram numeric)
- emoji

Rules:
- Record feedback as a SQLite feedback event (see `docs/specs/DATA_MODEL.md`).
- Attempt to resolve Telegram numeric `message_id` → internal assistant message:
  - scan session history for assistant message where stored channel id equals the target
- If resolved:
  - store `messageId` as the internal assistant messageId
  - include a small snippet of the assistant text in payload (optional)
- If not resolved:
  - still record event, but set:
    - `messageId = "telegram:" + chatId + ":" + telegramMessageId`
    - `payload.unresolved = true`

Do not:
- write to REACTIONS.md directly
- dump full session history into payload

## Emoji lifecycle (reaction state machine)
Goal: consistent “processing” feedback that clears properly.

### States and emojis
Per inbound user message (telegram message id):
- `received` → 👀
- `thinking` → ✍️
- `waiting_user` (workflow proposed / repair question awaiting user input) → ⏳
- `done` → 👌 or ✅
- `error` → 👎 or ❌

### Rules
1) Only ever manage emojis on the *user’s* inbound message_id for that turn.
2) Transitions:
   - Immediately on ingest: set 👀
   - When starting orchestration: set ✍️ (replace 👀)
   - If output indicates waiting for user action: set ⏳ (replace ✍️)
   - If completed: set ✅/👌 (replace whatever was there)
   - If error: set 👎/❌ (replace whatever was there)

3) Cleanup:
   - `done` reactions should be removed consistently, not just “sometimes on next message”.
   - Recommended: keep ✅/👌 for 30–120 seconds, then clear automatically.
   - `waiting_user` should remain until the user approves/rejects/completes the selection; then transition to `done` and schedule clear.

4) Attachments:
   - Photo/PDF flows must follow the same state machine and must schedule clear on completion.

### Required implementation details
- Maintain a `reactionStateMap` keyed by telegram inbound message id:
  - `{ state, lastSetAtMs, clearAtMs?, sticky? }`
- Implement `setReactionState(ctx, inboundMessageId, state)`
- Implement `clearReaction(ctx, inboundMessageId)` with rate limiting to avoid Telegram API spam.

### Workflow callbacks must update reaction state
When user clicks Approve/Reject or answers repair question:
- Identify the originating inbound user message id the proposal came from (store it in callback data or in session metadata).
- Transition that message’s reaction from ⏳ → ✅/👌 and schedule clear.

## Acceptance criteria
- Messages in different topics are never merged into the same user turn.
- Replies remain inside their topic (`message_thread_id` always set when inbound had it).
- Inline reply anchoring works whenever a prior assistant message has been sent and mapped.
- Reaction updates resolve to internal messages most of the time (mapping exists).
- Emoji reactions reliably clear for:
  - normal turns
  - workflow_proposed
  - repair_question
  - attachment flows
- Tests added/updated to prevent regression.

## Tests to add
- Unit test: buffering key includes threadKey and userId, no cross-thread merges.
- Unit test: reply payload includes `message_thread_id` when inbound has it.
- Unit test: anchor internal id resolves to numeric channel id if mapping exists.
- Unit test: emoji state transitions and scheduled clear.

## Agent checklist
- Check `AGENTS.md` first.
- Read the last 150 lines of `docs/IMPLEMENTATION_LOG.md` before starting.
- Write a log entry using the agreed template when done.