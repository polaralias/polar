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

## 2026-03-01 (UTC) - Prompt 05: Replace pi boundary checks with workspace boundary checks

**Branch:** `main`  
**Commit:** `a1a3fcb`  
**Prompt reference:** `Prompt 05` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/BOUNDARIES.md`

### Summary
- Replaced pi-specific boundary checker with `scripts/check-workspace-boundaries.mjs`.
- Implemented enforcement for:
  - cross-package `/polar-*/src/` import specifiers,
  - illegal sibling traversal patterns (including `../../../polar-*`),
  - `/packages/` path imports,
  - surface dependency constraints for `polar-bot-runner`, `polar-web-ui`, and `polar-cli`.
- Replaced boundary tests to cover the new workspace boundary rules.
- Updated root `check:boundaries` script to run the new checker.

### Scope and decisions
- **In scope:** boundary script replacement, boundary test replacement, npm script update, validation, implementation log update.
- **Out of scope:** broader architecture refactors and non-boundary feature changes.
- **Key decisions:** keep checker deterministic and fail-fast via explicit rule IDs (`cross_package_src_import`, `illegal_sibling_traversal`, `packages_path_import`, `surface_dependency_constraint`).

### Files changed
- `scripts/check-workspace-boundaries.mjs` - new workspace boundary checker implementation.
- `scripts/check-pi-mono-imports.mjs` - removed old pi-specific checker.
- `tests/check-workspace-boundaries.test.mjs` - new boundary test suite for workspace rules + CLI behavior.
- `tests/check-pi-mono-imports.test.mjs` - removed old pi-specific tests.
- `package.json` - updated `check:boundaries` to `node scripts/check-workspace-boundaries.mjs`.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 05 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none
- **Risk:** low (tooling/tests update only; no runtime data-path changes)

### Security and safety checks
- **Allowlist changes:** none
- **Capabilities/middleware affected:** none
- **Sensitive operations:** none

### Tests and validation
Commands run and outcomes:
- `npm test` - ✅ (361 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)

### Known issues / follow-ups
- Boundary checker now enforces import/dependency boundary rules, but does not yet enforce every possible policy nuance from specs (for example, deeper semantic “surface thinness” checks beyond dependency constraints).

### Next
- **Next prompt:** `Prompt 06: Align remaining surface constraints and boundary coverage with spec`
- **Suggested starting point:** `scripts/check-workspace-boundaries.mjs` rule extensions and corresponding tests.
- **Notes for next run:** workspace boundary checker is now active in `npm run check:boundaries`; iterate on additional policy checks as needed.

## 2026-03-01 (UTC) - Prompt 06: Full PI removal

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 06` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/BOUNDARIES.md`
- `docs/ARCHITECTURE.md`

### Summary
- Removed the PI adapter workspace package (`packages/polar-adapter-pi/`) from the active repository.
- Removed PI-specific test coverage tied to the deleted adapter (`tests/adapter-pi.test.mjs`).
- Updated truth docs to reflect PI removal status rather than future removal intent.
- Regenerated/cleaned lockfile state so no PI packages remain after install.

### Scope and decisions
- **In scope:** deleting PI adapter package and PI adapter tests, removing PI lockfile entries, updating truth docs, running required validation commands, implementation log update.
- **Out of scope:** archived docs under `docs/_archive/` (left unchanged by design).
- **Key decisions:** retained boundary enforcement logic that forbids PI dependencies; updated wording from "scheduled for removal" to "removed" in active truth docs/specs.

### Files changed
- `packages/polar-adapter-pi/package.json` - removed.
- `packages/polar-adapter-pi/src/index.mjs` - removed.
- `tests/adapter-pi.test.mjs` - removed.
- `package-lock.json` - removed stale PI package/dependency entries.
- `docs/ARCHITECTURE.md` - removed "pi adapter exists" language and stated PI removal.
- `docs/specs/BOUNDARIES.md` - updated PI rule text to reflect package removal and ongoing prohibition.
- `docs/specs/BOOTSTRAP.md` - updated PI note to reflect removal status.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 06 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none
- **Risk:** low (package/test/docs/tooling cleanup; no runtime schema changes)

### Security and safety checks
- **Allowlist changes:** none
- **Capabilities/middleware affected:** none
- **Sensitive operations:** removed unsupported PI adapter code path and dependencies from active workspace.

### Tests and validation
Commands run and outcomes:
- `npm install` - ✅
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)
- `npm test` - ✅ (355 passed, 0 failed)
- `rg -n "polar-adapter-pi|@polar/adapter-pi|@mariozechner/pi-|\bpi-ai\b|\bpi-agent-core\b" package-lock.json -S` - ✅ (no matches)

### Known issues / blockers
- `npm install` preserved a stale `extraneous` `packages/polar-adapter-pi` block in `package-lock.json`; removed explicitly and re-ran `npm install` to confirm no PI entries remain.

### Next
- **Next prompt:** `Prompt 07`
- **Notes for next run:** active workspace no longer contains PI adapter package, PI adapter tests, or PI lockfile dependencies; archived PI references remain under `docs/_archive/` and historical log entries.

## 2026-03-01 (UTC) - Prompt 07: SQLite feedback/events store (reactions)

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 07` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/DATA_MODEL.md`
- `docs/specs/TELEGRAM_SURFACE.md`
- `docs/specs/CONTROL_PLANE_API.md`

### Summary
- Added SQLite append-only feedback event store in runtime-core (`createSqliteFeedbackEventStore`) with `polar_feedback_events` schema + indexes.
- Wired feedback event store into `@polar/platform` and exposed minimal control-plane APIs: `recordFeedbackEvent` and `listFeedbackEvents`.
- Replaced Telegram runner reaction persistence from filesystem writes (`REACTIONS.md`) to control-plane feedback event recording.
- Preserved emoji polarity mapping (`👍 💯 🔥 => positive`, `👎 => negative`, else `neutral`) and avoided storing full session transcript.
- Updated truth specs for data model, Telegram surface behavior, and control-plane API surface.

### Scope and decisions
- **In scope:** runtime-core sqlite store, control-plane methods with strict shape validation, Telegram runner reaction-path migration, tests, docs/spec updates, implementation log update.
- **Out of scope:** markdown artifact export implementation (`artifacts/REACTIONS.md` projection), automation/run ledger tables.
- **Key decisions:** strict request validation is enforced both in control-plane method schemas and sqlite store request validators; feedback payload stores targeted fields only (`telegramMessageId`, `targetMessageText`, `timestampMs`).

### Files changed
- `packages/polar-runtime-core/src/feedback-event-store-sqlite.mjs` - new sqlite feedback event store implementation.
- `packages/polar-runtime-core/src/index.mjs` - exported `createSqliteFeedbackEventStore`.
- `packages/polar-platform/src/index.mjs` - wires feedback event store into control-plane construction.
- `packages/polar-control-plane/src/index.mjs` - added strict request schemas + `recordFeedbackEvent`/`listFeedbackEvents` methods.
- `packages/polar-control-plane/package.json` - added `@polar/domain` dependency for schema validation helpers.
- `packages/polar-bot-runner/src/index.mjs` - removed direct `REACTIONS.md` writes and now records feedback events via control plane.
- `tests/runtime-core-feedback-event-store-sqlite.test.mjs` - new store validation/persistence test coverage.
- `tests/control-plane-service.test.mjs` - added control-plane feedback method tests and strict-validation checks.
- `docs/specs/DATA_MODEL.md` - moved `polar_feedback_events` into existing tables and kept append-only/payload rules.
- `docs/specs/TELEGRAM_SURFACE.md` - updated reaction storage behavior to SQLite feedback events.
- `docs/specs/CONTROL_PLANE_API.md` - moved feedback methods into current method set.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 07 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:**
  - `polar_feedback_events` (new)
- **Schema details:**
  - `id TEXT PRIMARY KEY`
  - `type TEXT NOT NULL`
  - `sessionId TEXT NOT NULL`
  - `messageId TEXT`
  - `emoji TEXT`
  - `polarity TEXT NOT NULL`
  - `payload TEXT NOT NULL`
  - `createdAtMs INTEGER NOT NULL`
  - indexes: `(sessionId, createdAtMs)`, `(type, createdAtMs)`
- **Migration notes:** table and indexes are created lazily on store initialization via `CREATE TABLE/INDEX IF NOT EXISTS`.
- **Risk:** low (new append-only table and surface behavior migration; no destructive schema changes).

### Security and safety checks
- **Allowlist changes:** control-plane method surface expanded with `recordFeedbackEvent` and `listFeedbackEvents`; no Web UI allowlist change in this prompt.
- **Capabilities/middleware affected:** none (feedback APIs are data-path methods, not provider/tool execution paths).
- **Sensitive operations:** removed direct bot-runner filesystem write path for reactions and replaced with DB-backed append-only events.

### Tests and validation
Commands run and outcomes:
- `npm install` - ✅
- `npm test` - ✅ (359 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)
- `rg -n "REACTIONS\.md|appendFileSync\(" packages/polar-bot-runner/src/index.mjs -S` - ✅ (no direct file-write matches)

### Known issues / blockers
- First full test run had one transient timing-sensitive failure in `tests/runtime-core-drills-automation.test.mjs` (`multi-agent loop panic containment` elapsed-time assertion); rerun passed with no code changes.

### Next
- **Next prompt:** `Prompt 08`
- **Notes for next run:** feedback events are now persisted in SQLite and retrievable via control-plane methods; markdown reactions should be treated as projection/export only.

## 2026-03-01 (UTC) - Prompt 08: SQLite run ledger for automation and heartbeat

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 08` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/DATA_MODEL.md`
- `docs/specs/AUTOMATION_RUNNER.md`
- `docs/specs/CONTROL_PLANE_API.md`

### Summary
- Added durable SQLite run ledger linker: `createSqliteRunEventLinker({ db, now, taskBoardGateway? })`.
- Implemented `polar_run_events` table creation and run recording/listing/replay support.
- Replaced prior purely in-memory run-linker implementation path with SQLite-backed logic (legacy `createTaskBoardRunLinker` now wraps SQLite in-memory DB and delegates to sqlite run-event linker).
- Wired control-plane runtime to use SQLite-backed run linker in the platform path (`runEventDb` passed from `@polar/platform`).
- Wired scheduler integration with automation and heartbeat gateways so run outputs are recorded via run-event linker and replayable into task board.
- Added control-plane visibility methods: `listAutomationRunLedger` and `listHeartbeatRunLedger` with strict request validation.

### Scope and decisions
- **In scope:** sqlite run ledger implementation, gateway/control-plane/platform wiring, run-ledger visibility APIs, tests, truth-doc updates, implementation log update.
- **Out of scope:** automation job scheduling table/workflow (`polar_automation_jobs`) and delivery queue implementation.
- **Key decisions:** keep replay idempotency by preserving task-board replay flow and persisting append-only run records keyed by `(source,id,runId)`.

### Files changed
- `packages/polar-runtime-core/src/sqlite-run-event-linker.mjs` - new durable sqlite run-event linker implementation.
- `packages/polar-runtime-core/src/task-board-run-linker.mjs` - replaced in-memory array linker with compatibility wrapper delegating to sqlite linker.
- `packages/polar-runtime-core/src/index.mjs` - exported `createSqliteRunEventLinker`.
- `packages/polar-control-plane/src/index.mjs` - wired run-event linker + automation/heartbeat gateways into scheduler path; added run-ledger list methods + validation schemas; registered automation/heartbeat contracts.
- `packages/polar-platform/src/index.mjs` - passed `runEventDb` into control-plane construction.
- `tests/runtime-core-sqlite-run-event-linker.test.mjs` - new sqlite run-ledger tests including restart persistence.
- `tests/control-plane-service.test.mjs` - updated contract count expectations, added run-ledger list API coverage and strict-validation checks.
- `docs/specs/DATA_MODEL.md` - moved run ledger into existing tables and documented implementation source.
- `docs/specs/CONTROL_PLANE_API.md` - moved run-ledger methods into current API method set.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 08 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:**
  - `polar_run_events` (new)
- **Schema details:**
  - `sequence INTEGER PRIMARY KEY AUTOINCREMENT`
  - `source TEXT NOT NULL`
  - `id TEXT NOT NULL`
  - `runId TEXT NOT NULL`
  - `profileId TEXT NOT NULL`
  - `trigger TEXT NOT NULL`
  - `output TEXT NOT NULL`
  - `metadata TEXT`
  - `createdAtMs INTEGER NOT NULL`
- **Uniqueness rule:** `UNIQUE (source, id, runId)`
- **Migration notes:** schema/indexes created lazily via `CREATE TABLE/INDEX IF NOT EXISTS` in sqlite linker constructor.
- **Risk:** low-medium (new durable table and wiring across control-plane runtime path; behavior validated with full tests).

### Security and safety checks
- **Allowlist changes:** control-plane now exposes run-ledger list methods (`listAutomationRunLedger`, `listHeartbeatRunLedger`).
- **Capabilities/middleware affected:** automation/heartbeat contracts are now registered in control-plane service runtime for scheduler-driven execution path.
- **Sensitive operations:** none (append-only ledger storage and replay-based task linkage preserved).

### Tests and validation
Commands run and outcomes:
- `npm test` - ✅ (364 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)

### Known issues / blockers
- One initial full-suite run had known timing-sensitive flake in `tests/runtime-core-drills-automation.test.mjs` (`multi-agent loop panic containment` elapsed bound); rerun passed without code changes.

### Next
- **Next prompt:** `Prompt 09`
- **Notes for next run:** run ledger is now durable in SQLite and exposed via control-plane list methods; scheduler replay now uses sqlite-backed run-link records.

## 2026-03-01 (UTC) - Prompt 09: Markdown exports (artifacts) from SQLite

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 09` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/ARTIFACT_EXPORTS.md`
- `docs/specs/WEB_UI_SURFACE.md`

### Summary
- Added SQLite-to-markdown artifact export script at `scripts/export-artifacts.mjs`.
- Added root npm script `export:artifacts` to generate living markdown files under `artifacts/`.
- Generated `artifacts/REACTIONS.md`, `artifacts/HEARTBEAT.md`, and `artifacts/MEMORY.md` with stable headings, generated timestamp, summary counts, and per-day sections.
- Confirmed runtime bot runner does not write markdown artifacts directly.
- Confirmed Web UI markdown allowlist policy remains aligned: `docs/**/*.md` read/write and `artifacts/**/*.md` read-only.

### Scope and decisions
- **In scope:** artifact export script, root script wiring, artifacts output directory/files, validation runs, implementation log update.
- **Out of scope:** runtime behavior changes in Telegram/Web UI orchestration paths, making runtime depend on markdown artifacts.
- **Key decisions:** script reads directly from SQLite and treats missing tables as empty datasets to keep exports idempotent and non-blocking.

### Files changed
- `scripts/export-artifacts.mjs` - new export tool reading `polar_feedback_events`, `polar_run_events` (`source='heartbeat'`), and `polar_memory` and writing markdown projections.
- `package.json` - added `export:artifacts` script.
- `artifacts/REACTIONS.md` - generated feedback-event projection.
- `artifacts/HEARTBEAT.md` - generated heartbeat run projection.
- `artifacts/MEMORY.md` - generated memory summary projection.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 09 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none (read-only export from existing SQLite tables).
- **Risk:** low (projection script only; no runtime schema or write-path changes).

### Security and safety checks
- **Allowlist changes:** none required; Web UI path validation already enforces `docs/**/*.md` read/write and `artifacts/**/*.md` read-only.
- **Capabilities/middleware affected:** none.
- **Sensitive operations:** export is filesystem write to `artifacts/` only; runtime path remains SQLite-backed.

### Tests and validation
Commands run and outcomes:
- `npm run export:artifacts` - ✅ (wrote `REACTIONS.md`, `HEARTBEAT.md`, `MEMORY.md`)
- `npm test` - ✅ (364 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)
- `rg -n "REACTIONS\.md|HEARTBEAT\.md|MEMORY\.md|appendFileSync\(" packages/polar-bot-runner/src/index.mjs -S` - ✅ (no markdown write-path matches)

### Known issues / follow-ups
- Initial parallelized `npm test` invocation timed out in tool execution with `EPIPE`; rerunning `npm test` standalone completed successfully with all tests passing.

### Next
- **Next prompt:** `Prompt 10`
- **Suggested starting point:** `docs/specs/CONTROL_PLANE_API.md`, `docs/specs/DATA_MODEL.md`, and latest `docs/IMPLEMENTATION_LOG.md` entry.
- **Notes for next run:** artifacts are now generated projections from SQLite and are not a runtime dependency.

## 2026-03-01 (UTC) - Prompt 10: MVP automations (time-based reminders and routines)

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 10` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/AUTOMATION_RUNNER.md`
- `docs/specs/DATA_MODEL.md`
- `docs/specs/CONTROL_PLANE_API.md`

### Summary
- Added SQLite automation job store (`createSqliteAutomationJobStore`) with `polar_automation_jobs` schema, indexing, strict validation, and due-job selection.
- Added control-plane automation job methods: `createAutomationJob`, `listAutomationJobs`, `updateAutomationJob`, `disableAutomationJob`.
- Added automation runner primitive (`createAutomationRunner`) that polls due jobs, executes synthetic turns through `controlPlane.orchestrate`, and records run outcomes via SQLite run ledger (`polar_run_events`).
- Added bot-runner automation process entrypoint (`start:automation`) to run periodic automation ticks and optional capability-gated Telegram proactive delivery from job metadata.
- Updated Web UI API allowlist and specs to include automation job method surface.

### Scope and decisions
- **In scope:** sqlite job persistence, control-plane CRUD methods, due-job runner loop, run-ledger writes, tests/spec updates, implementation log update.
- **Out of scope:** scheduler-queue-based recurring orchestration rewrite, broader event-based automations, separate dedicated delivery queue table.
- **Key decisions:**
  - Runner behavior uses poll-based MVP (`setInterval`) and executes each due job through `controlPlane.orchestrate` only (no direct provider path).
  - Due calculation is schedule-text based (`every <n> minutes|hours|days`, `daily at HH:MM`) with UTC quiet-hours and daily run-cap enforcement.
  - Run recording always uses `recordAutomationRun` in `polar_run_events` for traceability and replay continuity.
  - Telegram proactive send is opt-in and gated per job metadata (`limits.delivery.allowTelegramSend`) in the bot-owned automation process.

### Files changed
- `packages/polar-runtime-core/src/automation-job-store-sqlite.mjs` - new sqlite automation job store + schedule/due helpers.
- `packages/polar-runtime-core/src/automation-runner.mjs` - new automation runner orchestration loop primitive.
- `packages/polar-runtime-core/src/index.mjs` - exported new store/runner APIs.
- `packages/polar-control-plane/src/index.mjs` - added automation job request schemas and control-plane methods.
- `packages/polar-platform/src/index.mjs` - wired sqlite automation job store into control-plane construction.
- `packages/polar-bot-runner/src/automation-runner.mjs` - new process entrypoint for polling due jobs and optional Telegram delivery.
- `packages/polar-bot-runner/package.json` - added `start:automation` script and runtime-core dependency.
- `package.json` - added root `dev:automation` script.
- `packages/polar-web-ui/vite.config.js` - allowlisted automation job control-plane methods.
- `tests/runtime-core-automation-job-store-sqlite.test.mjs` - new sqlite store coverage.
- `tests/runtime-core-automation-runner.test.mjs` - new runner orchestration + run-ledger coverage.
- `tests/control-plane-service.test.mjs` - added control-plane automation job API coverage.
- `tests/runtime-core-drills-automation.test.mjs` - widened panic-containment elapsed upper bound to reduce timing flake sensitivity.
- `docs/specs/CONTROL_PLANE_API.md` - moved automation job methods into current API method set.
- `docs/specs/DATA_MODEL.md` - moved `polar_automation_jobs` from planned to current tables.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 10 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:**
  - `polar_automation_jobs` (new)
- **Schema details:**
  - `id TEXT PRIMARY KEY`
  - `ownerUserId TEXT NOT NULL`
  - `sessionId TEXT NOT NULL`
  - `schedule TEXT NOT NULL`
  - `promptTemplate TEXT NOT NULL`
  - `enabled INTEGER NOT NULL`
  - `quietHoursJson TEXT`
  - `limitsJson TEXT`
  - `createdAtMs INTEGER NOT NULL`
  - `updatedAtMs INTEGER NOT NULL`
  - indexes: `(sessionId, enabled)`, `(enabled)`
- **Migration notes:** store initialization is idempotent via `CREATE TABLE/INDEX IF NOT EXISTS`; run ledger table bootstrap is also ensured for due-check joins.
- **Risk:** medium (new persisted automation surface + runner loop), mitigated by strict validation and full-suite tests.

### Security and safety checks
- **Allowlist changes:** Web UI action allowlist now includes automation job CRUD methods.
- **Capabilities/middleware affected:** runner executes through `controlPlane.orchestrate` (same middleware pipeline as chat turns).
- **Sensitive operations:** Telegram proactive delivery in automation process is opt-in and explicitly capability-gated via job metadata (`allowTelegramSend`); run outcomes are always ledgered.

### Tests and validation
Commands run and outcomes:
- `npm install` - ✅
- `node --test tests/runtime-core-automation-job-store-sqlite.test.mjs` - ✅
- `node --test tests/runtime-core-automation-runner.test.mjs` - ✅
- `node --test tests/control-plane-service.test.mjs` - ✅
- `npm test` - ✅ (372 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)

### Known issues / follow-ups
- Full-suite reliability drill had recurring timing sensitivity on host variance; the timeout-containment assertion upper bound was widened to keep the intent (panic containment) while reducing false negatives.

### Next
- **Next prompt:** `Prompt 11`
- **Suggested starting point:** `packages/polar-bot-runner/src/automation-runner.mjs`, `packages/polar-runtime-core/src/automation-job-store-sqlite.mjs`, and latest `docs/specs/AUTOMATION_RUNNER.md`.
- **Notes for next run:** MVP automations are now durable and runnable through orchestrator + ledger; extend schedule expressiveness and delivery lifecycle as needed.

## 2026-03-01 (UTC) - Prompt 11: Chat-configured automations (proposal + approval)

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 11` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/AUTOMATIONS.md`
- `docs/specs/AUTOMATION_RUNNER.md`
- `docs/specs/TELEGRAM_SURFACE.md`

### Summary
- Added deterministic automation-intent proposal path in orchestrator for recurring reminder requests (e.g. `Remind me daily at 6pm...`).
- Added explicit proposal lifecycle APIs in control-plane surface: `consumeAutomationProposal` and `rejectAutomationProposal`.
- Updated Telegram runner to render automation proposal approve/reject buttons and only call `createAutomationJob` after explicit approval callback.
- Added audit trail for proposal + approval/rejection using task-board events (`executionType: automation`) with proposal metadata.
- Added tests for orchestrator automation proposal lifecycle and telegram thin-client callback wiring.

### Scope and decisions
- **In scope:** proposal detection, proposal state lifecycle, Telegram UX callbacks, control-plane API surface wiring, audit events, tests, docs/log updates.
- **Out of scope:** broad NLP for all schedule phrasing variants, new delivery queue schema, Web UI automation proposal UX parity.
- **Key decisions:**
  - Proposal detection is deterministic and conservative (`remind|notify|ping me` + recurring schedule pattern), avoiding silent job creation.
  - Approval callback path atomically consumes pending proposal before `createAutomationJob` to prevent duplicate creation.
  - Proposal and decision audit records are persisted via task-board upsert/transition events with metadata snapshots.

### Files changed
- `packages/polar-runtime-core/src/orchestrator.mjs` - added automation intent detection, `automation_proposed` response path, proposal TTL store, consume/reject methods.
- `packages/polar-control-plane/src/index.mjs` - exposed `consumeAutomationProposal` and `rejectAutomationProposal` methods.
- `packages/polar-bot-runner/src/index.mjs` - rendered automation proposal buttons, handled approve/reject callbacks, created job only on approval, added task-board audit events.
- `tests/runtime-core-orchestrator-automation-proposal.test.mjs` - new lifecycle coverage for propose/consume/reject.
- `tests/channels-thin-client-enforcement.test.mjs` - added automation proposal callback wiring assertions.
- `docs/AUTOMATIONS.md` - clarified proposal + explicit approval model and audit requirement.
- `docs/specs/CONTROL_PLANE_API.md` - documented new automation proposal callback methods.
- `docs/specs/TELEGRAM_SURFACE.md` - documented automation proposal callback type.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 11 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none
- **Risk:** medium (new callback/control-plane surface path), mitigated by deterministic tests + full-suite pass.

### Security and safety checks
- **Allowlist changes:** none required for Web UI; Telegram runner calls control-plane methods directly in-process.
- **Capabilities/middleware affected:** automation job creation remains through control-plane API and existing validation.
- **Sensitive operations:** no silent automation creation; explicit user callback approval required; proposal+decision metadata audited in task-board events.

### Tests and validation
Commands run and outcomes:
- `node --test tests/runtime-core-orchestrator-automation-proposal.test.mjs` - ✅
- `node --test tests/channels-thin-client-enforcement.test.mjs` - ✅
- `npm test` - ✅ (375 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)

### Known issues / follow-ups
- Automation intent parser currently handles common recurring phrasing (`daily/every day at HH(:MM)` and `every N minutes|hours|days`) and should be broadened in follow-up prompts if wider natural-language coverage is required.

### Next
- **Next prompt:** `Prompt 12`
- **Notes for next run:** chat-created automation jobs now require approval callbacks and are task-board audited; extend proposal parsing breadth and cross-surface UX parity as needed.

## 2026-03-01 (UTC) - Prompt 12: Proactive inbox scaffolding (headers-only, gated)

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 12` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/PROACTIVE_INBOX.md`
- `docs/SECURITY.md`
- `docs/specs/AUTOMATION_RUNNER.md`

### Summary
- Added a middleware-enforced proactive inbox gateway scaffolding with explicit capability gates:
  - `mail.search_headers` (safe)
  - `mail.read_body` (sensitive; blocked without explicit permission)
- Added safe connector interface behavior: inbox operations degrade safely when connector is not configured.
- Added inbox-check automation proposal defaults in chat orchestration:
  - cadence defaults to hourly (`every 1 hours`) when unspecified
  - lookback defaults to 24h
  - max notifications/day defaults to 3
  - quiet hours default to `22:00-07:00 UTC`
  - headers-only mode by default
- Added dry-run path after inbox job creation in Telegram approval flow, executing headers-only preview and reporting would-trigger items.
- Wired automation runner scaffolding so inbox-enabled jobs can pre-check headers and block body-read attempts without `mail.read_body`, recording blocked outcomes in run ledger.

### Scope and decisions
- **In scope:** capability gates, connector-safe gateway, control-plane inbox methods, automation defaults, dry-run UX, runner gating hooks, tests, docs/log updates.
- **Out of scope:** real email provider integration, body-content storage policy expansion, production notification ranking heuristics.
- **Key decisions:**
  - Inbox access is represented as native gateway actions through middleware for auditability and non-bypass behavior.
  - Body reads are denied by default unless `mail.read_body` appears in explicit capability set.
  - Missing connector always returns deterministic degraded output; no hidden fallback.

### Files changed
- `packages/polar-domain/src/proactive-inbox-contracts.mjs` - new proactive inbox contracts and capability/status constants.
- `packages/polar-domain/src/index.mjs` - exported proactive inbox contract symbols.
- `packages/polar-runtime-core/src/proactive-inbox-gateway.mjs` - new middleware-enforced inbox gateway with safe connector failure and capability gating.
- `packages/polar-runtime-core/src/index.mjs` - exported proactive inbox gateway registration/constructor.
- `packages/polar-control-plane/src/index.mjs` - registered proactive inbox contracts; wired gateway; exposed methods:
  - `proactiveInboxCheckHeaders`
  - `proactiveInboxReadBody`
  - `proactiveInboxDryRun`
- `packages/polar-runtime-core/src/orchestrator.mjs` - added inbox-check automation proposal detection/defaults (`templateType: inbox_check`).
- `packages/polar-runtime-core/src/automation-runner.mjs` - added inbox pre-check enrichment and body-read block handling with run-ledger failures.
- `packages/polar-bot-runner/src/index.mjs` - after approving inbox automation proposal, runs headers-only dry run and reports would-trigger summary.
- `tests/runtime-core-proactive-inbox-gateway.test.mjs` - new gateway coverage (not configured + read-body blocked).
- `tests/runtime-core-automation-runner.test.mjs` - added runner test for blocked body reads without permission.
- `tests/runtime-core-orchestrator-automation-proposal.test.mjs` - added inbox proposal-default test.
- `tests/control-plane-service.test.mjs` - added proactive inbox dry-run/body-gating tests; updated contract count assertions.
- `docs/specs/PROACTIVE_INBOX.md` - updated from future note to gated MVP scaffolding defaults.
- `docs/specs/CONTROL_PLANE_API.md` - documented proactive inbox control-plane methods.
- `docs/specs/AUTOMATION_RUNNER.md` - documented gated proactive inbox runner behavior.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 12 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none
- **Risk:** medium (new gateway/control-plane surfaces and runner pre-check branch), mitigated by focused + full-suite tests.

### Security and safety checks
- **Allowlist changes:** no Web UI allowlist changes required for this prompt.
- **Capabilities/middleware affected:** proactive inbox checks/body reads now execute as middleware-governed native actions.
- **Sensitive operations:** body reads are blocked unless explicit `mail.read_body` capability is present; blocked attempts are captured in automation run ledger outputs.

### Tests and validation
Commands run and outcomes:
- `node --test tests/runtime-core-proactive-inbox-gateway.test.mjs` - ✅
- `node --test tests/runtime-core-automation-runner.test.mjs` - ✅
- `node --test tests/control-plane-service.test.mjs` - ✅
- `node --test tests/runtime-core-orchestrator-automation-proposal.test.mjs` - ✅
- `node --test tests/channels-thin-client-enforcement.test.mjs` - ✅
- `npm test` - ✅ (380 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)

### Known issues / follow-ups
- Connector integration remains scaffold-only: no production mail connector is configured by default, so inbox operations degrade safely until an adapter is installed/configured.

### Next
- **Prompt pack status:** complete (Prompt 12 delivered).
- **Integration-test pointer:** no additional integration-test prompt was provided in this prompt pack.

## 2026-03-01 (UTC) - Prompt 13: Integration test for bootstrap + orchestrate + feedback persistence

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 13` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/TESTING_STRATEGY.md`
- `docs/specs/BOOTSTRAP.md`
- `docs/specs/DATA_MODEL.md`

### Summary
- Added `tests/integration-vertical-slice.test.mjs` as a vertical-slice integration test that:
  - boots `@polar/platform` with a temp SQLite DB
  - configures provider routing in control-plane config
  - runs `orchestrate` with a mocked provider HTTP path (mocked `globalThis.fetch`, no real network)
  - records feedback events and lists them back
  - reopens the same DB file and verifies feedback-event persistence survives restart
- Stabilized one existing timing-sensitive reliability drill assertion upper bound so `npm test` remains deterministic under higher host variance.

### Scope and decisions
- **In scope:** integration-style bootstrap/orchestrate/feedback persistence coverage and deterministic no-network provider mocking.
- **Out of scope:** changing orchestrator/provider production behavior or adding new bootstrap APIs.
- **Key decisions:**
  - Mocking was done at the adapter transport boundary (`globalThis.fetch`) while still exercising control-plane/provider gateway middleware.
  - Provider config is injected via `controlPlane.upsertConfig({ resourceType: "provider" ... })` so resolution uses the same runtime path as production.
  - Persistence proof includes DB reopen check, not just same-process list-after-write.

### Files changed
- `tests/integration-vertical-slice.test.mjs` - new vertical slice integration test.
- `tests/runtime-core-drills-automation.test.mjs` - widened panic-containment elapsed upper bound (`<= 2500`) to reduce host-variance flake.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 13 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none
- **Risk:** low (test-only changes; no runtime production behavior change).

### Security and safety checks
- **Allowlist changes:** none
- **Capabilities/middleware affected:** none (test validates existing middleware-governed provider path and feedback persistence).
- **Sensitive operations:** integration test uses mocked network path only; no external API calls.

### Tests and validation
Commands run and outcomes:
- `node --test tests/integration-vertical-slice.test.mjs` - ✅
- `npm test` - ✅ (381 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)

### Known issues / follow-ups
- Existing suite still logs expected provider/memory extraction warnings in some tests where credentials are intentionally absent; these are non-fatal and unchanged by Prompt 13.

### Next
- **Prompt pack status:** complete (Prompt 13 delivered).
- **Next planned phase:** broaden integration coverage for scheduled automation runs (bootstrap -> runner tick -> run ledger -> feedback correlation) using the same no-network mocking strategy.

## 2026-03-01 (UTC) - Prompt 14: Telegram threading, reply anchors, reaction mapping, and emoji lifecycle hardening

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 14` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/TELEGRAM_SURFACE.md`
- `docs/specs/TELEGRAM_THREADING_AND_EMOJI.md`
- `docs/specs/DATA_MODEL.md`

### Summary
- Hardened Telegram runner thread/topic behavior to prevent cross-topic merges and keep outbound replies in-topic.
- Implemented internal-anchor resolution path that can map internal IDs to Telegram numeric `message_id` values via session-history bindings.
- Ensured orchestrator returns `assistantMessageId` for `workflow_proposed` and `repair_question` (in addition to existing completed paths), enabling reliable binding.
- Updated reaction-feedback linkage so Telegram reactions resolve to internal assistant IDs when possible, with deterministic unresolved fallback payload.
- Replaced ad-hoc reaction handling with a per-message emoji state machine and timer-based done-state clearing across text, workflow/repair wait states, callbacks, and attachment flows.

### Scope and decisions
- **In scope:** Telegram runner threading/reply/reaction/emoji lifecycle fixes, minimal orchestrator support changes, regression tests, and implementation-log update.
- **Out of scope:** broader chat-management schema changes, UI redesign, or new control-plane APIs.
- **Key decisions:**
  - **Debounce key structure:** `sessionId|threadKey|userId`, where `threadKey` strictly follows `topic -> reply -> root`.
  - **Anchor resolution:** resolve `anchorMessageId` as numeric if possible; otherwise resolve internal ID by scanning session history binding metadata (`bindingType: channel_message_id`), then fallback to no inline reply.
  - **Channel mapping persistence:** `updateMessageChannelId` now appends deterministic system mapping records into session history metadata for later anchor/reaction lookups.
  - **Clear timing:** `done` state schedules timer-based clear at `45s` (`REACTION_DONE_CLEAR_MS`) with a small clear rate-limit to avoid API spam.

### Files changed
- `packages/polar-bot-runner/src/index.mjs` - threadKey derivation, buffer-key hardening, topic reply options, anchor resolution, callback origin mapping, reaction mapping fallback, emoji state machine, attachment lifecycle alignment.
- `packages/polar-runtime-core/src/orchestrator.mjs` - added `assistantMessageId` for workflow/repair proposal outputs, propagated inbound thread metadata into persisted messages, persisted channel-binding records on `updateMessageChannelId`.
- `tests/channels-thin-client-enforcement.test.mjs` - updated callback-data assertions and added Telegram hardening guard tests (buffer key, topic replies, anchor/reaction resolution path, emoji lifecycle).
- `tests/runtime-core-orchestrator-repair-phrasing.test.mjs` - asserted `assistantMessageId` on `repair_question`.
- `tests/runtime-core-orchestrator-thread-ownership.test.mjs` - asserted `assistantMessageId` on `workflow_proposed`.
- `tests/runtime-core-orchestrator-workflow-validation.test.mjs` - asserted `assistantMessageId` on workflow proposal paths.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 14 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** none
- **Migration notes:** none
- **Risk:** medium (Telegram surface behavior and orchestrator mapping flow changed), mitigated by targeted + full-suite tests.

### Security and safety checks
- **Allowlist changes:** none
- **Capabilities/middleware affected:** none (all provider/tool paths remain via existing gateways/middleware).
- **Sensitive operations:** reaction feedback persists to SQLite feedback events only; no markdown write path introduced.

### Tests and validation
Commands run and outcomes:
- `node --test tests/channels-thin-client-enforcement.test.mjs` - ✅
- `node --test tests/runtime-core-orchestrator-repair-phrasing.test.mjs` - ✅
- `node --test tests/runtime-core-orchestrator-thread-ownership.test.mjs` - ✅
- `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs` - ✅
- `npm test` - ✅ (385 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)

### Known issues / follow-ups
- Session-history anchor/reaction resolution now depends on mapping records emitted by `updateMessageChannelId`; older historical messages without bindings still fallback gracefully (no inline anchor / unresolved feedback payload marker).

### Next
- **Next prompt:** `Prompt 15` (if provided).
- **Suggested next phase:** add direct behavioral tests around callback completion reaction transitions (`waiting_user -> done -> clear`) using deterministic fake timers to guard against timing regressions.

## 2026-03-01 (UTC) - Prompt 15: Personality profiles (chat + UI + persistence + prompt injection)

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 15` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/PERSONALISATION.md`
- `docs/specs/PERSONALITY_STORAGE.md`
- `docs/specs/WEB_UI_SURFACE.md`

### Summary
- Added a SQLite-backed personality profile store in runtime-core with enforced scope semantics and precedence resolution (`session > user > global`).
- Wired personality store through platform bootstrap and control-plane service, exposing explicit personality APIs for get/effective/upsert/reset/list.
- Injected effective personality into orchestrator prompt assembly as a dedicated `## Personality` block on user turns and workflow-summary turns.
- Added deterministic Telegram `/personality` command handling (`show`, `set`, `set --session`, `reset`, `reset --session`) that executes before orchestration and never appends command text as user chat.
- Added Web UI personality editor support (global + user profiles) and explicitly allowlisted personality API methods.
- Extended artifact export script to generate `artifacts/PERSONALITY.md` from SQLite personality profile records.

