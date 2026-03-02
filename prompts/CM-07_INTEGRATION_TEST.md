Prompt CM-07: Integration test for lane-scoped context and routing

Mandatory pre-flight review
1) Read AGENTS.md.
2) Read docs/specs/CONTEXT_MANAGEMENT_SYSTEM.md and docs/specs/ROUTING_AND_DELEGATION_POLICY.md.
3) Read last 150 lines of docs/IMPLEMENTATION_LOG.md.

Goal
- Add an integration-style test that proves:
  - threadKey scoping works (two lanes in same session)
  - summaries apply per lane
  - focus anchor prevents stale delegation
  - tool failure normalisation prevents loops

Implementation
- Boot platform against temp sqlite.
- Create messages in two threadKeys.
- Trigger compaction in one lane.
- Assert context assembly uses correct lane summary and recency messages.
- Run a router decision on an ambiguous “do that” and assert it prefers focus anchor.

Checks: npm test, npm run check:boundaries
Logging required per template.
