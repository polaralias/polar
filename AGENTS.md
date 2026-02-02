# Repository Principles

1. **Security first.** Runtime is the only authority; every external interaction is guarded by policy, capability tokens, and audit logging. No bypasses.
2. **Least privilege.** Grants must be explicit and scoped; denial is the default unless a narrow grant exists.
3. **Human-readable truth.** Docs (policy model, threat model, implementation stages, logs) must describe invariants so contributors understand guarantees without diving into code.

## Pre-PR Checklist
- Run `pnpm install` (if dependencies changed) and `pnpm -r build` to ensure the workspace compiles.
- Run `pnpm --filter @polar/core test` plus any new tests you added.
- Run `pnpm --filter @polar/runtime lint` to catch runtime-specific TS issues.

## Implementation workflow
- Read `docs/implementation/product-vision.md` first; it is authoritative before coding starts.
- Implement only the next stage in order using `.md` files stored in `docs/implementation/phase_*`.
- Check `docs/logs/implementation-log.md` to understand current state and avoid duplicate work.

## Post implementation
- Update `docs/implementation/product-vision.md` to reflect the changes made.
- Update `docs/logs/implementation-log.md` to reflect the changes made, uusing the existing table format: Date (YYYY-MM-DD), short summary, and bulletized details mentioning key files/paths touched. Keep the log chronological and avoid overwriting previous entries.
- Create feature documentation under `docs/features/`, tailored for end users and developers.