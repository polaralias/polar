# Polar Assistant: Automation Hooks (Proactive Triggers)

Automation hooks are event sources that create tasks or notifications. They **never execute tools directly**. All actions still flow through normal capability enforcement.

## Goals
- Proactive assistant behaviour (notify, summarise, suggest)
- Safe by default (no automatic side effects)
- Easy setup through chat and UI

## Hook model
A hook is defined by:
- source (Gmail push, GitHub webhook, Calendar change, RSS, etc.)
- event schema
- routing rule (which user/session/project)
- policy (what can be done automatically vs requires confirmation)
- notification policy (when to notify vs batch)

Hooks create **Event Records** stored by the runtime.

## Event lifecycle
1. Event received and validated
2. Event stored (append-only) + audited
3. Event summarised (optional) into a notification
4. User approves or a policy permits a safe follow-up action
5. Any tool calls use normal template execution with minted capabilities

## Proactive notifications
Polar supports three levels:
- **Notify only**: “You received an important email”
- **Suggest action**: “Reply?”, “Schedule follow-up?”
- **Auto-act** (rare): only for low-risk operations under explicit policy, eg creating a reminder, adding a label, posting a reaction

## Setup through chat
Chat-driven configuration compiles into stored hook configs. The main agent must:
- propose a hook config (structured)
- show a plain-language summary
- request user approval
- runtime stores it and audits the change

Examples:
- “Notify me when an email from @client.com arrives”
- “Every weekday at 9am send a brief of today’s calendar”
- “If any email contains ‘invoice overdue’, flag it and notify me”

## Required safety rules
- Default is notify-only.
- Auto-act requires explicit allowlist and confirmation on first run.
- Hooks must have rate limits and batching.

## Hook sources (examples)
- Gmail: Pub/Sub push → webhook → event
- GitHub: webhook → event
- Calendar: push/periodic poll → event
- Files: directory watcher (local) → event

## Auditing
Audit includes:
- hook created/updated/deleted
- event received
- notification sent
- any follow-up actions and their approvals

## Testing requirements
- Hooks cannot trigger tool calls without runtime-minted capabilities.
- Misconfigured hooks fail closed.
- Batching prevents notification spam.
