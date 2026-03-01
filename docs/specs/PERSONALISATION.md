# Personalisation (personality profiles)

## Purpose
Allow users to set a desired personality for the assistant:
- via chat (Telegram/Web surfaces)
- via a Web UI editor
- with durable persistence
- with a markdown representation (`artifacts/PERSONALITY.md`) similar to other “living artefacts”.

Personalisation must:
- affect tone, style, verbosity, and interaction preferences
- never override system/developer safety or capability policy
- never grant new tools/capabilities
- be auditable and reversible

## Definitions
- **Personality profile**: a user-provided text block that guides style and interaction preferences.
- **Effective personality**: the personality applied to a given turn, resolved by precedence rules.
- **Scope**:
  - `global`: default for the whole deployment
  - `user`: applies to a user across sessions
  - `session`: applies within a session only

## Precedence
Effective personality is resolved in this order (highest wins):
1) session profile (sessionId + userId)
2) user profile (userId)
3) global profile (default)

If no profile exists at any scope, use a built-in default personality (neutral).

## Where personality is applied
Personality is applied inside the orchestration pipeline, as a dedicated prompt section inserted into the system/developer context.

Rules:
- Insert as a clearly labelled section, for example:

  "## Personality
   Follow the style guidance below unless it conflicts with system/developer instructions.
   <profile text>"

- This section must not be treated as executable instructions for tools or security policy.

## Input and update flows
### Chat configuration (preferred)
Personality updates should be deterministic and not depend on an LLM interpreting intent.

Supported commands (Telegram and Web chat surfaces):
- `/personality` → show current effective personality (scope + preview)
- `/personality set <text>` → set a user-scoped personality for the caller
- `/personality set --session <text>` → set a session-scoped personality for the current session
- `/personality set --global <text>` → only allowed for operator/admin contexts (optional)
- `/personality reset` → reset user-scoped personality
- `/personality reset --session` → reset session-scoped personality
- `/personality reset --global` → reset global (admin only)

Optional alias:
- `personality:` prefix (treat remainder as `/personality set ...`)

### Web UI editor
Web UI should provide a simple editor for:
- global personality (operator)
- a selected user personality (operator)
- optionally show current effective personality for a session/user

UI should call explicit control-plane methods, not write directly to markdown.

## Validation and limits
To avoid prompt bloat and abuse:
- Max length: 2,000 characters (configurable)
- Strip or reject:
  - null bytes
  - extremely long lines (e.g. > 500 chars) if needed
- Store exactly what the user wrote after validation.
- Do not attempt to “sanitize away” safety-breaking content; safety comes from system policy and middleware, not from trusting personality.

## Audit and observability
Every update must be recorded:
- who (userId) changed it
- what scope
- when
- length and hash of text (optional)

## Markdown artefact (`artifacts/PERSONALITY.md`)
`export:artifacts` must generate:
- the global personality
- and optionally the current user personality for the primary operator user (or list all users if you have that concept)

The artefact is a projection, not the store.

## Acceptance criteria
- A user can set personality via chat command.
- The personality influences responses (observable in tone).
- The profile persists across restarts.
- Web UI can view and update profiles via control plane.
- `artifacts/PERSONALITY.md` is generated and reflects current stored profiles.

## Agent checklist
- Check `AGENTS.md` first.
- Read the last 150 lines of `docs/IMPLEMENTATION_LOG.md` before starting.
- Write a log entry using the agreed template when done.