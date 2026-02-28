# AGENTS.md

Last updated: 2026-02-28

## Purpose
This file defines how implementation agents should work in this repository.

Primary goal: Build the AI assistant on top of the Polar framework **without prompt-driven logic** and without misleading “100% complete” claims.

## Canonical References
Read these first before implementing:
1. `docs/project-overview.md`
2. `docs/architecture/deterministic-orchestration-architecture.md`
3. `docs/architecture/chat-routing-and-multi-agent.md`

## Non-Negotiable Runtime Invariants
1. Every tool call has before and after middleware.
2. Every agent handoff has before and after middleware.
3. Every automation step and heartbeat run has before and after middleware.
4. Every callable operation uses explicit typed input and output contracts.
5. Unknown or invalid input/output is rejected, never silently accepted.
6. No extension path bypasses policy, contract validation, or audit logging.
7. **Model can propose. Code must decide** for routing, state, permissions, workflow execution, and approvals.

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

## Working Rules
1. Read the docs carefully and align changes to them.
2. Ask questions up front only if ambiguity would cause real damage.
3. Work until you can’t progress or you must stop.
4. Add tests with each feature (unit + integration; add e2e where behaviour changes).
5. Update docs when behaviour or architecture decisions change.
6. Never run “fixes” purely by adding more system prompt rules unless there is deterministic enforcement in code.

## Logging Rules (Mandatory)
1. Log everything you do in `docs/implementation/implementation-log.md`.
2. Entries must be append-only.
3. Use concrete status:
   - `Done` only for shipped work that meets Definition of Done
   - otherwise `In Progress` or `Blocked`
4. Every `Done` entry must include:
   - files changed
   - tests run (exact command or test names)
   - evidence notes (what was verified manually)
   - follow-ups

## Completion Claims Policy (No more “gaslit 100%”)
1. Do not claim “complete”, “finalised”, “nothing left”, or “100%” unless you can cite:
   - the scope definition being completed
   - the tests that passed
   - the acceptance criteria satisfied
2. If you are unsure, say what is verified and what is not.
3. “Progress: NN%” is optional; if used, it must be evidence-based and scoped (module-level), not “whole platform”.

## Definition Of Done For Any Task
A task is done only when:
1. Code is merged or committed in the branch scope requested.
2. Contracts and middleware requirements are satisfied.
3. Tests for the touched behaviour pass or failures are explicitly documented.
4. Documentation is updated if behaviour changed.
5. `docs/implementation/implementation-log.md` has a clear done entry (with evidence).

## Development Harness Rules (Dev-Only)
1. Chrome DevTools MCP may be used only for development and CI harness automation.
2. Chrome DevTools MCP is not an end-user runtime tool, extension, or profile capability at this stage.
3. Local implementation flow is: write or update automated tests first.
4. If a change adds or modifies web/control-plane behaviour, run DevTools-based checks after implementation and record the outcome.
5. Harness runs must execute against non-production environments with least-privilege credentials and scoped test data.
6. Promotion from dev-only harness use to runtime capability requires explicit architecture and policy documentation updates before implementation.