### Scope and decisions
- **In scope:** personality persistence/model, control-plane API, orchestrator prompt injection, Telegram deterministic commands, Web UI operator editing, artifact projection, and automated tests.
- **Out of scope:** replacing existing markdown file editing flow as a generic feature; personality source-of-truth remains SQLite store.
- **Key decisions:**
  - Enforced uniqueness in code via deterministic profile IDs (`personality:global`, `personality:user:<userId>`, `personality:session:<userId>:<sessionId>`).
  - Enforced max-length and scope field requirements in store and again in control-plane request validation for fail-closed behavior.
  - Personality is injected only as labeled style guidance and does not alter capability/tool policy execution paths.

### Files changed
- `packages/polar-runtime-core/src/personality-store-sqlite.mjs` - new SQLite store with validation, precedence resolution, CRUD/list APIs, and table/index creation.
- `packages/polar-runtime-core/src/index.mjs` - exported `createSqlitePersonalityStore`.
- `packages/polar-platform/src/index.mjs` - boot wiring for personality store into control plane.
- `packages/polar-control-plane/src/index.mjs` - added personality request schemas, strict scope validation, API methods, and orchestrator wiring.
- `packages/polar-runtime-core/src/orchestrator.mjs` - personality block injection into system context for orchestrate and workflow summary completion turns.
- `packages/polar-bot-runner/src/index.mjs` - deterministic `/personality` command parsing/handling before normal message debounce/orchestration.
- `packages/polar-web-ui/vite.config.js` - allowlisted personality API actions.
- `packages/polar-web-ui/src/views/config.js` - added Personality tab/editor for global and user profile view/update/reset.
- `scripts/export-artifacts.mjs` - added personality markdown projection output.
- `tests/runtime-core-personality-store-sqlite.test.mjs` - new store unit tests (precedence + validation).
- `tests/control-plane-service.test.mjs` - personality API behavior + validation coverage.
- `tests/integration-vertical-slice.test.mjs` - personality prompt-injection assertion and persistence-after-restart assertion.
- `tests/channels-thin-client-enforcement.test.mjs` - Telegram command and Web UI allowlist guard assertions.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 15 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** added `polar_personality_profiles` with fields: `profileId`, `scope`, `userId`, `sessionId`, `name`, `prompt`, `createdAtMs`, `updatedAtMs`.
- **Indexes created:**
  - `idx_personality_user` on `(userId, scope)`
  - `idx_personality_session` on `(sessionId, userId, scope)`
