# Automations and proactive updates

Automations are scheduled or conditional jobs that run without a user typing a new prompt at that moment.

## Principles
- Automations are **opt-in**: created by explicit user request.
- Once created, they can be **enabled by default** (no extra toggle) but must be easy to pause/delete.
- Automation runs are executed through the same orchestrator and middleware as normal chat.

## Two classes of proactive behaviour
### Time-based (MVP)
- reminders
- routines (progressive overload, rehab plans)
- weekly summaries

These are deterministic and low risk.

### Event-based (later)
- inbox checks for “important” emails
- alerts (calendar changes, system health)

These require connectors, strict scoping, and careful defaults.

## Job model (recommended)
Store jobs and runs separately.

### AutomationJob
- id, owner, channel delivery target
- schedule (cron or RRULE)
- prompt template (what to do when it runs)
- capability policy (allowed tools/connectors)
- limits (max runs/day, max notifications/day, quiet hours)
- sensitivity level (eg headers-only vs body reads)

### AutomationRun (append-only)
- job id, run time
- outcome (success/fail)
- tool calls used (audit summary)
- delivery status

## Chat configuration
The model should:
- detect “one-off” vs “recurring/notify me” intent
- when recurring: propose a job draft first (schedule + promptTemplate + defaults)
- require explicit user approval before job creation (no silent auto-create)
- avoid over-clarifying (eg “every morning” is fine)

Code must:
- validate schedules
- enforce limits
- block missing connector permissions
- audit proposal + approval/rejection as events

## Inbox-style checks (default behaviour)
Start conservative:
- hourly cadence by default
- headers only (sender/subject/date)
- notification cap (eg 3/day)
- quiet hours (eg 22:00–07:00)

If the user wants bodies summarised, make that a separate permission.

## Trust booster
Support a “dry run” after creating a job:
- run once immediately
- show what would have triggered a notification


## See also
- `docs/specs/AUTOMATION_RUNNER.md`
- `docs/specs/PROACTIVE_INBOX.md`
