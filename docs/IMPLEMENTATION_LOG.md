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

## 2026-03-01 (UTC) - Prompt 02: Refactor Telegram runner to use @polar/platform

**Branch:** `main`  
**Commit:** `a1a3fcb`  
**Prompt reference:** `Prompt 02` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/BOOTSTRAP.md`  
- `docs/specs/TELEGRAM_SURFACE.md`  
- `docs/specs/BOUNDARIES.md`

### Summary
- Confirmed Telegram runner is wired through `@polar/platform` and remains a thin surface over `platform.controlPlane`.
- Updated runner bootstrap to call `createPolarPlatform({ dbPath })` with explicit existing `polar-system.db` path behavior.
- Removed unused bot-runner dependencies left from pi-era wiring (`@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `mcp-client`, `ws`).
- Verified zero cross-package `/src` imports in bot runner source.

### Scope and decisions
- **In scope:** Telegram runner bootstrap conformance tweaks, dependency cleanup, validation, and implementation log update.
- **Out of scope:** behavioural changes to threading/grouping/callback/reaction flows, broader boundary script overhaul, other surfaces.
- **Key decisions:** keep runtime behavior unchanged by preserving existing DB path resolution (`path.resolve(process.cwd(), '../../polar-system.db')`) while simplifying imports.

