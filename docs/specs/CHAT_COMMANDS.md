## Purpose
Provide a deterministic, non-LLM command layer for configuration and operator actions through chat surfaces (Telegram first, later Web chat). This ensures:
- reproducible behaviour
- no LLM guesswork for config changes
- secure, auditable changes
- consistent UX across features (personality, automations, exports, models, etc.)

## Core rules
1) Commands MUST be handled by the surface before orchestration.
2) Commands MUST NOT be appended as normal user messages for LLM orchestration.
3) Commands MUST call explicit control-plane methods. Surfaces must not access SQLite directly.
4) Commands MUST have strict parsing and validation (no “smart parse” with an LLM).
5) If a command fails, respond clearly and do not partially apply changes.
6) Sensitive commands must be gated (admin/operator) and logged.
7) Commands must be thread-aware: they should include the derived `threadKey` in outputs where relevant.

## Command format
### Telegram
- Slash commands: `/command ...args`
- Optional aliases: `!command ...args` (off by default)
- Optional “command message”: `command:` prefix (off by default, and only for specific commands)

Parsing rules:
- Command is first token after `/`.
- Everything after is raw args string.
- Do not interpret natural language beyond fixed patterns and flags.

### Future Web chat
- Support the same command strings as Telegram.

## Implementation model
Create a registry:
- `name`
- `aliases`
- `help` (one line)
- `usage` (examples)
- `flags` schema (optional)
- `access` (`public` | `operator` | `admin`)
- `handler(ctx, args, sessionContext, controlPlane)`

Handlers return:
- `{ handled: true, text: string, markdown?: boolean }`
or throw a structured error that the runner catches and renders.

Command confirmations (e.g. `/automations disable`, `/agents register`) are executed through `controlPlane.orchestrate` so they share the standard middleware/audit path, and their focus anchor is derived from the reply context blocks described in `docs/specs/FOCUS_CONTEXT_AND_PENDING.md`.

## Security model for operator/admin commands
Implement a deterministic gate:
- `isOperator(userId, chatId)` or config allowlist (preferred)
- or `POLAR_OPERATOR_SECRET` (fallback for Web UI only)
- or “local dev only” guard

Current Telegram config keys:
- `resourceType=policy`, `resourceId=telegram_command_access`
  - `operatorTelegramUserIds: string[]`
  - `adminTelegramUserIds: string[]`
  - `allowBangCommands: boolean` (optional, enables `!command`)

Environment overrides and bootstrap:
- `POLAR_DISABLE_CHAT_ADMIN=1` denies operator/admin commands.
- `POLAR_ADMIN_TELEGRAM_IDS` / `POLAR_OPERATOR_TELEGRAM_IDS` (comma separated) override bootstrap when either is set.
- `POLAR_SINGLE_USER_ADMIN_BOOTSTRAP=1` (default on when unset) enables private-chat-only first-user admin bootstrap when explicit allowlists are absent.

Rules:
- Never expose secrets back into chat.
- Log attempted and denied commands.

## Audit logging
Every command execution must produce an event:
- type: `command_executed`
- timestamp
- userId, sessionId, threadKey
- command name
- outcome: `success` / `failure` / `denied`
- args metadata: `{ length, hash? }` (do not store raw free-text args for commands like personality)

Destination:
- Preferred: feedback events store (`polar_feedback_events`)
- Alternative: dedicated command log table (only if needed)

## Thread awareness
Derive `threadKey` per `docs/specs/TELEGRAM_THREADING_AND_EMOJI.md`:
- topic > reply > root
Include it in:
- `/status`
- `/whoami`
- any command output that references context

## Commands

### 1) Help and discovery (public)
#### `/help`
Lists:
- command name
- one-line help
- key examples
If operator/admin commands exist, show them only to authorised users.

Usage:
- `/help`
- `/help personality`

#### `/commands`
Alias of `/help` (optional).

#### `/about`
Short description of Polar, version/build info if available (safe info only).

---

### 2) Identity and status (public)
#### `/whoami`
Shows derived identifiers and chat context:
- userId
- chatId
- sessionId
- threadKey
- telegram username if available (non-authoritative)

#### `/status`
Shows operational health for this session/surface:
- sessionId, threadKey
- dbPath (optional, safe only)
- last message timestamp (if available)
- queue counts (optional, cheap only)
- whether automations runner is enabled (if known)

#### `/ping`
Returns “pong” + timestamp.

---

### 3) Personality profiles (public; global requires operator/admin)
(Backed by control-plane personality API per `docs/specs/PERSONALISATION.md` and `docs/specs/PERSONALITY_STORAGE.md`.)

#### `/personality`
Shows effective personality:
- scope (`session`/`user`/`global`/`default`)
- updated time
- preview snippet (first ~200 chars)

#### `/personality set <text>`
Sets user-scoped personality.

#### `/personality set --session <text>`
Sets session-scoped personality for current session.

#### `/personality reset`
Removes user-scoped personality.

#### `/personality reset --session`
Removes session-scoped personality.

Operator/admin only:
- `/personality set --global <text>`
- `/personality reset --global`

Optional:
- `/personality preview`
Runs a one-shot preview turn using the effective personality without side effects.

---

### 4) Automations (public for own jobs; operator can manage all)
(Backed by control-plane automation jobs and runner per `docs/specs/AUTOMATION_RUNNER.md`.)

#### `/automations`
Lists automation jobs for caller (default):
- id (short)
- enabled
- schedule summary
- prompt summary
- next run time (if available)

Operator:
- `/automations --all`
- `/automations --user <userId>`

#### `/automations create <schedule> | <prompt>`
Deterministic creation using delimiter `|`.