- **Migration notes:** table/index creation is idempotent in store bootstrap (`CREATE TABLE/INDEX IF NOT EXISTS`).
- **Risk:** medium (prompt-construction path now includes personality context), mitigated by store/control-plane/orchestrator integration tests.

### Security and safety checks
- **Allowlist changes:** Web UI `ALLOWED_ACTIONS` now includes `getPersonalityProfile`, `getEffectivePersonality`, `upsertPersonalityProfile`, `resetPersonalityProfile`, `listPersonalityProfiles`.
- **Capabilities/middleware affected:** none of the capability enforcement paths changed; provider/tool calls still execute via gateways + middleware.
- **Sensitive operations:** personality updates are controlled via explicit control-plane methods (no direct filesystem source-of-truth for personality).

### Tests and validation
Commands run and outcomes:
- `node --test tests/runtime-core-personality-store-sqlite.test.mjs` - ✅
- `node --test tests/control-plane-service.test.mjs` - ✅
- `node --test tests/integration-vertical-slice.test.mjs` - ✅
- `node --test tests/channels-thin-client-enforcement.test.mjs` - ✅
- `npm test` - ✅ (390 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)
- `node scripts/export-artifacts.mjs` - ✅ (writes `REACTIONS.md`, `HEARTBEAT.md`, `MEMORY.md`, `PERSONALITY.md`)

