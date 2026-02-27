# AGENTS.md

Last updated: 2026-02-25

## Purpose

This file defines how implementation agents should work in this repository for the new AI Assistant phase.

Primary goal: Go full agentic dev to build the AI assistant leveraging the completed Polar framework.

## Canonical References

Read these first before implementing:

1. `docs/project-overview.md`

## Non-Negotiable Runtime Invariants

1. Every tool call has before and after middleware.
2. Every agent handoff has before and after middleware.
3. Every automation step and heartbeat run has before and after middleware.
4. Every callable operation uses explicit typed input and output contracts.
5. Unknown or invalid input/output is rejected, never silently accepted.
6. No extension path bypasses policy, contract validation, or audit logging.

## pi-mono Integration Rules (Semi-Modular Required)

`pi-mono` is a temporary foundation. Keep it isolated so it can be removed later.

1. Only adapter modules may import `pi-mono`.
2. Runtime core/domain modules must depend on Polar interfaces, not `pi-mono` types.
3. Session, message, and contract schemas must be Polar-owned.
4. New capabilities must be wired through contract registry + middleware, not direct adapter calls.

Recommended package boundaries:

1. `packages/polar-domain`
2. `packages/polar-runtime-core`
3. `packages/polar-adapter-pi`
4. `packages/polar-adapter-channels`
5. `packages/polar-adapter-extensions`
6. `packages/polar-control-plane`

## Implementation Priorities

1. We are moving into full agentic dev to build the AI assistant on top of the Polar framework. More documentation will be fleshed out soon.

## Working Rules

1. Prioritize as many changes as possible, with as few PRs as possible. Go full agentic dev.
2. Read the docs carefully.
3. Ask questions up front if anything is unclear before jumping into execution.
4. Work until you can't or need to stop.
5. Log everything you do in `docs/implementation/implementation-log.md`.
6. Add tests with each feature (unit + integration; add e2e where behavior changes).
7. Do not introduce file-based canonical config for runtime controls unless necessary.
8. Update docs when behavior or architecture decisions change.
9. Never use git to commit changes, ask the user to commit once changes are complete.

## Agent Message Format

1. End every user-facing message with a progress percentage based on **overall platform/project completion only** in the format: `Progress: NN%`.
2. Do **not** report progress for the current task, PR, phase, chain-of-thought, or review stage; do **not** reset progress to `0%` for each new task/PR.
3. Calculate the percentage against total project scope completed so far versus total project scope remaining.
4. Use `Progress: 100%` only when the entire platform is fully complete with all code built, tested and completed.

## Documentation Reconciliation Lessons (2026-02-22)

1. Treat `docs/implementation/implementation-log.md` plus passing tests as the implementation truth source when reconciling status documents.
2. Keep `docs/project-overview.md` synchronized when baseline delivery state changes.
3. Convert stale `Planned` or pre-implementation wording to execution-aware language once gateway baselines are shipped, while clearly calling out remaining integration/hardening work.
4. When documentation drift is found, log it as explicit audit work and close it with a completed implementation-log entry after reconciliation.

## Development Harness Rules (Dev-Only)

1. Chrome DevTools MCP may be used only for development and CI harness automation.
2. Chrome DevTools MCP is not an end-user runtime tool, extension, or profile capability at this stage.
3. Local implementation flow is: write or update automated tests first.
4. If a change adds or modifies web/control-plane behavior, run DevTools-based checks after implementation and record the outcome.
5. Harness runs must execute against non-production environments with least-privilege credentials and scoped test data.
6. Promotion from dev-only harness use to runtime capability requires explicit architecture and policy documentation updates before implementation.

## Required Implementation Log

A clear done-log is mandatory and must be updated as work completes.

Log file path:

1. `docs/implementation/implementation-log.md`

Update rules:

1. Add one entry per completed task/PR.
2. Keep entries append-only.
3. Use concrete status (`Done` only for shipped/merged work).
4. Include date, owner, summary, files touched, tests run, and follow-ups.
5. If a task is partially complete, log it in the active section as `In Progress`, not `Done`.

## Definition Of Done For Any Task

A task is done only when:

1. Code is merged or committed in the branch scope requested.
2. Contracts and middleware requirements are satisfied.
3. Tests for the touched behavior pass or failures are explicitly documented.
4. Documentation is updated if behavior changed.
5. `docs/implementation/implementation-log.md` is updated with a clear done entry.
