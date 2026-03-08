# Telegram runner surface contract

## Purpose
Telegram runner is a thin surface:
- normalises Telegram events into Polar turns
- persists user messages
- calls `controlPlane.orchestrate(envelope)`
- renders replies
- handles Telegram UX (threading, grouping, reactions, buttons)

It must not:
- call LLM providers directly
- bypass middleware
- write primary storage into markdown files

Source:
- `packages/polar-bot-runner/src/index.mjs`

## Session id mapping
Stable convention (do not change casually):
- `sessionId = "telegram:chat:" + chat.id`

Threading:
- Topic/thread ids can be stored in metadata, but sessionId stays at chat-level.

## Message id mapping
User messages:
- `messageId = "msg_u_" + telegramMessageId`

Assistant messages:
- `messageId = "msg_a_" + telegramMessageId`

Binding internal ids:
- After sending an assistant message, runner may call:
  - `controlPlane.updateMessageChannelId(sessionId, internalId, channelId)`
to bind orchestrator-produced ids to Telegram ids.

## Ingress handling
### Text messages
1) Resolve session context (existing helper)
2) Persist user message via `appendMessage`
3) Call `orchestrate` with envelope `{ sessionId, userId, text, channel:"telegram", metadata:{ executionType:"interactive", replyTo?, threadId?, ... } }`
4) Send reply to Telegram
5) Bind ids (if applicable)

### Attachments
- Persist references and summaries, not raw base64.
- Avoid bloating DB and model context.

## UX invariants
### Grouping/debounce
If grouping is used:
- preserve ordering
- do not drop messages silently
- store merged text once via `appendMessage`
All debounce/threading/reaction behaviour must comply with `docs/specs/TELEGRAM_THREADING_AND_EMOJI.md`.

### Buttons and callbacks
Callback payloads must be validated before use.
On approval actions, clear inline markup to prevent duplicate execution.

Known callback types:
- workflow cancel for already-started runs
- workflow approve/reject/details for dry-run proposals
- automation reject/delete for auto-created jobs
- automation proposal approve/reject fallback when auto-create fails
- repair selection handlers

### Workflow proposal handling
When `orchestrate(...)` returns `workflow_proposed`:
- `proposalMode = "auto_start"`: render a cancel/reject affordance, then immediately call `executeWorkflow(...)`.
- `proposalMode = "dry_run_approval"`: render a human preview plus `Approve`, `Reject`, and optional `Details` controls. Do not execute live until the user approves.

Dry-run details:
- `Approve` calls `executeWorkflow({ workflowId, approved: true })`.
- `Reject` calls `rejectWorkflow(...)` and keeps the follow-up conversation in the same Telegram thread.
- `Details` may call `getWorkflowProposal(...)` to render the preview payload on demand.

Cancellation semantics:
- `cancelWorkflow(...)` is the hard stop path for future steps and the best-effort interruption path for the current step.
- Telegram should report cancellation as a stateful update, not as a silent button press.

### Automation handling
When `orchestrate(...)` returns `automation_created`:
- render the created job summary in-thread,
- attach a reject/delete affordance,
- if the user rejects, delete the created job but preserve audit history and continue the conversation in the same thread.

If `orchestrate(...)` falls back to `automation_proposed`:
- surface explicit approve/reject buttons,
- approval should atomically consume the proposal before creating the job.

## Reactions and feedback
Reactions are persisted as feedback events in SQLite (`polar_feedback_events`) via control-plane APIs.

Reaction mapping:
- positive: 👍 💯 🔥
- negative: 👎
Everything else is neutral.

Reaction processing must:
- validate structure
- locate target assistant message by message id mapping using `getSessionHistory`
- record a feedback event with payload including:
  - emoji, polarity
  - telegram message id
  - target message text (if found)
  - timestamp

Must not:
- write markdown files
- store full session transcript inside payload

## Bootstrapping
Telegram runner must obtain `controlPlane` via `@polar/platform`.

It must not:
- create `better-sqlite3` instances directly (post-bootstrap refactor)
- import other packages’ `src/` paths

## Tests
Protect behaviour with tests for:
- sessionId mapping stability
- workflow callbacks do not double execute
- reactions are persisted as events (not a file write)
- updateMessageChannelId called for assistant replies (where used)

Run:
- `npm test`

## Agent checklist
- Check `AGENTS.md` first.
- When done, write to `docs/IMPLEMENTATION_LOG.md`.

## See also
- `docs/specs/TELEGRAM_THREADING_AND_EMOJI.md` (threadKey buffering, anchor mapping, emoji lifecycle)
- See also: `docs/specs/CONTEXT_MANAGEMENT_SYSTEM.md`, `docs/specs/FOCUS_CONTEXT_AND_PENDING.md`, `docs/specs/ROLE_AND_QUOTE_RENDERING.md`
