Prompt CM-05: Routing and delegation (heuristics guardrails + LLM router with confidence)

Mandatory pre-flight review
1) Read AGENTS.md.
2) Read docs/specs/ROUTING_AND_DELEGATION_POLICY.md and docs/specs/FOCUS_CONTEXT_AND_PENDING.md.
3) Read last 150 lines of docs/IMPLEMENTATION_LOG.md.

Goal
- Improve delegation triggers (e.g. “write 10 email versions”) and prevent delegating the wrong task.
- Use LLM routing as the main chooser, but clamp with guardrails and confidence threshold.

Implementation
- Implement Stage A deterministic guardrails.
- Implement Stage B LLM router:
  - strict JSON schema output
  - confidence threshold (default 0.65)
- Enforce:
  - only installed tools can be called
  - only delegate to installed agent profiles
    - Introduce a default generic sub agent profile as fallback agent as part of this work  
- If confidence below threshold:
  - ask one short clarifying question (two-option disambiguation when possible)
- Sub agent spin up:
  - utilise our allowed skills/tools pass through functionality
  - Simple delegation for read tasks should not require approval
  - Delegation involing complex workflows and plans should require approval
  - Delegation for write and destructive tasks should require approval

Tests
- “write 10 versions of an email” routes to writer agent or structured multi-step workflow.
- “do that via sub-agent” routes to focus anchor task.

Checks: npm test, npm run check:boundaries
Logging required per template.
