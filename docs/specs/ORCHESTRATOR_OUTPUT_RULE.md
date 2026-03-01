# Orchestrator output rule

## Goal
Make Polar feel like a coherent assistant with consistent tone and personalisation across:
- chat replies
- automation messages (proactive)
- confirmations after deterministic commands (personality set, agent/model config, etc.)

Golden rule:
> **Any user-facing message must be produced by the orchestrator.**  
Exceptions are limited to pure code acknowledgements and failure fallbacks.

This prevents “two voices”: one from LLM, another from hard-coded strings.

---

## Definitions
- **User-facing message**: anything the user reads as part of the assistant conversation.
- **Code acknowledgement**: an immediate, minimal response needed to complete an interaction safely (e.g. “Approved”, “Cancelled”, error to unblock the user) where orchestration is not appropriate.
- **Side-effect free orchestration**: calling the orchestrator in a mode that does not write memory, tasks, jobs, or other durable state.

---

## Where this applies
### Must go through orchestrator
1) Normal chat turns (already true).
2) Automation runs:
   - reminders
   - progressive overload weekly updates
   - inbox header checks (later)
3) Deterministic command responses:
   - personality set/reset confirmation
   - automation create/enable/disable confirmation
   - agent profile registry updates
   - model registry updates
4) “System messages” that explain what just happened (unless explicitly a code ack).

### Allowed exceptions (limited)
- Workflow approve/reject callbacks: may respond with a short code acknowledgement (e.g. “Approved, running now…”) but the **resulting** message must be orchestrated.
- Inline button selection handling: may ack and then orchestrate the outcome.
- Hard failure path if orchestrator is unavailable: provide a deterministic error message.

---

## Side-effect free orchestration mode
When producing messages for commands/acks, the orchestrator call must be run in a mode that prevents unintended writes.

Required flags (names can vary, but behaviour must match):
- `suppressUserMessagePersist=true` (do not persist the command as a user chat message)
- `suppressMemoryWrite=true`
- `suppressTaskWrites=true`
- `suppressAutomationWrites=true` (if applicable)
- `executionType="system"` or `"command"` in metadata (for auditing and routing)

If these flags do not exist yet, add them and default them to false for normal chat turns.

---

## Input format to the orchestrator for confirmations
Use a short, structured instruction that includes factual data, and asks the orchestrator to phrase it.

Example (personality set):
- Facts:
  - scope=user
  - updatedAt=...
- Orchestrator input text:
  "Confirm personality has been updated for user scope. Briefly explain how responses will change. Keep it to 2-3 sentences."

Example (automation created):
- Facts:
  - schedule="weekly Mon 07:00"
  - prompt="Update my routine"
  - quietHours="22:00-07:00"
- Orchestrator input text:
  "Confirm the automation job has been created and when it will run. Mention quiet hours and how to disable it."

---

## Automation delivery requirements
Automation runner must:
- create a synthetic turn and call `controlPlane.orchestrate(...)`
- deliver ONLY the orchestrator’s output text to the channel
- record run outcome in the run ledger

It must not:
- send raw strings without orchestration
- bypass middleware
- perform tool calls directly from runner without going through orchestrator

---

## Command router requirements
Commands remain deterministic for state changes, but after applying the change:
- produce a confirmation message via orchestrator (side-effect free mode)
- do not append the command itself to session history

Exceptions:
- `/status` and `/whoami` should remain deterministic factual outputs to avoid hallucination.
- `/help` may remain deterministic (recommended).

---

## Auditing
Tag orchestrator calls triggered by commands/automations:
- metadata: `executionType = "automation" | "command" | "system"`
- include relevant identifiers: jobId, commandName, etc.

---

## Tests (minimum)
- Command handler does not append the command input as a user message.
- Personality set produces orchestrator-generated confirmation (and uses new personality).
- Automation runner delivers orchestrator text and logs run.
- Workflow callback ack is minimal, but final message is orchestrated.

---

## Implementation checklist
- Add a helper: `orchestrateSystemReply({ sessionId, userId, threadKey, instructionText, facts, flags })`
- Use it in:
  - command router (for confirmations)
  - automation runner (optional wrapper)
  - workflow callbacks (final outputs)
