# Admin gating and single-user bootstrap

## Why this exists
Polar needs deterministic admin/operator gating for:
- chat commands that change configuration (models, agent registry/pinning, provider config)
- artefact exports
- other privileged operations

In a single-user deployment, requiring explicit admin allowlists is annoying. In a multi-user/group scenario, being lax is dangerous. This spec introduces a **fail-closed** gating model with an optional **single-user bootstrap** that is safe by default.

---

## Definitions
- **Public command/action**: safe for any user (help, status, whoami, read-only lists scoped to self).
- **Operator command/action**: read-only across users/sessions, and/or limited admin changes (depending on your policy).
- **Admin command/action**: changes global routing/models/agents, installs skills, modifies policies, triggers exports, or anything that can affect other users.

- **Telegram userId**: numeric Telegram user ID of the sender.
- **Chat type**: Telegram `chat.type` (private, group, supergroup, channel).
- **Bootstrap admin**: the first Telegram user that is recorded as admin in a *private* chat when no explicit allowlist exists.

---

## Environment flags
### 1) Single-user bootstrap toggle
- `POLAR_SINGLE_USER_ADMIN_BOOTSTRAP=1` enables bootstrap mode.
- Default: **enabled** if unset.

Rationale: single-user deployments “just work” out of the box.

### 2) Explicit allowlists (override bootstrap)
- `POLAR_ADMIN_TELEGRAM_IDS` (comma-separated user IDs)
- `POLAR_OPERATOR_TELEGRAM_IDS` (comma-separated user IDs)

If either is set:
- Bootstrap is **disabled** (even if the bootstrap env flag is enabled).
- Decisions use these allowlists only.

### 3) Optional hard disable
- `POLAR_DISABLE_CHAT_ADMIN=1` (optional)
If enabled, admin/operator chat commands are denied regardless of bootstrap/allowlists.

---

## Storage (persisted admin)
Bootstrap must persist to a control-plane record so it survives restart.

Recommended:
- resourceType: `policy`
- resourceId: `telegram_command_access`
- payload:
  - `adminTelegramUserIds: string[]`
  - `operatorTelegramUserIds: string[]` (optional)
  - `createdAtMs`, `updatedAtMs` (optional)

Rules:
- Persist only the numeric IDs, not names/usernames.
- Do not export these IDs into artefacts.
- Any UI that shows this should be operator/admin only.

---

## Decision flow (MUST be fail-closed)
Given `(telegramUserId, chatType)` and a required access level:

### Step 0: deny if globally disabled
If `POLAR_DISABLE_CHAT_ADMIN=1`:
- deny operator and admin commands

### Step 1: explicit allowlists take precedence
If `POLAR_ADMIN_TELEGRAM_IDS` or `POLAR_OPERATOR_TELEGRAM_IDS` is set:
- `isAdmin = telegramUserId in POLAR_ADMIN_TELEGRAM_IDS`
- `isOperator = isAdmin OR telegramUserId in POLAR_OPERATOR_TELEGRAM_IDS`
- deny if not allowed

### Step 2: bootstrap mode (private chat only)
If bootstrap enabled and no explicit allowlists:
- If `chatType != "private"`:
  - deny operator/admin (fail closed)
- If `chatType == "private"`:
  - Load persisted `telegram_command_access` policy.
  - If no admin ids stored yet:
    - Set `adminTelegramUserIds = [telegramUserId]` and persist.
    - Treat this user as admin/operator.
  - Else:
    - `isAdmin = telegramUserId in adminTelegramUserIds`
    - `isOperator = isAdmin OR telegramUserId in operatorTelegramUserIds`

### Step 3: default deny
If none of the above conditions grant access:
- deny operator/admin

---

## Command mapping guidance
### Public
- `/help`, `/commands`, `/about`
- `/status`, `/whoami`, `/ping`
- `/personality` (read), `/personality set` (user/session scope only)

### Operator
- listing across users/sessions (if you support it)
- read-only telemetry, read-only model lists, read-only job lists
- should still be denied in group chats unless explicit allowlist exists

### Admin
- `/models register`, `/models set-default`, `/models unregister`
- `/agents register`, `/agents pin`, `/agents delete`
- `/skills install`, policy edits
- `/artifacts export`
- any command that writes to shared config/policy records

---

## Auditing
Every command execution must log:
- command name
- required level (public/operator/admin)
- userId, sessionId, threadKey
- outcome (success/failure/denied)

Do not log free-text arguments for commands that may contain sensitive content. Log only length and an optional hash.

---

## Tests (minimum)
- With no env allowlists, bootstrap enabled:
  - first user in **private** chat becomes admin
  - same user allowed on subsequent commands
  - other users denied
- In group chat with no allowlists:
  - operator/admin denied
- With explicit allowlists:
  - bootstrap does not run
  - allowlist enforced
- Fail closed:
  - missing policy record and no allowlists in non-private chat denies

---

## Implementation checklist
- Implement gating in one place (shared by command router and any future web chat).
- Ensure “admin bootstrap” persistence uses control-plane APIs (not raw sqlite).
- Ensure no artefact export includes admin IDs.