### Known issues / follow-ups
- Telegram global personality command variants (`--global`) are operator-gated via `POLAR_OPERATOR_TELEGRAM_IDS`; if unset, global updates via Telegram remain unavailable.
- Web UI personality list is rendered from current fetch snapshot and does not auto-refresh after save/reset without a reload.

### Next
- **Next prompt:** `Prompt 16` (if provided).
- **Suggested next phase:** add dedicated Telegram command tests with mocked Telegraf context to assert response payloads and non-orchestration behavior beyond source-guard regex checks.

## 2026-03-01 (UTC) - Prompt 16: Deterministic chat commands framework (Telegram) + MVP commands

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 16` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/CHAT_COMMANDS.md`
- `docs/specs/TELEGRAM_THREADING_AND_EMOJI.md`
- `docs/specs/PERSONALISATION.md`
- `docs/specs/PERSONALITY_STORAGE.md`
- `docs/specs/AUTOMATION_RUNNER.md`
- `docs/AUTOMATIONS.md`

### Summary
- Added a registry-based deterministic Telegram command router (`commands.mjs`) that intercepts slash commands before orchestration and chat append.
- Implemented MVP command set:
  - `/help`, `/status`, `/whoami`
  - `/personality`, `/personality set <text>`, `/personality set --session <text>`, `/personality reset [--session|--global]`
  - `/automations [list]`, `/automations create <schedule> | <prompt>`, `/automations preview <schedule> | <prompt>`, `/automations enable <jobId>`, `/automations disable <jobId>`, `/automations delete <jobId>`, `/automations run <jobId>`
  - `/artifacts export`, `/artifacts show`
