Prompt CM-04: Tool/workflow failure normalisation (no loops, graceful degrade)

Mandatory pre-flight review
1) Read AGENTS.md.
2) Read docs/specs/TOOL_FAILURE_NORMALISATION.md and docs/specs/WORKFLOW_EXECUTION_INTEGRITY.md.
3) Read last 150 lines of docs/IMPLEMENTATION_LOG.md.

Goal
- Classify tool/workflow errors into stable categories.
- Clear pending retry states on ToolUnavailable/Misconfigured/InternalContractBug.
- Return user-facing explanation via orchestrator.

Implementation
- Add a normaliser function in runtime-core for tool/workflow execution errors:
  - map gateway errors to categories
  - attach metadata for auditing
- Update orchestrator outputs for tool failures to be stable and non-retry spammy.
- Ensure “try again” offers only appear for transient errors and only when user asks.

Tests
- ToolUnavailable produces a “not available” response and clears pending.
- InternalContractBug does not crash; it logs and returns stable error.

Checks: npm test, npm run check:boundaries
Logging required per template.
