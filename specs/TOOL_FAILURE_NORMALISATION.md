# Tool failure normalisation (extensions, gateway errors, graceful degradation)

## Problem
Errors like:
- `Invalid extension.gateway.execute.request`
- `Invalid chat.management.gateway.message.append.request`
surface as crashes or cause retry loops and stale pending states.

## Goal
Classify tool/workflow failures into clear categories, stop unsafe retries, clear pending state appropriately, and generate a user-facing explanation via orchestrator.

---

## Error categories
### ToolUnavailable
Tool/extension not installed or not registered.
Signals:
- invalid extension execute request
- missing tool id / missing extension id

Behaviour:
- Mark tool as unavailable for this deployment (or at least for this session).
- Clear pending retry offers for this tool.
- Respond: “This capability isn’t available in this deployment yet.”

### ToolMisconfigured
Tool exists but missing credentials/config.
Signals:
- auth failures, missing api key, misconfigured base url

Behaviour:
- Do not keep retrying.
- Suggest configuration steps (operator-only if needed).

### ToolTransientError
Network timeouts, 5xx, rate limits.
Behaviour:
- Allow 1 retry if user explicitly asks.
- Otherwise record error and move on.

### ToolValidationError
Bad inputs, schema mismatch.
Behaviour:
- Ask for the missing/invalid input explicitly.

### InternalContractBug
Your own gateways/contracts rejected a request.
Signals:
- `Invalid chat.management.gateway.message.append.request`
Behaviour:
- Return a stable user-facing error (“Something broke internally, I’ve logged it.”)
- Record an internal error event for debugging.
- Avoid cascading failures (do not attempt tool retries).

---

## Where to implement
- Tool execution wrapper in runtime-core (where extension.gateway.execute is invoked).
- Workflow execution path (executeWorkflow / delegate_to_agent) should share the same normaliser.
- Telegram runner should not “retry blindly”; it should display the orchestrator-produced message.

---

## Pending state cleanup rules
On ToolUnavailable / ToolMisconfigured / InternalContractBug:
- Clear any pending state related to that tool/workflow in that threadKey.
- Do not interpret later “do that through a sub-agent” as retrying that tool.

---

## Acceptance criteria
- Missing tools produce a graceful response and do not loop.
- Contract errors do not crash the bot; they produce a stable error message and allow continuing conversation.
- Pending state does not linger after a hard failure class.

---

## Tests
- ToolUnavailable classified correctly from gateway error string.
- Pending state cleared for that lane.
- User-facing response produced via orchestrator.

---

## Agent checklist
- Check AGENTS.md first.
- Read last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write a log entry when done.
