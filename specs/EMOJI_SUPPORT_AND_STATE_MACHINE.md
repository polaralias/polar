# Emoji support and state machine (Telegram bot reactions)

## Status
You’ve implemented emoji fallbacks and a per-chat “unsupported emoji” cache.
This spec exists so the behaviour stays stable and doesn’t regress during refactors.

## Supported emoji set
Telegram Bot API ReactionTypeEmoji supports a limited set. The bot must only attempt emojis from that supported list.

## State machine
Per inbound user message_id:
- received: 👀
- thinking: ✍ (fallback if unsupported)
- waiting_user: ⏳ (workflow proposed / repair question)
- done: ✅ or 👌
- error: ❌ or 👎

Rules:
- Never permanently disable reactions for a whole chat if any reaction has ever succeeded.
- Cache unsupported emojis per chat and skip them.
- Clear done reactions on a timer (not only on next message), but allow a safe fallback if Telegram rejects clears.

## Workflow callbacks
When a workflow is approved/rejected or repair selection completed:
- transition the originating user message reaction from waiting_user -> done
- schedule clear

## Acceptance criteria
- Emojis reliably show and clear across normal turns, workflows, repairs, and attachments.
- Unsupported emojis are automatically skipped after first failure.

## Agent checklist
- Check AGENTS.md first.
- Read last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write a log entry when done.