### Files changed
- `packages/polar-bot-runner/src/index.mjs` - kept `@polar/platform` composition root usage, switched to explicit dbPath resolution, removed unused `defaultDbPath` and `crypto` imports.
- `packages/polar-bot-runner/package.json` - removed unused dependencies (`@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `mcp-client`, `ws`).
- `package-lock.json` - updated workspace lockfile after dependency removal.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 02 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none
- **Risk:** low (surface wiring/dependency cleanup only; no schema or orchestration contract changes)

### Security and safety checks
- **Allowlist changes:** none
- **Capabilities/middleware affected:** none; Telegram runner continues to call control-plane APIs only.
- **Sensitive operations:** none added; no direct provider wiring introduced.

### Tests and validation
Commands run and outcomes:
- `npm install` - ✅ (removed unused packages)
- `npm test` - ✅ (361 passed, 0 failed)
- `npm run check:boundaries` - ✅
- `rg "\.\./.*polar-.*/src/|\.\./\.\./.*polar-.*/src/|/polar-.*/src/" packages/polar-bot-runner/src/index.mjs` - ✅ (no matches)

### Known issues / follow-ups
- Boundary enforcement script is still pi-import-focused (`scripts/check-pi-mono-imports.mjs`) rather than full workspace boundary checks from spec.
- Telegram reaction persistence still writes to `REACTIONS.md`; `docs/specs/TELEGRAM_SURFACE.md` defines migration to SQLite feedback events for a follow-up prompt.

### Next
- **Next prompt:** `Prompt 03: Refactor Web UI surface to use @polar/platform`
- **Suggested starting point:** `packages/polar-web-ui/vite.config.js` and `packages/polar-web-ui/package.json`.
- **Notes for next run:** Telegram runner is composition-root compliant with dependency cleanup complete; continue thin-surface convergence on remaining surfaces.

## 2026-03-01 (UTC) - Prompt 03: Refactor Web UI wiring and tighten MD allowlist

**Branch:** `main`  
**Commit:** `a1a3fcb`  
**Prompt reference:** `Prompt 03` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/BOOTSTRAP.md`  
- `docs/specs/WEB_UI_SURFACE.md`  
- `docs/specs/CONTROL_PLANE_API.md`  
- `docs/specs/BOUNDARIES.md`

### Summary
- Kept Web UI bootstrapping via `@polar/platform` and removed `defaultDbPath` coupling in favor of explicit repo-root `polar-system.db` resolution.
- Replaced markdown filename allowlist with path-based policy for `AGENTS.md`, `docs/**/*.md`, and `artifacts/**/*.md` (read-only).
- Hardened markdown path validation to reject absolute paths, traversal, non-markdown files, and escaped resolved paths.
- Aligned Web UI `ALLOWED_ACTIONS` with control-plane API spec by removing non-listed methods and including listed skill/metadata and message-binding methods.
- Updated Web UI file selector options to use `docs/...` paths matching the new allowlist policy.

### Scope and decisions
- **In scope:** `vite.config.js` wiring/path-validation/API-allowlist updates, file selector path updates, validation, implementation log update.
- **Out of scope:** control-plane internals, broader UI redesign, boundary-checker script replacement.
- **Key decisions:** keep `artifacts/**/*.md` read-only by default; keep all API exposure behind an explicit allowlist matching `CONTROL_PLANE_API`.

### Files changed
- `packages/polar-web-ui/vite.config.js` - tightened markdown path policy, aligned control-plane action allowlist, and used explicit `createPolarPlatform({ dbPath })` composition-root wiring.
- `packages/polar-web-ui/src/views/config.js` - updated file editor selector values to allowlisted `docs/...` paths plus root `AGENTS.md`.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 03 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none
- **Risk:** low (surface API gating/path validation changes only; no schema changes)

### Security and safety checks
- **Allowlist changes:** `readMD`/`writeMD` now allow only `AGENTS.md`, `docs/**/*.md`, and `artifacts/**/*.md` with writes blocked for `artifacts/`; traversal and absolute paths are rejected.
- **Capabilities/middleware affected:** Web UI dispatch remains constrained by explicit `ALLOWED_ACTIONS`, now aligned with `docs/specs/CONTROL_PLANE_API.md`.
- **Sensitive operations:** markdown write surface narrowed; arbitrary filesystem writes blocked by resolved-path validation and directory allowlist checks.

### Tests and validation
Commands run and outcomes:
- `npm test` - ✅ (361 passed, 0 failed)
- `npm run check:boundaries` - ✅

### Known issues / follow-ups
- Existing boundary checker (`scripts/check-pi-mono-imports.mjs`) still does not enforce full workspace boundary rules described in `docs/specs/BOUNDARIES.md`.

### Next
- **Next prompt:** `Prompt 04: Align CLI/bootstrap usage and boundary enforcement with @polar/platform`
- **Suggested starting point:** `packages/polar-cli/` entrypoint wiring and `scripts/check-pi-mono-imports.mjs` replacement/expansion.
- **Notes for next run:** Web UI path validation and API allowlisting are tightened; confirm CLI is on the same composition-root and allowlist discipline.

## 2026-03-01 (UTC) - Prompt 04: Remove cross-package /src imports across workspace

**Branch:** `main`  
**Commit:** `a1a3fcb`  
**Prompt reference:** `Prompt 04` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/BOUNDARIES.md`

### Summary
- Replaced cross-package `/src` import specifiers across workspace packages with workspace package imports (`@polar/*`).
- Updated control-plane and adapter/runtime imports to consume package exports only.
- Added missing package dependencies for newly explicit workspace imports.
- Exported `computeCapabilityScope` from `@polar/runtime-core` to support clean imports from `@polar/control-plane`.

### Scope and decisions
- **In scope:** import refactor across `packages/`, minimal export/dependency updates required to keep imports clean and resolvable, validation, implementation log update.
- **Out of scope:** feature behavior changes, API semantics, boundary checker script redesign.
- **Key decisions:** preserve runtime behavior and only replace import paths; add package exports/dependencies where needed rather than reintroducing cross-package path traversal.

### Files changed
- `packages/polar-control-plane/` - switched adapter/runtime imports from sibling `/src` paths to `@polar/*` workspace imports; added explicit workspace deps in package manifest.
- `packages/polar-runtime-core/` - switched domain imports and JSDoc import paths to `@polar/domain`; exported `computeCapabilityScope`; added `@polar/domain` dependency.
- `packages/polar-adapter-native/` - switched to `@polar/domain` import and added dependency.
- `packages/polar-adapter-channels/` - switched to `@polar/domain` import and added dependency.
- `packages/polar-adapter-extensions/` - switched to `@polar/domain` imports and added dependency.
- `packages/polar-adapter-pi/` - switched to `@polar/domain` import and added dependency.
- `package-lock.json` - updated lockfile for workspace dependency graph changes.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 04 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none
- **Risk:** medium-low (large import-path churn across many files, but mechanical and validated with full test suite)

### Security and safety checks
- **Allowlist changes:** none
- **Capabilities/middleware affected:** none
- **Sensitive operations:** none

### Tests and validation
Commands run and outcomes:
- `npm install` - ✅
- `npm test` - ✅ (361 passed, 0 failed)
- `npm run check:boundaries` - ✅
- `rg -n "polar-.*?/src/" packages` - ✅ (only non-import comment remains in `packages/polar-runtime-core/src/workflow-templates.mjs`)

### Known issues / follow-ups
- Boundary checker script still focuses on pi-mono imports; it does not yet enforce full workspace boundary policy described in `docs/specs/BOUNDARIES.md`.

### Next
- **Next prompt:** `Prompt 05: Replace boundary checker with full workspace boundary enforcement`
- **Suggested starting point:** `scripts/check-pi-mono-imports.mjs`, `package.json` `check:boundaries` script, and related boundary tests.
- **Notes for next run:** Cross-package `/src` import usage in package code has been removed; next step is enforcing this rule comprehensively in CI checks.
