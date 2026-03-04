# Memory and feedback

Polar needs two different persistence stories:

1) **Memory**: facts/summaries used for continuity.
2) **Feedback/events**: reactions, approvals, heartbeats, automation outcomes used for improvement and ops.

## Vision alignment
The memory system is a hybrid context stack:
- rolling summaries for long chats
- durable fact memory for important user/project details
- typed pending/runtime state for short follow-ups and control flow
- dynamic retrieval that is lane-first and only widens scope when justified

Proposal-quality interpretation of memory context is LLM-driven; memory safety, retrieval bounds, and persistence policy are deterministic.

## Current state
- SQLite-backed memory provider exists (with text search/FTS where available).
- Telegram runner writes reactions to a markdown file (flat append).
- Web UI has a basic editor for allowlisted system files.

## Recommendation
### Keep SQLite as source of truth
- Store memory and events in SQLite tables.
- Treat markdown files as exports/projections for humans.

### Separate memory from events
- Memory: curated facts and summaries.
- Events: append-only records (reaction_added, approval_granted, heartbeat_tick, automation_run).

This keeps queries straightforward and avoids mixing “what happened” with “what we currently believe”.

### Memory categories
Keep these as distinct record types:
- `thread_summary` and `session_summary`: compressed continuity
- `temporal_attention`: recent unresolved/actions view
- `extracted_fact`: durable user/project facts
- `thread_state`: typed pending records (`slot_request`, `clarification_needed`, `workflow_waiting`, `workflow_cancellable`, `delegation_candidate`)

`thread_state` is runtime-critical continuity and should be durable, lane-scoped, and TTL-aware.

## Do we need a vector DB?
Not yet.

- Continuous improvement needs structured event queries (not embeddings).
- Semantic recall can start with SQLite text search.

If/when similarity recall is worth it:
- add an optional embeddings table keyed to memory IDs
- migrate to Postgres + pgvector later if/when you need scale

## Retrieval rules
- Default retrieval is lane-first.
- Session-level summaries are fallback context, not primary.
- Cross-lane retrieval requires explicit user reference or high-confidence match.
- Never retrieve/store secrets or credentials in memory summaries/facts.

## See also
- `docs/specs/DATA_MODEL.md`
- `docs/specs/ARTIFACT_EXPORTS.md`
