# Workspace boundaries and dependency rules

## Purpose
This repo is a monorepo of workspace packages. Refactors become unsafe if packages import each other by reaching into `src/` or by copying boot logic into surfaces.

This document defines boundaries that must be enforced by scripts and tests.

## Hard rules
1) No cross-package `src/` imports
- Forbidden:
  - `../../polar-control-plane/src/index.mjs`
  - `../polar-runtime-core/src/*`
  - any import specifier containing `/polar-*/src/`

Allowed:
- workspace package imports, eg `@polar/control-plane`
- within-package relative imports, eg `./foo.mjs`

2) One composition root
- Only `@polar/platform` wires:
  - DB open
  - durable stores
  - createControlPlaneService
- Surfaces call `createPolarPlatform` and use `platform.controlPlane`.

3) Surfaces are thin
- Telegram runner and Web UI must not:
  - create provider adapters
  - call LLM APIs directly
  - bypass middleware

4) Pi is not part of the product
- `packages/polar-adapter-pi/` is removed from the active workspace.
- Do not add `@mariozechner/pi-*` dependencies or any new pi-adapter package.

## Enforcement
Replace pi-specific boundary scripts with workspace boundary checks:
- Script: `scripts/check-workspace-boundaries.mjs`
- npm script: `npm run check:boundaries`

The boundary checker must fail the build if it finds:
- any cross-package src import
- any surface depending on forbidden packages (pi packages)
- optional: any import of `packages/` absolute paths

## Acceptance criteria
- `npm run check:boundaries` passes on main.
- Any introduced boundary violation fails CI.
- Tests pass: `npm test`

## Agent checklist
- Check `AGENTS.md` first.
- When done, write to `docs/IMPLEMENTATION_LOG.md`.
