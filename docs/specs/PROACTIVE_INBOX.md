# Proactive inbox checks (gated MVP scaffolding)

## Purpose
Inbox-style “check in for important emails” can be extremely useful, but it is privacy sensitive and must be opt-in, rate-limited, and conservative by default.

This spec defines the safe MVP approach for inbox checks.

## Scope
- Header-only scanning by default
- No body reading unless explicitly permitted
- Throttled notifications
- Clear audit trail

## Capability model
Define two capabilities (exact naming up to your tool registry):
- `mail.search_headers` (safe)
- `mail.read_body` (sensitive)

Rules:
- Jobs default to header-only mode.
- Any attempt to read bodies must require explicit permission, either:
  - per job (stored), or
  - per run (approval prompt)

## Defaults
- cadence: hourly (not every 5 minutes)
- lookback: last 24h
- max notifications per day: 3
- quiet hours: 22:00–07:00
- timezone default: `UTC` (until per-user local timezone is available)

## Dry run
After job creation:
- run once immediately
- report what would have triggered without sending push notifications repeatedly
- dry run must execute in headers-only mode

## Data stored
In feedback and run ledgers, store:
- sender domain and subject line (if allowed)
- message id reference
Do not store full email bodies by default.

## Acceptance criteria
- A job can be created in header-only mode.
- Body reads without permission are blocked and audited.
- Notifications are throttled.

## Agent checklist
- Check `AGENTS.md` first.
- When done, write to `docs/IMPLEMENTATION_LOG.md`.