Examples:
- `/automations create daily 18:00 | Tell me to do the evening back routine`
- `/automations create weekly Mon 07:00 | Update my progressive overload week and send the plan`

#### `/automations preview <schedule> | <prompt>`
Shows what would be stored and how it will run. Does not create.

#### `/automations enable <jobId>`
#### `/automations disable <jobId>`
#### `/automations delete <jobId>`
#### `/automations run <jobId>`
Manual run (still goes through orchestrator and middleware).

#### `/automations show <jobId>`
Shows full stored job config (safe fields only).

Optional:
- `/automations quiet-hours set 22:00-07:00`
- `/automations quiet-hours clear`

Schedule grammar (initial):
- `daily HH:MM`
- `weekly <Mon|Tue|...> HH:MM`
All times interpreted as server timezone or user timezone if available. Pick one and document it.

---

### 5) Artifacts exports (public read; export requires operator or explicit enable)
(Backed by `export:artifacts` per `docs/specs/ARTIFACT_EXPORTS.md`.)

#### `/artifacts show`
Lists:
- available artifacts under `artifacts/`
- last export time (recorded in DB or derived from file mtime safely)

#### `/artifacts export`
Triggers artifacts generation.
Access: operator/admin by default.

Optional:
- allow user export if you have a per-chat config flag `allowArtifactsExport=true`.

---

### 6) Feedback and reactions (public read for self; operator for all)
(Backed by feedback events store per `docs/specs/DATA_MODEL.md`.)

#### `/feedback recent`
Shows the last N feedback events for current session.

Operator:
- `/feedback recent --all`

---

### 7) Memory inspection (public limited; operator expanded)
(Backed by memory provider and control-plane memory API.)

#### `/memory search <query>`
Searches memory for current user/session scope.

#### `/memory show <memoryId>`
Shows a memory record (redact any sensitive content if your app classifies it).

Operator:
- `/memory search --all <query>`

Note: Do not provide `/memory upsert` via chat until you have a safe review UI.

---

### 8) Skills and extensions (operator/admin)
(Backed by skill install and extensions APIs in control-plane.)

#### `/skills`
Lists installed skills.

#### `/skills install <source>`
Source examples:
- `repo:<path>`
- `url:<...>` (only if you implement safe fetch)
- `paste` (only if you implement safe multi-message capture)

#### `/skills block <skillId>`
#### `/skills unblock <skillId>`

#### `/extensions`
Lists extension states.

#### `/extensions enable <extensionId>`
#### `/extensions disable <extensionId>`

---

### 9) Provider and model configuration (operator/admin)
Yes, you can support registering models via chat, but it must be gated. This is effectively configuring provider access.

#### `/models`
Lists currently configured providers and their available models (safe fields only). Uses control-plane `listModels` where available, but should not leak keys.

#### `/models refresh`
Refresh model list from providers (operator only). May call provider list API if implemented.

#### `/models register <provider> <modelId> [--alias <alias>]`
Registers a model for use by routing/policies.

Rules:
- This should not create provider keys.
- Provider credentials must already exist as config records.
- Registration writes a config record that routing can use (eg “allowedModels” or “model registry”).

Example:
- `/models register openai gpt-5-mini --alias fast`
- `/models register anthropic claude-sonnet-4-6 --alias balanced`

#### `/models unregister <provider> <modelId|alias>`
Removes a registration.

#### `/models set-default <provider> <modelId|alias>`
Sets default model used by routing policy.

Data model options:
- Store as config records in your existing config registry
- Or create a dedicated `polar_model_registry` table later

Current key (implemented):
- `resourceType=policy`, `resourceId=model_registry`
  - `{ version, entries: [{ provider, modelId, alias? }], defaults?: { provider, modelId, alias? } }`

Security:
- Operator/admin only.
- Audit every change.
- Never echo credentials.

---


### Agent profiles and pinning (operator/admin for registry; pin use can be public)
See `docs/specs/AGENT_PROFILES.md`.

- `/agents` (list available sub-agent profiles)
- `/agents show <agentId>`
- `/agents register <agentId> | <profileId> | <description>` (operator/admin)
- `/agents unregister <agentId>` (operator/admin)
- `/agents pin <agentId> [--session|--user|--global]`
- `/agents unpin [--session|--user|--global]`
- `/agents pins` (show current effective pinned profile/agent)

Notes:
- `register` maps an `agentId` to an existing `profileId` plus metadata.
- `pin` resolves agentId → profileId and writes the appropriate `profile-pin:*` policy record.
- Registry storage key: `resourceType=policy`, `resourceId=agent-registry:default`.


### 10) Config records (operator/admin; optional)
Only if you can gate reliably.

#### `/config list`
#### `/config get <key>`
#### `/config set <key> <json>`
Strict JSON parsing. Reject invalid JSON.

---

### 11) Debug and maintenance (admin only; optional)
#### `/debug session export`
Exports session history summary (redacted) to artifacts.

#### `/debug toggle <flag>`
Only for dev builds.

---

## Error handling and UX
- On invalid usage, respond with:
  - short error
  - correct usage line
  - example
- Avoid multi-paragraph lectures.
- Do not leak internal stack traces in chat. Log them.

## Acceptance criteria
- Commands execute deterministically and use side-effect-free orchestrator confirmations for state-changing mutations.
- Command text is never appended to session history.
- `/status`, `/whoami`, and `/help` remain deterministic factual outputs.
- Operator/admin commands are denied for non-authorised users.
- Every command logs an audit event.
- Tests cover: parsing, gating, and side-effect-free orchestrated confirmations for state-changing commands.

## Agent checklist
- Check `AGENTS.md` first.
- Read the last 150 lines of `docs/IMPLEMENTATION_LOG.md` before starting.
- Write a log entry using the agreed template when done.
