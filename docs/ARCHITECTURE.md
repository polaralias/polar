# Architecture

Polar is a contract-first runtime for building agentic assistants (Telegram bot, Web UI, CLI) where **code decides** and the model can only propose.

## Goals
- Safety by default: every callable operation is contract-validated and passes through non-bypassable middleware.
- Extensibility: skills can be installed and executed without turning the core into a pile of bespoke glue.
- Multi-surface: Telegram, Web UI, and future channels share one backend and one set of guarantees.

## Current state vs target state
Polar is mid-refactor.

**Current (today)**
- Each surface (Telegram runner, Web UI) wires up its own boot logic.
- Some packages import other packages’ `src/` paths directly (monorepo boundary leak).
- SQLite is the shared persistence layer (`polar-system.db`).

**Target (next)**
- A single composition root (a bootstrap package) is the only place that wires the system together.
- Surfaces become thin adapters: normalise input, call the control plane, render output.
- No cross-package `src/` imports. Apps import package exports only.

## High-level topology
### Surfaces
- Telegram bot runner: chat UX (threading, reactions, attachments) + delivery.
- Web UI: operator view for provider config, budgets, memory inspection, etc.

### Control plane
Owns policy and orchestration wiring:
- provider resolution and routing
- contract registry
- policy gates (approvals, budgets, capability allowlists)

### Runtime core
Owns the execution pipeline:
- gateways (provider, memory, scheduler, audit)
- middleware chain
- tool execution plumbing

## Execution pipeline (conceptual)
1. **Ingress**: a channel adapter receives a message/event.
2. **Normalisation**: channel payload is converted into a Polar turn request.
3. **Orchestration**: the control plane chooses the route (agent profile / workflow / skills).
4. **Generation**: provider gateway calls the LLM.
5. **Tool calls**: any tool execution goes through:
   - input contract validation
   - before-middleware (policy, approvals, budget)
   - tool execution
   - after-middleware (audit, metrics, memory writes)
   - output contract validation
6. **Egress**: channel adapter sends the final reply (plus optional reactions/UX).

## Packages (what matters)
Names may evolve, but keep these responsibilities stable:
- `@polar/runtime-core`: gateways + middleware + shared primitives
- `@polar/control-plane`: contract registry + provider/agent selection
- `@polar/bot-runner`: Telegram surface
- `polar-web-ui`: Operator UI surface
- `polar-adapter-native`: HTTP provider adapter(s)

There is legacy/experimental adapter code under `polar-adapter-pi`. We’re not positioning that as a customer-facing option.

## Data and persistence
- SQLite is the current source of truth.
- Treat “markdown living files” (reactions, heartbeat summaries) as **exports/projections**, not storage.
- If/when semantic recall needs embeddings, add them as an optional layer (don’t replace your event log).

## What to refactor next
- Add a single bootstrap/composition root package that constructs:
  - DB + state stores
  - control plane service
  - provider resolution
  - middleware chain
- Update surfaces to call that bootstrap and stop importing `src/` from other packages.


## Implementation specs
- Bootstrap: `docs/specs/BOOTSTRAP.md`
- Boundaries: `docs/specs/BOUNDARIES.md`
- Telegram surface contract: `docs/specs/TELEGRAM_SURFACE.md`
- Web UI surface contract: `docs/specs/WEB_UI_SURFACE.md`
