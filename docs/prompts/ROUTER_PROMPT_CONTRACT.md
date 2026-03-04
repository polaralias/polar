# Router prompt contract

## Purpose
Produce a structured routing proposal for the current user turn.

## Required output shape
```json
{
  "decision": "respond|delegate|tool|workflow|clarify",
  "target": {
    "agentId": "@optional",
    "extensionId": "optional",
    "capabilityId": "optional",
    "args": {}
  },
  "confidence": 0.0,
  "rationale": "short reason",
  "references": {
    "refersTo": "focus_anchor|pending|latest|temporal_attention",
    "refersToReason": "short"
  },
  "scores": {
    "respond": 0.0,
    "delegate": 0.0,
    "tool": 0.0,
    "workflow": 0.0,
    "clarify": 0.0
  }
}
```

## Rules
- choose only from candidate modes provided by code
- never expand capability scope
- never assume unavailable tools/agents are executable
- if uncertain, choose `clarify`

## Deterministic enforcement
Code validates schema, clamps invalid target, applies risk/approval policy, and may override to `clarify`.
