# Quote and role rendering (reply context correctness)

## Problem
Telegram reply quoting can cause the assistant to treat quoted assistant text as “user context”, leading to misattribution like:
- “In your context, the MD files appeared…” when it was the assistant’s earlier message.

## Goal
Make quoted/replied-to content explicit, role-labelled, and separate from the user’s message text.

---

## Ingestion rules (Telegram runner)
When inbound message includes a reply:
- Capture `replyTo` as structured metadata, not as a string injected into userText.

Required metadata:
- `replyTo.messageId` (telegram numeric)
- `replyTo.snippet` (text/caption, truncated)
- `replyTo.from.isBot` (boolean)
- `replyTo.from.displayName` (string, optional)
- `replyTo.from.role`:
  - `assistant` if isBot or mapped to an internal assistant message
  - `user` otherwise
- `replyTo.threadKey`

Do not prepend:
- `[In reply to X: ...]` into user text.

---

## Context assembly rules (orchestrator)
Render reply-to context as a labelled block, for example:

Reply context:
- User replied to (assistant): "<snippet>"

User message:
- "<actual inbound text>"

This ensures the model treats the quoted content as context, not as user-authored text.

---

## Self-awareness guidance (prompt-level)
Add a small system/developer instruction:
- Treat reply context blocks as quoted material.
- Do not attribute quoted assistant statements to the user.
- When uncertain, ask a short clarifying question.

This is not “magic”; it complements deterministic role labelling.

---

## Acceptance criteria
- The assistant no longer says “in your context…” when referencing its own prior content quoted by the UI.
- Reply-to snippets improve pronoun resolution (“that”, “it”) without polluting user text.

---

## Tests
- Reply-to snippet stored in metadata, not appended to user text.
- Orchestrator receives a structured reply context block.

---

## Agent checklist
- Check AGENTS.md first.
- Read last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write a log entry when done.
