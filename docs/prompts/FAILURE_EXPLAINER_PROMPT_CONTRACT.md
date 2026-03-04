# Failure explainer prompt contract

## Purpose
Transform normalized tool/workflow/sub-agent failure envelopes into user-facing responses.

## Input assumptions
Code provides typed envelope fields (category, retryEligible, clearPending, normalizedErrorMessage, safe metadata).

## Required output shape
```json
{
  "summary": "short user-facing explanation",
  "suggestedNextStep": "optional",
  "canRetry": false,
  "detailLevel": "safe|detailed",
  "detailedDiagnostic": "optional"
}
```

## Rules
- default to safe summary (no stack traces)
- if user explicitly asks for exact error, include controlled normalized diagnostic text
- never fabricate missing internal details

## Deterministic enforcement
Code controls which diagnostic fields are passed and can redact/trim any model output.