- Added command auditing to feedback events (`type: command_executed`) with command metadata, success/failure, thread/session/user IDs, args length, and args hash (no raw free-text args persisted).
- Added personality preview flow after `set` that calls `orchestrate` with `metadata.previewMode: true` and produces a short style preview.
- Added preview-mode behavior in orchestrator to avoid chat-history writes during command previews.
- Added control-plane methods for command-driven automation and artifacts operations.
- Refactored artifact export logic into runtime-core utility so control-plane and script share a single implementation.

### Scope and decisions
- **In scope:** deterministic command router, command handlers, audit event emission, preview-mode orchestration guardrails, control-plane API additions for automations/artifacts, and tests.
- **Out of scope:** introducing non-Telegram command surfaces or LLM intent-driven command parsing.
- **Key decisions:**
  - **Command interception:** all slash commands are consumed before normal debounce/orchestrate paths.
  - **Emoji lifecycle for commands:** simple command state flow uses `received (👀)` -> `done (✅)` (or `error (❌)`).
  - **Schedule normalization defaults:** command/API normalize to supported patterns: `daily HH:MM` -> `daily at HH:MM`, and pass-through for `every <n> minutes|hours|days`.
  - **Manual automation run ledger trigger:** run ledger records use trigger `manual`.

### Files changed
- `packages/polar-bot-runner/src/commands.mjs` - new deterministic command framework + handlers + command audit logging.
- `packages/polar-bot-runner/src/index.mjs` - command router integration, personality-only ad-hoc handler removal, command-first message handling.
- `packages/polar-control-plane/src/index.mjs` - new APIs:
  - `getAutomationJob`, `enableAutomationJob`, `deleteAutomationJob`, `previewAutomationJob`, `runAutomationJob`
  - `exportArtifacts`, `showArtifacts`
  - schedule normalization helper for create/update/preview
