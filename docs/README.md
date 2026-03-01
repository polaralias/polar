# Polar docs

These are the **current** docs.

Older deep-dives and historical notes live in:
- `docs/_archive/2026-03-01/` (reference-only)

## Start here (truth set)
- **`ARCHITECTURE.md`**: what Polar is and how it’s meant to be wired
- **`SECURITY.md`**: non-negotiables (contracts, middleware, approvals, audit)
- **`SKILLS.md`**: skills and installation model
- **`AUTOMATIONS.md`**: scheduling, proactive updates, inbox-style checks
- **`MEMORY_AND_FEEDBACK.md`**: memory vs event logging, reactions, heartbeat, what we persist
- **`DEVELOPMENT.md`**: how to run locally, tests, repo conventions

Change history:
- `IMPLEMENTATION_LOG.md`

## Specs (implementation-grade, agent-safe)
If you’re implementing or refactoring code, read the relevant spec first:

- `specs/BOOTSTRAP.md`
- `specs/CONTROL_PLANE_API.md`
- `specs/DATA_MODEL.md`
- `specs/TELEGRAM_SURFACE.md`
- `specs/WEB_UI_SURFACE.md`
- `specs/AUTOMATION_RUNNER.md`
- `specs/ARTIFACT_EXPORTS.md`
- `specs/BOUNDARIES.md`
- `specs/PROACTIVE_INBOX.md`
- `specs/TESTING_STRATEGY.md`
- `specs/PERSONALISATION.md`
- `specs/PERSONALITY_STORAGE.md`