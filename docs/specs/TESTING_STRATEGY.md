# Testing strategy for refactors and safety

## Purpose
This repo is refactor-heavy. Without a small number of high-value tests, the system regresses into “works locally, breaks UX”.

This document defines minimum tests that must exist before broad refactors.

## Required test layers
1) Boundary checks
- Scripted enforcement of workspace boundaries.
- Command: `npm run check:boundaries`

2) Vertical slice integration test
Add one test that spans:
- bootstrap (`@polar/platform`)
- control plane orchestration (`orchestrate`)
- persistence (memory/events)
- basic middleware enforcement

Location:
- `tests/integration-vertical-slice.test.mjs`

3) Surface behaviour tests (Telegram)
Protect invariants that users notice:
- message id mapping stability
- reaction handling persists events, not files
- workflow callbacks are idempotent

4) Security regression tests (Web UI)
- allowlist rejects unknown actions
- markdown path validation rejects traversal

## When to add tests
- When you fix a bug that could regress: add a test that fails before the fix and passes after.
- When you change bootstrap: ensure vertical slice test covers it.

## Acceptance criteria
- `npm test` runs without network access.
- CI fails on boundary violations.
- At least one integration test exists and is meaningful.

## Agent checklist
- Check `AGENTS.md` first.
- When done, write to `docs/IMPLEMENTATION_LOG.md`.