- `packages/polar-runtime-core/src/orchestrator.mjs` - `previewMode` handling to skip chat-history writes and automation proposal/action parsing in preview turns.
- `packages/polar-runtime-core/src/automation-job-store-sqlite.mjs` - added `getJob` and `deleteJob`.
- `packages/polar-runtime-core/src/artifact-exporter.mjs` - new shared artifact export/list utility.
- `packages/polar-runtime-core/src/index.mjs` - exports artifact exporter utilities.
- `scripts/export-artifacts.mjs` - now delegates to runtime-core artifact exporter.
- `tests/telegram-command-router.test.mjs` - new command router unit tests.
- `tests/runtime-core-orchestrator-preview-mode.test.mjs` - new preview no-history-write test.
- `tests/runtime-core-automation-job-store-sqlite.test.mjs` - added get/delete lifecycle assertions.
- `tests/control-plane-service.test.mjs` - added automation get/enable/delete/preview/manual run and artifacts export/show coverage.
- `tests/channels-thin-client-enforcement.test.mjs` - updated Telegram command routing source-guard assertion.
- `docs/IMPLEMENTATION_LOG.md` - appended Prompt 16 entry.

### Data model / migrations (if applicable)
- **Tables created/changed:** none.
- **Migration notes:** none.
- **Risk:** medium (Telegram ingress command path and control-plane API surface expanded), mitigated by new focused command/router tests + full-suite pass.

