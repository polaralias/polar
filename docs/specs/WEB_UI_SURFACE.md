# Web UI surface contract (Vite dev server plugin)

## Purpose
Web UI is an operator surface for inspecting and configuring the control plane. It is not a privileged backdoor.

Source:
- `packages/polar-web-ui/vite.config.js`

## Bootstrapping
Web UI must obtain `controlPlane` via `@polar/platform`.

It must not:
- create its own DB instance once bootstrap exists
- import other packages’ `src/` paths

## API exposure model
The Vite plugin exposes `/api/<action>` endpoints. This must be allowlisted.

### Action allowlist
Rules:
- Dispatch must be gated by an explicit Set, eg `ALLOWED_ACTIONS`.
- It must match `docs/specs/CONTROL_PLANE_API.md`.
- New control-plane methods must not be exposed until explicitly allowlisted.

### Authorisation
If `POLAR_UI_API_SECRET` is set:
- require `Authorization: Bearer <secret>` for all API calls.

If not set:
- the server is effectively open. Do not deploy this configuration beyond local dev.

## Markdown file editor
Current `readMD` and `writeMD` must be constrained by resolved-path allowlists.

Allowed read/write targets:
- Root: `AGENTS.md` (read/write)
- Docs: `docs/**/*.md` (read/write)
- Artifacts: `artifacts/**/*.md` (read-only recommended)

Path validation rules:
- reject absolute paths
- reject traversal (`..`)
- resolve to absolute, verify it is within allowed directories
- reject anything outside allowlist

Write policy:
- do not write to `artifacts/` by default (exports are generated)
- allow writing to docs

## Proactive and automations
Web UI may list jobs and run ledgers once implemented.
Web UI must not create proactive jobs silently without explicit user intent.

## Tests
Add or maintain:
- unit tests for path validation (no traversal)
- endpoint rejects non-allowlisted actions

Run:
- `npm test`

## Agent checklist
- Check `AGENTS.md` first.
- When done, write to `docs/IMPLEMENTATION_LOG.md`.
