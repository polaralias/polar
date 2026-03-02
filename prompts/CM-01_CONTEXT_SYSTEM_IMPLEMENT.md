Prompt CM-01: Implement thread-aware context management (rolling summaries + retrieval)

Mandatory pre-flight review (do not skip)
1) Read root AGENTS.md.
2) Read:
   - docs/specs/CONTEXT_MANAGEMENT_SYSTEM.md
   - docs/specs/FOCUS_CONTEXT_AND_PENDING.md
   - docs/specs/ROLE_AND_QUOTE_RENDERING.md
3) Read the last 150 lines of docs/IMPLEMENTATION_LOG.md.

Goal
- Implement a Poke-style context assembly pipeline that is lane-scoped by threadKey.
- Add rolling `thread_summary` memory records and compaction triggers.
- Add a retrieval step that pulls relevant memories for the lane without cross-thread noise.

Implementation outline
A) ThreadKey plumbing
- Ensure threadKey is derived deterministically (topic > reply > root) and is carried:
  - from Telegram ingress metadata
  - into stored message metadata
  - into orchestrator envelope metadata

B) Context builder
- Implement or refactor a single context assembly function in runtime-core orchestrator path:
  - get effective personality
  - fetch thread_summary for (sessionId, threadKey)
  - fetch recent lane messages (N=10–20)
  - retrieve relevant memories using keyword/FTS search
  - render reply context block separately (do not mix into user text)

C) Rolling summaries
- Add compaction trigger based on lane message count or estimated tokens.
- Summarise older lane messages into `thread_summary` record.
- Keep last K messages unsummarised.

D) Safety
- Summaries must not include secrets or raw credentials.
- Summaries should preserve open questions and decisions.

Tests
- Lane scoping: messages from different threadKeys never enter the same context window.
- Summary updates: after threshold, thread_summary exists and recency window shrinks.
- Retrieval returns lane-relevant memory first.

Checks to run
- npm test
- npm run check:boundaries

Logging (required)
- Add a log entry using the template and include:
  - thresholds used
  - how summaries are stored
  - tests run
  - Next prompt

Footer
- Check AGENTS.md first.
- Review last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write to docs/IMPLEMENTATION_LOG.md when done.
