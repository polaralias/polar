# Workflow planner prompt contract

## Purpose
Produce a dynamic, executable workflow proposal from user intent.

## Required output shape
```json
{
  "goal": "string",
  "confidence": 0.0,
  "riskHints": {
    "mayWrite": false,
    "mayRequireApproval": false,
    "mayBeDestructive": false
  },
  "steps": [
    {
      "id": "step-1",
      "reason": "why this step",
      "extensionId": "string",
      "capabilityId": "string",
      "args": {},
      "dependsOnStep": "optional-step-id"
    }
  ]
}
```

## Rules
- only propose capabilities likely relevant to the user goal
- include all required args for each step where possible
- keep steps minimal and ordered
- if required details are missing, return a short clarification request step instead of guessing

## Deterministic enforcement
Code validates each step against installed capabilities, scope, policy, and approvals.
Invalid steps are clamped/rejected before execution.
