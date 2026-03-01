# Polar ❄️

Polar is a contract-first runtime for building an extendable assistant (starting with a Telegram bot) where **code decides** and the model can only propose.

The goal is OpenClaw-style extensibility (skills, workflows, multi-agent patterns) with much stronger safety guarantees: middleware on every call, explicit capabilities, approvals, audit trails, and persistent state.

## What’s in this repo
- **Runtime spine:** `packages/polar-runtime-core/`
- **Control plane:** `packages/polar-control-plane/` (contracts, registries, gateway wiring)
- **Surfaces:** `packages/polar-bot-runner/` (Telegram), plus a lightweight Web UI for ops and debugging
- **Docs:** `docs/` (truth set), `docs/specs/` (implementation-grade), `docs/_archive/` (reference-only history)

## Docs and specs
- Start with `docs/README.md`.
- If you are implementing anything, read the relevant spec under `docs/specs/` first.
- All meaningful changes should be recorded in `docs/IMPLEMENTATION_LOG.md`.

## Quick start
### Install
```bash
npm install
```

### Configure
Create `.env` in the repo root.

Minimum for Telegram:
```env
TELEGRAM_BOT_TOKEN=...
OPENAI_API_KEY=...
```

### Run
Run Web UI + Telegram bot together:
```bash
npm run dev
```

Or individually:
```bash
npm run dev:ui
npm run dev:bot
```

### Tests
```bash
npm test
npm run check:boundaries
```

## Docs structure (current truth set)
Start here:
- `docs/README.md` (docs index)
- `docs/ARCHITECTURE.md` (how Polar is wired)
- `docs/SECURITY.md` (non-negotiables: contracts, middleware, approvals, audit)
- `docs/SKILLS.md` (skill model and installation)
- `docs/AUTOMATIONS.md` (scheduled/proactive behaviour model)
- `docs/MEMORY_AND_FEEDBACK.md` (memory vs feedback events, projections, exports)
- `docs/DEVELOPMENT.md` (local dev and conventions)
- `docs/IMPLEMENTATION_LOG.md` (decision and change log)

Older deep-dives and prior drafts are archived under:
- `docs/_archive/2026-03-01/`

## Current product focus
- Single spine, multiple thin surfaces (Telegram first)
- Skills that install cleanly and execute safely through the gateway
- Automations and proactive updates implemented as scheduled jobs that run through the same middleware pipeline
- Memory and feedback captured as queryable events (with markdown exports as optional projections)

## Licence
See repo files.
## Key concepts
- **Sub-agent profiles:** task-specific profiles (e.g. writer/researcher) the orchestrator can delegate to. See `docs/specs/AGENT_PROFILES.md`.
- **Deterministic chat commands:** configuration via `/` commands without LLM intent guessing. See `docs/specs/CHAT_COMMANDS.md`.
