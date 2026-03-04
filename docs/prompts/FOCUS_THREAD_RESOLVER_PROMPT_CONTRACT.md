# Focus/thread resolver prompt contract

## Purpose
Rank likely focus anchors for ambiguous follow-up messages.

## Required output shape
```json
{
  "confidence": 0.0,
  "refersTo": "focus_anchor|pending|latest|temporal_attention|unclear",
  "candidates": [
    {
      "anchorId": "string",
      "threadKey": "string",
      "score": 0.0,
      "reason": "short"
    }
  ],
  "needsClarification": false,
  "clarificationQuestion": "optional"
}
```

## Rules
- rank only candidates provided by code
- do not invent thread keys or anchors
- set `needsClarification=true` when candidates are too close

## Deterministic enforcement
Code enforces lane boundaries, pending-state type/TTL, and final ambiguity policy.
