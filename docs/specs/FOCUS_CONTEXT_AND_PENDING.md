# Focus context and pending state resolution (Hybrid v2)

## Goal
Prevent wrong-reference routing (for example, delegating an older task when user says "do that") by resolving focus deterministically before broad routing.

This stage runs before final route execution and before high-impact tool/delegation actions.

This is the bridge between dynamic context loading and safe specialist-agent delegation.

---

## Inputs
- `sessionId`
- inbound `threadKey`
- inbound message envelope:
  - text
  - channel message id
  - optional `reply_to_message_id`
  - optional topic id (`message_thread_id`)
- lane/session history (recent)
- typed pending state
- temporal attention record for lane (if present)

---

## Pending state types
Pending state must be explicit and typed:
- `slot_request`
- `clarification_needed`
- `workflow_waiting`
- `workflow_cancellable`
- `delegation_candidate`

Each record must include:
- `expectedType` (for example: `location`, `date_time`, `boolean`, `selection:A|B`)
- `createdAtMs`
- `expiresAtMs` (required for clarify/delegation candidates)
- `anchorMessageId` (internal and/or channel)
- `threadKey`
- `stateVersion`

---

## Deterministic focus resolver
Resolve `FocusContext` in this order.

### Step 1: explicit reply anchor
If inbound is a Telegram reply:
- FocusAnchor = replied-to message.
- Include compact local anchor context (1 message before + 1 after when available).

### Step 2: lane recency
Else:
- FocusAnchor = most recent assistant anchor in same `threadKey`.
- Include last N lane messages (small window, for example 10-20).

### Step 3: typed pending match
Typed pending can influence focus only if all are true:
- `pending.threadKey == inbound.threadKey`
- pending not expired
- inbound matches `pending.expectedType`

If inbound does not match expected type:
- clear/expire incompatible pending record for lane
- do not let pending hijack focus/routing

### Step 4: temporal attention refinement
If pronouns/low-information text appear ("that", "it", "do it", "again"):
- use deterministic temporal attention candidates from last ~30 minutes
- expose top candidate anchors as hints:
  - `focusAnchorInternalId`
  - `focusAnchorChannelId`
  - `focusAnchorTextSnippet`
  - `focusSource` (`reply_anchor|lane_recency|pending|temporal_attention`)

### Step 5: ambiguity outcome
If top focus candidates are too close by decision margin:
- return `clarification_needed` candidate
- do not execute tool/delegation decisions yet

---

## Contract with router/arbitration
Focus resolver output is authoritative input to routing arbitration:
- router may rank semantic fit between provided candidates
- router may not invent anchors outside provided candidate set
- deterministic policy still chooses final safe action on high-risk conflicts
- delegation target resolution should prefer:
  1) pending routing-state target in same lane
  2) router-provided target
  3) explicit user-mentioned agent in turn text
  4) deterministic fallback agent

---

## Acceptance criteria
- "do that via sub-agent" resolves to most recent relevant focus, not stale pending.
- slot fills apply only when expected type matches.
- short replies ("yes", "that one") resolve via typed pending first.
- incompatible/expired pending records are cleared and cannot persist indefinitely.
- selecting option `B` after clarification consistently delegates to the preserved target agent for that lane.

---

## Tests
- reply-to anchor wins over lane recency.
- typed pending match succeeds only on expected type.
- pending mismatch clears stale pending and continues as new request.
- temporal attention candidate list is used for pronoun-like turns.
- ambiguity margin triggers `clarification_needed`.

---

## Agent checklist
- Check AGENTS.md first.
- Read last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write a log entry when done.
