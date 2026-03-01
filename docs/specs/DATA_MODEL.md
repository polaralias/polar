# SQLite data model and persistence rules

## Source of truth
SQLite is the current source of truth. The default DB file is `polar-system.db` at repo root (current behaviour).

Markdown “living files” are projections only. Runtime must not depend on markdown files existing.

## Existing tables (current code)

### Memory
Created by `packages/polar-runtime-core/src/memory-provider-sqlite.mjs`

- `polar_memory`
  - `memoryId TEXT PRIMARY KEY`
  - `sessionId TEXT NOT NULL`
  - `userId TEXT NOT NULL`
  - `scope TEXT NOT NULL`
  - `type TEXT NOT NULL`
  - `record TEXT NOT NULL` (JSON)
  - `metadata TEXT NOT NULL` (JSON)
  - `createdAtMs INTEGER NOT NULL`
  - `updatedAtMs INTEGER NOT NULL`

Optional:
- `polar_memory_fts` (FTS5)
  - Use if available.
  - If not present, fallback search uses `LIKE` over JSON text.

### Scheduler
Created by `packages/polar-runtime-core/src/scheduler-state-store-sqlite.mjs`

- `polar_scheduler_events`
  - `(eventId, queue)` primary key
  - `payload TEXT` (JSON)
- `polar_scheduler_run_log`
  - `runId TEXT PRIMARY KEY`

### Budget
Created by `packages/polar-runtime-core/src/budget-state-store-sqlite.mjs`

- `polar_budget_policies` primary key `(scope, targetId)`
- `polar_budget_usage` primary key `(scope, targetId)`

## Planned tables (next work)

### Feedback events (reactions and quality signals)
Create:
- `polar_feedback_events`
  - `id TEXT PRIMARY KEY` (uuid)
  - `type TEXT NOT NULL` (eg `reaction_added`)
  - `sessionId TEXT NOT NULL`
  - `messageId TEXT` (synthetic or channel id)
  - `emoji TEXT`
  - `polarity TEXT` (`positive`, `negative`, `neutral`)
  - `payload TEXT` (JSON)
  - `createdAtMs INTEGER NOT NULL`

Indexes:
- `(sessionId, createdAtMs)`
- `(type, createdAtMs)`

Rules:
- Append-only.
- Store enough to analyse and export. Do not dump the full session history into payload.

### Run ledger (automation and heartbeat runs)
Create:
- `polar_run_events`
  - `sequence INTEGER PRIMARY KEY AUTOINCREMENT`
  - `source TEXT NOT NULL` (`automation` or `heartbeat`)
  - `id TEXT NOT NULL` (automationId or policyId)
  - `runId TEXT NOT NULL`
  - `profileId TEXT NOT NULL`
  - `trigger TEXT NOT NULL`
  - `output TEXT NOT NULL` (JSON)
  - `metadata TEXT` (JSON, optional)
  - `createdAtMs INTEGER NOT NULL`

Constraints:
- `UNIQUE (source, id, runId)`

Rules:
- Append-only.
- Must survive restarts.
- Replay into task board must be idempotent.

### Automation jobs (scheduled proactive)
Create:
- `polar_automation_jobs`
  - `id TEXT PRIMARY KEY`
  - `ownerUserId TEXT NOT NULL`
  - `sessionId TEXT NOT NULL`
  - `schedule TEXT NOT NULL` (RRULE or cron as text)
  - `promptTemplate TEXT NOT NULL`
  - `enabled INTEGER NOT NULL` (0/1)
  - `quietHoursJson TEXT` (JSON, optional)
  - `limitsJson TEXT` (JSON, optional)
  - `createdAtMs INTEGER NOT NULL`
  - `updatedAtMs INTEGER NOT NULL`

Indexes:
- `(sessionId, enabled)`
- `(enabled)`

Rules:
- Opt-in only.
- Enabled by default once created.
- Execution must run through the same middleware pipeline as chat turns.

## Markdown exports (projection only)
Folder:
- `artifacts/`

Exports:
- `artifacts/REACTIONS.md` from `polar_feedback_events`
- `artifacts/HEARTBEAT.md` from `polar_run_events` where `source=heartbeat`
- `artifacts/MEMORY.md` from `polar_memory` summary view

Rules:
- Telegram runner must not write these files.
- Web UI may read them (allowlist), writing is usually disabled.

## Acceptance criteria
- Runtime does not depend on markdown files.
- Table schemas are implemented as specified.
- Tests pass: `npm test`

## Agent checklist
- Check `AGENTS.md` first.
- When done, write to `docs/IMPLEMENTATION_LOG.md`.

### Personality profiles
Table: `polar_personality_profiles`
See: `docs/specs/PERSONALITY_STORAGE.md`
