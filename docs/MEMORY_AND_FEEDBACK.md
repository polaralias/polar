# Memory and feedback

Polar needs two different persistence stories:

1) **Memory**: facts/summaries used for continuity.
2) **Feedback/events**: reactions, approvals, heartbeats, automation outcomes used for improvement and ops.

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

## Do we need a vector DB?
Not yet.

- Continuous improvement needs structured event queries (not embeddings).
- Semantic recall can start with SQLite text search.

If/when similarity recall is worth it:
- add an optional embeddings table keyed to memory IDs
- migrate to Postgres + pgvector later if/when you need scale


## See also
- `docs/specs/DATA_MODEL.md`
- `docs/specs/ARTIFACT_EXPORTS.md`
