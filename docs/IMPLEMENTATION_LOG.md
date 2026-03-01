# Implementation log

A practical log of structural decisions and meaningful changes. This is the place to capture “why” as well as “what”, so the repo stays coherent over time.

## Entry template (use this every time)
## YYYY-MM-DD (UTC) - Prompt XX: <Short title>

**Branch:** `<branch-name>`  
**Commit:** `<hash>`  
**Prompt reference:** `Prompt XX` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/<SPEC_1>.md`  
- `docs/specs/<SPEC_2>.md`

### Summary
- <1–5 bullets: what changed at a high level>

### Scope and decisions
- **In scope:** <bullets>
- **Out of scope:** <bullets>
- **Key decisions:** <bullets, include defaults chosen>

### Files changed
- `path/to/file` - <what changed>
- `path/to/file` - <what changed>

### Data model / migrations (if applicable)
- **Tables created/changed:** <list>
- **Migration notes:** <any backfill, idempotency, fallback behaviour>
- **Risk:** <low/med/high> + why

### Security and safety checks
- **Allowlist changes:** <what changed, why>
- **Capabilities/middleware affected:** <what changed>
- **Sensitive operations:** <any new sensitive paths, how gated>

### Tests and validation
Commands run and outcomes:
- `npm test` - ✅/❌
- `npm run check:boundaries` - ✅/❌
- `<any other>` - ✅/❌

### Known issues / follow-ups
- <bullets, include links to files/lines if useful>

### Next
- **Next prompt:** `Prompt YY: <Short title>`
- **Suggested starting point:** <exact file(s) to open first>
- **Notes for next run:** <anything the next agent must know, incl. failures or partial work>

## 2026-03-01 (UTC) - Prompt 00: Baseline stabilisation

**Branch:** `main`  
**Commit:** `dcf5ce9`  
**Prompt reference:** `Prompt 00` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/BOUNDARIES.md`  
- `docs/specs/TESTING_STRATEGY.md`

### Summary
- Completed mandatory pre-flight review (`AGENTS.md`, `docs/README.md`, boundary and testing specs, latest implementation log handoff).
- Ran baseline install and validation commands.
- No baseline failures were found; no source-code fixes were required.

### Scope and decisions
- **In scope:** baseline validation only (`npm install`, `npm test`, `npm run check:boundaries`), implementation log update.
- **Out of scope:** feature work, refactors, dependency upgrades, vulnerability remediation.
- **Key decisions:** because all checks passed, retained code as-is and logged the verified baseline state.

### Files changed
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 00 baseline stabilisation entry with validation outcomes and next handoff.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none
- **Risk:** low (documentation-only change; runtime code unchanged)

### Security and safety checks
- **Allowlist changes:** none
- **Capabilities/middleware affected:** none
- **Sensitive operations:** none

### Tests and validation
Commands run and outcomes:
- `npm install` - ✅ (up to date)
- `npm test` - ✅ (361 passed, 0 failed)
- `npm run check:boundaries` - ✅

### Known issues / follow-ups
- `npm install` reported 20 vulnerabilities (19 low, 1 high); no remediation applied in this baseline-only prompt.

### Next
- **Next prompt:** `Prompt 01: <execute next implementation prompt>`
- **Suggested starting point:** `docs/IMPLEMENTATION_LOG.md` (latest entry), then Prompt 01 requirements/spec references.
- **Notes for next run:** baseline is green; proceed directly to Prompt 01 implementation.

## 2026-03-01 (UTC) - Prompt 01: Add @polar/platform composition root

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 01` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/BOOTSTRAP.md`  
- `docs/specs/BOUNDARIES.md`

### Summary
- Added new workspace package `@polar/platform` as the composition root.
- Implemented `createPolarPlatform({ dbPath, now?, auditSink?, devMode? })` with durable SQLite-backed store wiring and `shutdown()`.
- Refactored bot runner and web UI server bootstrap to consume `@polar/platform` instead of directly wiring DB/control plane.
- Removed cross-package `/src` imports from those surfaces and switched to workspace package imports.

### Scope and decisions
- **In scope:** new platform package, surface bootstrap wiring updates, dependency manifest updates, validation and logging.
- **Out of scope:** feature behavior changes, control-plane internals refactor, dotenv behavior changes in surfaces.
- **Key decisions:** `@polar/platform` resolves and opens a single DB instance and exposes `platform.controlPlane`; shutdown closes DB idempotently.

### Files changed
- `packages/polar-platform/package.json` - new workspace package manifest for `@polar/platform`.
- `packages/polar-platform/src/index.mjs` - added composition root with `createPolarPlatform`, `closePolarPlatform`, and `defaultDbPath`.
- `packages/polar-bot-runner/src/index.mjs` - replaced direct DB/store/control-plane construction with `createPolarPlatform`.
- `packages/polar-bot-runner/package.json` - added `@polar/platform` dependency and removed direct `better-sqlite3` dependency.
- `packages/polar-web-ui/vite.config.js` - replaced direct DB/store/control-plane construction with `createPolarPlatform`.
- `packages/polar-web-ui/package.json` - switched dependency from direct control-plane/DB wiring to `@polar/platform`.
- `package-lock.json` - workspace lockfile update for the new package/dependency graph.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 01 structural change record.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none
- **Risk:** low (composition-root extraction and import rewiring only; no schema change)

### Security and safety checks
- **Allowlist changes:** none
- **Capabilities/middleware affected:** no middleware bypass introduced; control-plane service remains the only orchestration API used by surfaces.
- **Sensitive operations:** DB open/close centralized in `@polar/platform`; no dotenv import added to library packages.

### Tests and validation
Commands run and outcomes:
- `npm install` - ✅
- `npm test` - ✅ (361 passed, 0 failed)
- `npm run check:boundaries` - ✅

### Known issues / follow-ups
- Existing boundary checker script remains pi-import focused (`scripts/check-pi-mono-imports.mjs`); future prompt should upgrade enforcement to full workspace boundary checks from `docs/specs/BOUNDARIES.md`.
- `npm install` still reports 20 vulnerabilities (19 low, 1 high); unchanged in this prompt.

### Next
- **Next prompt:** `Prompt 02: Migrate remaining surfaces/entrypoints to @polar/platform`
- **Suggested starting point:** `packages/polar-cli/` bootstrap path(s), then boundary checker script alignment with workspace rules.
- **Notes for next run:** `@polar/platform` exists and bot/web surfaces now consume it; continue convergence on single composition-root usage.
