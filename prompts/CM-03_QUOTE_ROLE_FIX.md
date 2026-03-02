Prompt CM-03: Reply quoting and role-labelled context blocks (stop misattribution)

Mandatory pre-flight review
1) Read AGENTS.md.
2) Read docs/specs/ROLE_AND_QUOTE_RENDERING.md.
3) Read last 150 lines of docs/IMPLEMENTATION_LOG.md.

Goal
- Stop injecting reply quote strings into userText.
- Store replyTo as structured metadata with role labels.
- Render reply context blocks explicitly in prompt assembly.

Implementation
- Telegram runner: capture replyTo metadata block.
- Orchestrator context builder: include a labelled “Reply context” section.
- Add a small system/developer instruction to treat reply context as quoted material.

Tests
- Reply snippet not present in user message text.
- Prompt assembly includes reply context block.

Checks: npm test, npm run check:boundaries
Logging required per template.
