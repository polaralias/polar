# Context management system (thread-aware, low-cost, “Poke-style”)

## Goal
Make conversations feel coherent over time without exploding token usage by building context from multiple layers:
- **Recency buffer**: last N messages in the relevant lane (threadKey).
- **Rolling summaries**: compacted summaries per lane (threadKey) and optionally per chat (session).
- **Long-term memory**: durable facts/preferences/outcomes.
- **Retrieval**: pull only relevant memory and thread summaries for the user’s current intent.

This system improves coherence and cost, but it does **not** replace deterministic Telegram thread routing and reply anchoring.

---

## Core entities
### SessionId
Chat-scoped:
- `sessionId = telegram:chat:<chatId>`

### ThreadKey (lane)
Must be stable and deterministic (topic > reply > root):
- `topic:<chatId>:<message_thread_id>`
- `reply:<chatId>:<reply_to_message_id>`
- `root:<chatId>`

### FocusAnchor
The message that the user is most likely referring to:
1) Telegram reply target (if message is a reply)
2) Most recent assistant message in same threadKey
3) Pending slot request only if the new message matches expected slot type

---

## Context layers (assembled in this order)
1) **System/developer policy** (security, tools, constraints)
2) **Personality** (effective personality resolved by precedence rules)
3) **Thread summary** (lane summary for threadKey)
4) **Retrieved memories** (facts/preferences/outcomes relevant to focus)
5) **Recent messages** (last N messages in same threadKey)
6) **Quoted reply context** (explicitly labelled, not mixed into user text)
7) **User message**

Rules:
- Only include messages from the same `threadKey` in the recency window.
- Prefer a small, high-signal context to a large dump.

---

## Storage model
SQLite is the source of truth.

### Recommended: store summaries as memory records
Avoid new tables unless you need them. Use existing memory provider with typed records.

Memory record types:
- `thread_summary` (scope=session, keyed by sessionId + threadKey)
- `session_summary` (scope=session, keyed by sessionId)
- `thread_state` (optional; pending slot state, last anchor ids, etc)

Metadata must include:
- `threadKey`
- `summaryVersion`
- `updatedAtMs`
- `messageRange` (optional: from/to message IDs)

Long-term memories remain as you already store them (facts/preferences/events).

---

## Compaction and summarisation
### When to compact
Trigger compaction when any of these thresholds are exceeded for a threadKey:
- `recentMessagesCount > 30` OR
- `estimatedTokens(recentMessages) > 2,500` OR
- `timeSinceLastSummaryUpdate > 24h` (optional)

### What to compact
- Keep the **most recent K messages** in lane untouched (e.g. last 10).
- Summarise the older messages into the `thread_summary`.

### Summary format
Use a structured summary to reduce ambiguity:

- Current goals / open questions
- Decisions made
- Important facts (user preferences, constraints)
- Recent outcomes (what was tried, what failed)
- Pending actions (explicitly marked)

Never store tool secrets or credentials.

---

## Retrieval (RAG) policy
Start simple:
- Use SQLite FTS or text search against memory JSON to fetch top matches by keyword.
- Later: add embeddings if needed.

Retrieve:
- memories matching user’s query terms
- thread summaries for related threadKeys only if user explicitly references them or confidence is high

Avoid:
- retrieving across all threads by default (cost + confusion)

---

## Redis
Redis is optional and should be treated as a cache/coordination layer, not a primary store.
Use Redis only when:
- you run multiple workers and need distributed locks for compaction/runs
- you want caching for repeated retrieval queries

SQLite remains the source of truth.

---

## Acceptance criteria
- The orchestrator assembles context using threadKey scoping.
- Rolling summaries reduce token usage as sessions grow.
- The assistant can “pick up where it left off” within a threadKey without requiring all history in-context.
- Pending states do not hijack unrelated tasks.

---

## Agent checklist
- Check AGENTS.md first.
- Read last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write a log entry using the agreed template when done.
