Prompt CM-06: Emoji state machine verification (no regressions)

Mandatory pre-flight review
1) Read AGENTS.md.
2) Read docs/specs/EMOJI_SUPPORT_AND_STATE_MACHINE.md.
3) Read last 150 lines of docs/IMPLEMENTATION_LOG.md.

Goal
- Verify emoji system matches supported set and state machine.
- Ensure workflow callbacks update waiting_user -> done and schedule clear.
- Ensure per-chat unsupported emoji cache and “hasAnySuccess” logic remain intact.

Implementation
- Add/adjust tests for:
  - fallback selection when emoji unsupported
  - no chat-wide disable if any success occurred
  - workflow approval transitions reaction state

Checks: npm test, npm run check:boundaries
Logging required per template.