### Security and safety checks
- **Allowlist changes:** none required for Web UI for this prompt.
- **Capabilities/middleware affected:** manual automation run now goes through normal orchestrator path and middleware; no direct provider invocation from Telegram surface.
- **Sensitive operations:** command audit stores only args length/hash (no raw free-text command args), reducing leakage risk.

### Tests and validation
Commands run and outcomes:
- `node --test tests/telegram-command-router.test.mjs` - ✅
- `node --test tests/runtime-core-orchestrator-preview-mode.test.mjs` - ✅
- `node --test tests/runtime-core-automation-job-store-sqlite.test.mjs` - ✅
- `node --test tests/control-plane-service.test.mjs` - ✅
- `node --test tests/channels-thin-client-enforcement.test.mjs` - ✅
- `npm test` - ✅ (397 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)

### Known issues / follow-ups
- Manual automation-run test path emits expected memory extraction warning logs when provider output is non-JSON for extraction; this does not affect command success/ledger outcomes.
- Weekly schedule parsing is still intentionally unsupported in normalized command/API defaults for this prompt; current accepted defaults are daily/every-N formats.

### Next
- **Next prompt:** `Prompt 17` (if provided).
- **Suggested next phase:** add integration tests that simulate Telegram slash commands end-to-end (runner ingress -> command router -> control-plane effects) including audit event assertions on stored payload fields.

