# Automation planner prompt contract

## Purpose
Convert user intent into an automation proposal with confidence and risk hints.

## Required output shape
```json
{
  "decision": "propose|clarify|skip",
  "confidence": 0.0,
  "summary": "string",
  "schedule": {
    "kind": "interval|daily|weekly|event",
    "expression": "string"
  },
  "runScope": {
    "sessionId": "string",
    "userId": "string"
  },
  "limits": {
    "maxNotificationsPerDay": 3,
    "quietHours": { "startHour": 22, "endHour": 7, "timezone": "UTC" }
  },
  "riskHints": {
    "mayWrite": false,
    "requiresApproval": false
  },
  "clarificationQuestion": "optional"
}
```

## Rules
- if confidence is low, return `clarify` with a concise confirmation question
- prefer conservative limits by default
- do not propose capability expansion outside known scope

## Deterministic enforcement
Code normalizes schedule, validates scope/policy/approvals, and blocks unsafe proposals.
