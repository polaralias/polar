# Personality storage and control-plane API

## Purpose
Define persistence, API surface, and how orchestration retrieves the effective personality.

## Data model (SQLite)
Create table: `polar_personality_profiles`

Recommended schema:
- `profileId TEXT PRIMARY KEY`
- `scope TEXT NOT NULL` (`global` | `user` | `session`)
- `userId TEXT` (nullable, required for `user` and `session`)
- `sessionId TEXT` (nullable, required for `session`)
- `name TEXT` (optional)
- `prompt TEXT NOT NULL`
- `createdAtMs INTEGER NOT NULL`
- `updatedAtMs INTEGER NOT NULL`

Constraints:
- For `global`: userId/sessionId must be NULL
- For `user`: userId required, sessionId NULL
- For `session`: userId + sessionId required

Indexes:
- `idx_personality_user` on `(userId, scope)`
- `idx_personality_session` on `(sessionId, userId, scope)`

Uniqueness rules (enforced in code):
- At most one `global` profile
- At most one `user` profile per userId
- At most one `session` profile per (sessionId, userId)

## Runtime-core store interface
Add module in `@polar/runtime-core`:
- `createSqlitePersonalityStore({ db, now })`

Interface:
- `getEffectiveProfile({ userId, sessionId }) -> { scope, prompt, updatedAtMs } | null`
- `getProfile({ scope, userId?, sessionId? }) -> profile | null`
- `upsertProfile({ scope, userId?, sessionId?, name?, prompt }) -> profile`
- `resetProfile({ scope, userId?, sessionId? }) -> { deleted: boolean }`
- `listProfiles({ scope?, userId?, limit? }) -> profile[]` (operator support)

Validation rules in store:
- Enforce max length (2,000 chars)
- Trim trailing whitespace
- Reject empty prompt on upsert

## Control-plane API
Control plane must expose explicit methods. Surfaces must not access SQLite store directly.

Add methods:
- `getPersonalityProfile(request)`
  - request: `{ scope: "global"|"user"|"session", userId?, sessionId? }`
- `getEffectivePersonality(request)`
  - request: `{ userId, sessionId }`
- `upsertPersonalityProfile(request)`
  - request: `{ scope, userId?, sessionId?, name?, prompt }`
- `resetPersonalityProfile(request)`
  - request: `{ scope, userId?, sessionId? }`
- `listPersonalityProfiles(request)` (operator)
  - request: `{ scope?, userId?, limit? }`

## Orchestrator integration
Orchestrator must request effective personality once per turn and inject it into the prompt context.

Rule:
- Personality must be inserted as a labelled section and must not override system/developer rules.

Example insertion (conceptual):
- system blocks (policy)
- developer blocks (app policy)
- personality block (style)
- memory recall
- user message

## Acceptance criteria
- Store persists profiles in SQLite.
- Control plane exposes the methods listed above.
- Orchestrator uses `getEffectivePersonality` (or store directly if injected) and changes tone accordingly.
- Tests cover precedence: session > user > global.

## Agent checklist
- Check `AGENTS.md` first.
- Read the last 150 lines of `docs/IMPLEMENTATION_LOG.md` before starting.
- Write a log entry using the agreed template when done.