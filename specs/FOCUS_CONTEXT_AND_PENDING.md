# Focus context and pending state resolution

## Goal
Prevent “wrong that” routing (e.g. delegating the previous weather flow instead of the most recent email task) by making focus resolution deterministic and safe.

This runs **before** routing/delegation/tool selection.

---

## Inputs
- `sessionId`
- `threadKey`
- inbound message:
  - user text
  - telegram message id
  - optional `reply_to_message_id`
  - optional topic id (`message_thread_id`)
- session history (recent, lane-scoped)
- pending state (if any)

---

## Pending state types
Pending state must be explicit and typed, e.g.:
- `slot_request`: expecting a value of a specific kind (location/date/time/yes-no/etc)
- `workflow_waiting`: awaiting button press (approve/reject/repair selection)
- `tool_retry_offer`: assistant offered to retry a tool call
- `delegation_offer`: assistant proposed handing off to a sub-agent
- `clarification_needed`: assistant asked a clarifying question

Each pending state must include:
- `expectedType`: e.g. `location`, `time`, `boolean`, `selection:A|B`, etc
- `createdAtMs`
- `expiresAtMs` (optional)
- `anchorMessageId` (internal and/or channel id)
- `threadKey`

---

## Deterministic focus resolver
Resolve a FocusContext in this order:

### Step 1: reply anchor wins
If inbound message is a Telegram reply:
- FocusAnchor = that replied-to message
- Include a 1-message before + 1-message after window around it (if available) for context.

### Step 2: otherwise lane recency
Else:
- FocusAnchor = most recent assistant message in the same threadKey
- Include last N lane messages (N small, e.g. 10–20) in context assembly.

### Step 3: pending state only applies if message matches expected type
Pending state may influence routing only if all are true:
- pending.threadKey == inbound.threadKey
- pending is not expired
- inbound text matches pending.expectedType (strict)
Examples:
- expectedType=location, inbound="Swansea" -> matches
- expectedType=boolean, inbound="yeah go for it" -> matches
- expectedType=selection, inbound="A" -> matches

If inbound does not match expected type:
- drop/expire pending state for that lane
- do not let pending hijack routing

### Step 4: build “what does that refer to” hint
If inbound contains pronouns (“that”, “it”, “do it”, “again”), provide the router a hint:
- `focusAnchorInternalId`
- `focusAnchorChannelId` (if mapped)
- `focusAnchorTextSnippet` (short)
This improves LLM router accuracy without letting it invent anchors.

---

## Acceptance criteria
- “do that via sub-agent” references the correct recent task, not an older pending tool retry.
- Slot-fill flows work when user provides the requested value.
- Pending states do not persist forever; they expire or are cleared on mismatch.

---

## Tests
- Reply message anchors focus to replied-to content.
- Pending slot applies only when expected type matches.
- Pending clears when new message is a different task.

---

## Agent checklist
- Check AGENTS.md first.
- Read last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write a log entry when done.
