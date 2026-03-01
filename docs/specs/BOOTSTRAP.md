# Bootstrap and composition root

## Purpose
Polar must have exactly one place where the system is wired together (DB, durable stores, control-plane service). Every surface (Telegram runner, Web UI, CLI, future channels) must call this bootstrap and must not construct the control plane directly.

This is the “single spine” refactor referenced by `docs/ARCHITECTURE.md`.

## Non-negotiables
- No surface may call provider APIs directly. Surfaces call control-plane methods only.
- No surface may import another workspace package’s `src/` paths. Use workspace package exports.
- Bootstrap code must not depend on Telegram or Web UI code.
- dotenv must not be required by library packages. Only surfaces may load env.

## Package
Create a new workspace package:

- Path: `packages/polar-platform/`
- Package name: `@polar/platform`
- Entry: `packages/polar-platform/src/index.mjs`

### Exports
`@polar/platform` must export:

- `createPolarPlatform(config)`
- `closePolarPlatform(platform)` (optional convenience)
- `defaultDbPath()` (optional convenience)

### `createPolarPlatform(config)` signature
`config` object:

- `dbPath` (string, required): absolute or relative path to SQLite database.
- `now` (function, optional): returns epoch ms. Default: `Date.now`.
- `auditSink` (function, optional): `(event) => void | Promise<void>`
- `devMode` (boolean, optional)

Return object (frozen):
- `db`: `better-sqlite3` Database instance
- `controlPlane`: service returned by `createControlPlaneService`
- `dbPath`: resolved db path used
- `shutdown()`: closes DB and frees resources

### What bootstrap wires
Bootstrap must construct these durable stores/providers from `@polar/runtime-core` and pass them into `createControlPlaneService`:

- `createSqliteSchedulerStateStore({ db, now })`
  - Source: `packages/polar-runtime-core/src/scheduler-state-store-sqlite.mjs`

- `createSqliteBudgetStateStore({ db, now })`
  - Source: `packages/polar-runtime-core/src/budget-state-store-sqlite.mjs`

- `createSqliteMemoryProvider({ db, now })`
  - Source: `packages/polar-runtime-core/src/memory-provider-sqlite.mjs`

Then create the control plane:

- `createControlPlaneService({ schedulerStateStore, budgetStateStore, memoryProvider, auditSink, now, ... })`
  - Source: `packages/polar-control-plane/src/index.mjs`

Bootstrap may pass through optional config you already support (seed records, etc). Do not invent new config unless required.

## Where it must be used
These must stop constructing DB/control plane directly and must call `createPolarPlatform()`:

- Telegram runner: `packages/polar-bot-runner/src/index.mjs`
- Web UI dev server: `packages/polar-web-ui/vite.config.js`
- CLI (if it spins up control plane): `packages/polar-cli/*`

## Provider resolution
Provider resolution can remain inside the control plane initially (current `resolveProvider` path uses `polar-adapter-native`).

Do not introduce any `pi-*` dependencies into bootstrap. `polar-adapter-pi` is scheduled for removal.

## Acceptance criteria
- `@polar/platform` exists and is importable.
- Surfaces construct control plane only via `@polar/platform`.
- No new direct DB wiring exists in surfaces.
- Tests pass:
  - `npm test`
  - `npm run check:boundaries`

## Failure modes to avoid
- Loading dotenv inside `@polar/platform` or any library package.
- Passing raw provider keys around in surfaces.
- Creating multiple DB instances per process unless explicitly required.

## Agent checklist
- Check `AGENTS.md` first.
- When done, append an entry to `docs/IMPLEMENTATION_LOG.md` (include tests run and next prompt).
