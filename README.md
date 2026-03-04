# Polar

Polar is a contract-first assistant runtime where **the model proposes and code enforces**.

It is designed for multi-surface assistants (Telegram + Web UI today) with hard safety boundaries:
- strict input/output contracts,
- non-bypassable middleware on provider/tool/handoff/automation calls,
- capability allowlists + approvals for sensitive actions,
- audit and lineage by default.

## Current platform state
- **Single composition root:** `@polar/platform` boots DB, stores, control plane, and runtime wiring.
- **Thin surfaces:** Telegram bot and Web UI are ingress/egress adapters around control-plane APIs.
- **LLM-first planning with deterministic policy:** routing, workflow planning, automation planning, focus resolution, and failure explanation are model-proposed, then schema-validated and policy-clamped in code.
- **Durable orchestrator state:** pending workflow/routing/thread-state records persist through memory-backed thread state.
- **Memory system (hybrid):**
  - lane/session summaries,
  - temporal attention snapshots,
  - extracted durable facts,
  - lane-first retrieval with cross-lane gating,
  - gated compaction (skip low-signal/no-key-detail summarization),
  - optional embedding-assisted rerank on top of SQLite search.

## Repository layout
- `packages/polar-platform/` - composition root (`createPolarPlatform`)
- `packages/polar-runtime-core/` - gateways, middleware, orchestrator, stores
- `packages/polar-control-plane/` - API surface, contract wiring, policy endpoints
- `packages/polar-bot-runner/` - Telegram surface
- `packages/polar-web-ui/` - operations/debug UI
- `packages/polar-cli/` - CLI entry surface
- `docs/` - canonical docs and specs

## Quick start
### Install
```bash
npm install
```

### Configure
Create `.env` in repo root.

Minimum Telegram setup:
```env
TELEGRAM_BOT_TOKEN=...
OPENAI_API_KEY=...
```

### Run
Run UI + Telegram bot:
```bash
npm run dev
```

Run individually:
```bash
npm run dev:ui
npm run dev:bot
```

### Validate
```bash
npm test
npm run check:boundaries
```

## Key functionality
- Contract-validated provider operations (`generate`, `stream`, `embed`) with fallback/cooldown policy.
- Workflow execution with deterministic capability-scope enforcement and approval handling.
- Automation jobs with scheduler queue processing and run ledger persistence.
- Deterministic chat command layer for operational/admin actions.
- Feedback/run/memory artifact exports under `artifacts/`.

## Docs
Start with:
- `docs/README.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/MEMORY_AND_FEEDBACK.md`
- `docs/IMPLEMENTATION_LOG.md`

Implementation specs live in `docs/specs/`. Historical documents are in `docs/_archive/2026-03-01/`.

## Development notes
- Follow `AGENTS.md` and relevant specs before coding.
- Record structural/behavioral decisions in `docs/IMPLEMENTATION_LOG.md`.
- Boundary rule: no cross-package `src/` imports from surfaces.

## License
See repository license files.