## 2026-03-01 (UTC) - Prompt 18: Deterministic chat commands framework (Telegram) implementing full CHAT_COMMANDS spec

**Branch:** `main`  
**Commit:** `not committed`  
**Prompt reference:** `Prompt 18` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/CHAT_COMMANDS.md`
- `docs/specs/TELEGRAM_THREADING_AND_EMOJI.md`
- `docs/specs/CONTROL_PLANE_API.md`
- `docs/SECURITY.md`

### Summary
- Rebuilt Telegram command handling into a deterministic registry router with strict parsing, explicit command metadata, and no LLM intent detection.
- Enforced command-first interception so command messages do not flow into `appendMessage` or normal `orchestrate` paths (except explicit orchestrated actions like `/personality preview` and `/automations run`).
- Added config-backed operator/admin gating via control-plane config records and denial auditing.
- Added command execution audit events (`type: command_executed`) with deterministic outcome (`success|failure|denied`) and args metadata (`length`, optional `hash`) while avoiding raw free-text arg storage.
- Implemented model registry persistence + chat command management and connected default selection to routing profile defaults.

### Command set implemented
- Public:
  - `/help [topic]` (+ alias `/commands`)
  - `/whoami`
  - `/status`
  - `/ping`
  - `/personality` (`show`, `set`, `set --session`, `set --global` [gated], `reset`, `reset --session`, `reset --global` [gated], `preview`)
  - `/automations` (`list`, `--all` [gated], `--user` [gated], `create`, `preview`, `show`, `enable`, `disable`, `delete`, `run`)
  - `/artifacts show`
- Operator/admin:
  - `/artifacts export`
  - `/models list`
  - `/models register <provider> <modelId> [--alias <alias>]`
  - `/models unregister <provider> <modelId|alias>`
  - `/models set-default <provider> <modelId|alias>`
- Optional surfaces currently explicit stub response:
  - `/memory ...` -> “not supported yet in this runner”
  - `/skills ...` -> “not supported yet in this runner”

### Scope and decisions
- **In scope:** deterministic Telegram command framework, full requested core command set, config-backed access gating, command audit telemetry, model registry persistence, and tests.
- **Out of scope:** implementing full Telegram memory/skills operational command backend in this prompt (explicitly returned as not-yet-supported command surface).
- **Key decisions:**
  - Authorization source of truth is control-plane config record `policy/telegram_command_access`; env allowlists remain fallback bootstrap only.
  - Model registry source of truth is control-plane config record `policy/model_registry`.
  - `/models set-default` applies to orchestration routing by updating global pinned profile model policy through control-plane (`setModelRegistryDefault`).

### New/updated config keys
- `resourceType=policy`, `resourceId=telegram_command_access`
  - `operatorUserIds: string[]`
  - `adminUserIds: string[]`
  - `allowBangCommands: boolean`
- `resourceType=policy`, `resourceId=model_registry`
  - `{ version, entries: [{ provider, modelId, alias? }], defaults }`
- Optional chat flag checked for artifact export:
  - `resourceType=policy`, `resourceId=telegram_chat_flags:<chatId>` with `allowArtifactsExport: true`

### Files changed
- `packages/polar-bot-runner/src/commands.mjs`
  - Registry-based deterministic command router, parser, gating, standardized errors, audit metadata, implemented command handlers.
- `packages/polar-bot-runner/src/index.mjs`
  - Wired new command router auth fallback lists (`POLAR_OPERATOR_TELEGRAM_IDS`, `POLAR_ADMIN_TELEGRAM_IDS`) and removed legacy inline operator checker wiring.
- `packages/polar-control-plane/src/index.mjs`
  - Added model-registry methods: `getModelRegistry`, `upsertModelRegistry`, `setModelRegistryDefault`.
- `packages/polar-web-ui/vite.config.js`
  - Extended `ALLOWED_ACTIONS` with model-registry control-plane methods.
- `docs/specs/CHAT_COMMANDS.md`
  - Documented command access/model registry config key names and schema.
- `docs/specs/CONTROL_PLANE_API.md`
  - Added model-registry API methods to allowed surface contract.
- `tests/telegram-command-router.test.mjs`
  - Reworked tests for parsing, deterministic interception, usage errors, gating deny path, and model registry command flow.
- `tests/control-plane-service.test.mjs`
  - Added model registry persistence + routing default application coverage.

### Data model / migrations (if applicable)
- **Tables created/changed:** none.
- **Migration notes:** none (uses existing config registry records).
- **Risk:** medium (command ingress and operator/admin operations expanded), mitigated by focused and full-suite tests.

### Security and safety checks
- Sensitive commands are explicitly gated by deterministic allowlists.
- Denied command attempts are logged and audited.
- Command free-text args are not persisted raw in audit payloads.
- Model list output remains safe (no credential fields surfaced).

### Tests and validation
Commands run and outcomes:
- `node --check packages/polar-bot-runner/src/commands.mjs` - ✅
- `node --check packages/polar-control-plane/src/index.mjs` - ✅
- `node --check packages/polar-bot-runner/src/index.mjs` - ✅
- `node --test tests/telegram-command-router.test.mjs` - ✅
- `node --test tests/control-plane-service.test.mjs` - ✅
- `npm test` - ✅ (401 passed, 0 failed)
- `npm run check:boundaries` - ✅ (`[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.`)

### Blockers
- None.

### Next
- **Next prompt:** `Prompt 19` (if provided).
- **Suggested next phase:** implement full `/memory` and `/skills` Telegram command handlers against existing control-plane APIs with operator-safe pagination/redaction behavior.
