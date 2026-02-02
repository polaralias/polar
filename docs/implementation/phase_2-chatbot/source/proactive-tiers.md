# Polar Assistant: Proactive Action Tiers

## Tier 0: Informational
No side effects, fully automatic.
Examples:
- “New email from Alex”
- “Meeting in 10 minutes”

## Tier 1: Intent Completion
User provides intent, Polar completes execution.
No confirmation required.
Examples:
- “raincheck this week”
- “tell her I’ll check my calendar”

## Tier 2: Delegated Actions
Polar proposes, user gives lightweight approval.
Approval via:
- short replies
- reactions
- timeout

## Tier 3: Autonomous Actions
Explicit opt-in automation envelopes.
Narrow scope, revocable, audited.

## Enforcement
- Tiers enforced by runtime
- Workers cannot escalate tiers
- UI shows active tier

## Injection mitigation
External input cannot trigger Tier 1+ alone.
User intent is always required.
