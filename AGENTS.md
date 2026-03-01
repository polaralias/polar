# AGENTS.md

Last updated: 2026-03-01

This file defines how implementation agents (human or coding agent) should work in this repository.

## Canonical docs (read first)
Truth set:
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/DEVELOPMENT.md`
- `docs/SKILLS.md`
- `docs/AUTOMATIONS.md`
- `docs/MEMORY_AND_FEEDBACK.md`

Implementation-grade specs (read the relevant ones before coding):
- `docs/specs/BOOTSTRAP.md`
- `docs/specs/CONTROL_PLANE_API.md`
- `docs/specs/DATA_MODEL.md`
- `docs/specs/TELEGRAM_SURFACE.md`
- `docs/specs/WEB_UI_SURFACE.md`
- `docs/specs/AUTOMATION_RUNNER.md`
- `docs/specs/BOUNDARIES.md`
- `docs/specs/TESTING_STRATEGY.md`
- `docs/specs/CHAT_COMMANDS.md`
- `docs/specs/TELEGRAM_THREADING_AND_EMOJI.md`
- `docs/specs/PERSONALISATION.md`
- `docs/specs/PERSONALITY_STORAGE.md`
- `docs/specs/AGENT_PROFILES.md`
- `docs/specs/AGENT_REGISTRY_AND_PINNING_APIS.md`

Change and decision history:
- `docs/IMPLEMENTATION_LOG.md`

Older docs live in `docs/_archive/2026-03-01/` and are reference-only.

## Non-negotiable invariants
1. **All provider calls and tool calls go through gateways and middleware.**
   - No direct LLM calls from surfaces (Telegram/Web UI/CLI).
2. **Capabilities are enforced in code.**
   - The model can propose, but cannot expand privileges on its own.
3. **Automations are first-class and safe.**
   - A scheduled run must execute through the same middleware pipeline as interactive chat.
4. **No cross-package `src/` imports from surfaces.**
   - Apps import via workspace package exports (boundary rules must pass).
5. **Audit and traceability are always on.**
   - Every meaningful action should leave an event trail.

## Working approach
- Prefer small, testable steps. Avoid repo-wide rewrites unless the spine is clearly stabilised.
- Before adding features, stabilise composition:
  - a single “boot Polar” entrypoint (`@polar/platform`)
  - thin surfaces that do ingress/egress only
- Always update `docs/IMPLEMENTATION_LOG.md` when you make a structural change or a decision that affects future work.

### If you are executing prompt-by-prompt with cleared context
Do this every run:
1) Read `AGENTS.md`
2) Read the relevant spec(s) under `docs/specs/`
3) Read the latest entry in `docs/IMPLEMENTATION_LOG.md` and use it as your handoff
4) After completing the prompt:
   - append a new log entry including:
     - prompt id/title
     - commit hash (or “not committed”)
     - tests run
     - any blockers
     - next prompt id/title

## Definition of done for a change
- Tests pass (`npm test`)
- Boundary checks pass (`npm run check:boundaries`)
- Docs updated where behaviour changed
- Implementation log updated for structural/behavioural decisions
