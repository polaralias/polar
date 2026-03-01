# Automation runner and proactive execution

## Purpose
Automations are opt-in jobs that execute without a user sending a message at that moment. They must still run through the same orchestration pipeline and the same middleware as normal chat.

This document specifies:
- how automation jobs are stored
- how due jobs are scheduled and executed
- how results are delivered back to a surface (Telegram first)
- what must be logged for audit and continuous improvement

Related:
- `docs/AUTOMATIONS.md` (product intent)
- `docs/specs/DATA_MODEL.md` (tables)
- `docs/specs/CONTROL_PLANE_API.md` (planned methods)

## Definitions
- Job: a persisted automation configuration (schedule + promptTemplate + limits)
- Run: an execution instance of a job at a specific time
- Delivery: a message posted into a channel (Telegram) as a result of a run

## Storage
Use SQLite as source of truth.

Required tables (see `docs/specs/DATA_MODEL.md`):
- `polar_automation_jobs`
- `polar_run_events` (run ledger, source=automation)

You may also store delivery metadata in `polar_automation_jobs.limitsJson` or a dedicated table later. Keep MVP minimal.

## Execution model
### Golden rule
An automation run must be represented as a normal orchestrator call.

Implementation approach:
- Each run creates a synthetic envelope:
  - `executionType = "automation"`
  - `automationJobId = <job id>`
  - `trigger = "schedule"`

Envelope fields:
- `sessionId`: job.sessionId
- `userId`: job.ownerUserId
- `text`: rendered `promptTemplate`
- `channel`: should identify the delivery channel, eg `telegram` (even though the run is triggered by scheduler)
- `metadata`: include `executionType`, `automationJobId`, `trigger`, and any quiet-hours info used

This envelope is passed into:
- `controlPlane.orchestrate(envelope)`

No alternate “background LLM call” path is allowed.

### Due calculation
MVP options:
1) Use an internal runner loop that wakes every N seconds and checks schedules.
2) Use the existing scheduler queue and schedule “next run” events into `polar_scheduler_events`.

Pick one. For MVP, option (1) is simpler, but it must still be reliable.

If using option (1):
- parse schedule text in job.schedule
- compute whether job is due at current time
- apply quiet hours
- enforce per-job run caps

### Quiet hours and limits
Default recommendations (can be overridden per job):
- quiet hours: 22:00–07:00 (local time if you have it, otherwise UTC and document it)
- max notifications per day: 3
- backoff on errors: exponential, capped (store in metadata if needed)

The runner must not spam:
- If a job misses a run window, do not “catch up” by firing many runs at once.

## Delivery model (Telegram MVP)
Telegram runner owns the Telegram API. The automation runner must not embed bot tokens everywhere.

MVP delivery options, from simplest to cleanest:
1) Automation runner writes the assistant message into the session store and emits a scheduler event that the Telegram runner consumes.
2) Automation runner calls a channel adapter owned by control plane that sends to Telegram (requires storing chat id and token access).
3) Telegram runner periodically polls “pending deliveries” from SQLite and sends them.

Recommended MVP:
- If you already have a scheduler queue and a channel adapter boundary, use (1).
- Otherwise, implement (3): Telegram runner polls a `polar_delivery_queue` table. Keep it minimal.

If implementing a delivery queue table (recommended for Telegram MVP):
- `polar_delivery_queue`
  - `deliveryId TEXT PRIMARY KEY`
  - `sessionId TEXT NOT NULL`
  - `channel TEXT NOT NULL` (`telegram`)
  - `payload TEXT NOT NULL` (JSON: text, replyTo, threadId)
  - `status TEXT NOT NULL` (`pending`, `sent`, `failed`)
  - `createdAtMs INTEGER NOT NULL`
  - `updatedAtMs INTEGER NOT NULL`
Indexes:
- `(status, createdAtMs)`

Runner flow:
- automation runner executes orchestrate
- writes a delivery row with the produced assistant text
- Telegram runner picks it up and sends it, then marks sent and binds channel ids

## Logging and audit
Every run must be written to `polar_run_events` via run-event-linker:
- source = `automation`
- id = job id
- runId = deterministic id (uuid)
- output JSON includes:
  - success/failure
  - assistant summary
  - tool calls used (if available)
  - budget usage (if available)

Also ensure normal auditSink events are emitted.

## Failure handling
- If orchestration fails, record a failed run in ledger.
- Do not retry forever. Use limited retries with backoff.
- If a job fails repeatedly, disable it and notify the user once (optional later).

## Acceptance criteria
- Jobs are persisted and listed.
- Runner executes due jobs through `controlPlane.orchestrate`.
- Delivery posts to Telegram (via delivery queue or adapter).
- Runs are recorded in `polar_run_events`.
- No direct provider calls from runner.

## Tests
At minimum:
- unit test: due calculation + quiet hours logic
- integration test: create job, run runner tick, verify:
  - orchestrate called
  - delivery queued
  - run ledger row created

Run:
- `npm test`

## Agent checklist
- Check `AGENTS.md` first.
- When done, write to `docs/IMPLEMENTATION_LOG.md`.
