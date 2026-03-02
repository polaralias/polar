Prompt CM-02: Fix focus resolution and pending state gating (prevent “wrong that” delegation)

Mandatory pre-flight review
1) Read AGENTS.md.
2) Read docs/specs/FOCUS_CONTEXT_AND_PENDING.md.
3) Read last 150 lines of docs/IMPLEMENTATION_LOG.md.

Goal
- Make “that” resolve to the correct task using deterministic FocusContext rules.
- Ensure pending slot/tool retry states do not hijack unrelated tasks.

Implementation
- Implement a FocusContext resolver:
  - reply anchor wins
  - else lane recency
  - pending only if expected type matches
- Clear/expire pending when mismatch occurs.
- Pass focusAnchor snippet + ids to LLM router (if used).

Tests
- “do that via sub-agent” delegates the most recent lane task, not prior tool retry.
- slot-fill continues correctly when user provides the value.

Checks
- npm test
- npm run check:boundaries

Logging required per template.
