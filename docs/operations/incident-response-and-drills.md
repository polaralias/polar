# Incident Response And Drills

Last updated: 2026-02-28

This document outlines the procedures for responding to Polar runtime incidents and performing regular "Incident Drills" to validate system resilience and operator readiness.

## 1. Classification Of Incidents

| Severity | Description | Action |
| --- | --- | --- |
| **S1 (Critical)** | Core orchestration loop broken; data corruption; unauthorized privilege expansion. | Immediate stop; emergency rollback; data integrity audit. |
| **S2 (High)** | All external channels (Telegram/Slack) down; extension execution failing globally. | Scale ingress/execution layers; check provider health; verify config DB. |
| **S3 (Medium)** | Degraded performance; isolated tool failures; budget alerts. | Review usage telemetry; check model lanes; tune timeouts. |
| **S4 (Low)** | UI cosmetic issues; non-critical automation delays. | Triage into task board for scheduled fix. |

## 2. Standard Operating Procedures (SOPs)

### 2.1. Provider Failover
1. Check `usage telemetry` in the Web UI to identify which provider/model is failing.
2. If automatic fallback didn't kick in, manually update the `Agent Profile` pins via the UI Dashboard.
3. Switch from `brain` to `worker` or a different `fallbackProviderIds` list.

### 2.2. Vault Recovery
1. If the `POLAR_VAULT_KEY` is lost, ALL existing secrets in the config DB (API keys, tokens) are unrecoverable.
2. Procedure:
   - Generate a new `POLAR_VAULT_KEY`.
   - Re-upsert all provider and extension configurations via `polar config set` or the Web UI.
   - Decrypted values will fail validation, so values must be entered fresh.

### 2.3. Extension Kill-Switch
1. If a skill or MCP server behaves maliciously or is looping:
   - Go to `Extension Management` in the Web UI.
   - Disable or Revoke Trust for the specific extension ID.
   - This prevents the gateway from loading or executing that specific adapter.

## 3. Incident Drills (Canary Drills)

To maintain a high "Production Strictness Posture," operators should perform the following drills quarterly:

### Drill A: "Total Provider Blackout"
- **Simulate:** Cut off API access to primary LLM providers (Anthropic/Gemini).
- **Validation:** 
  - System must automatically fallback to local model lane (Ollama/LocalAI).
  - Telemetry alerts must trigger stating high fallback rate.
  - Core automations must continue with reduced reasoning quality but zero silent failures.

### Drill B: "State Store Corruption"
- **Simulate:** Swap the SQLite file for an older version.
- **Validation:** 
  - Scheduler must detect mismatched event hashes and move conflicted runs to the `Dead Letter` queue.
  - Task board must show consistent "Conflicted" or "Stale" status transitions instead of crashing.

### Drill C: "Multi-Agent Loop Panic"
- **Simulate:** Configure a sub-agent with a capability that recursively calls the parent with no exit criteria.
- **Validation:** 
  - Budget/Turn-limit middleware must intercept and truncate the loop.
  - Audit trail must clearly identify the recursion heat-map.

## 4. Continuity Checklist
- [ ] `POLAR_VAULT_KEY` is backed up outside the runtime environment.
- [ ] Regular SQLite snapshots are taking place.
- [ ] Audit logs are offloaded to an immutable sink.
- [ ] SLO alerts are configured for at least:
  - 95% Handoff success rate.
  - < 2% Unexpected model lane escalation.
  - < 1% Audit sink ingestion failure.

## 5. Operational Runbooks (Current Deployment Reality)

### 5.1 Run Locally (single-node reality)
1. Install dependencies:
   - `npm install`
2. Create `.env` in repo root with at least:
   - `OPENAI_API_KEY=...` (or other provider key used by your profile)
   - `TELEGRAM_BOT_TOKEN=...` (if using Telegram runner)
   - optional: `POLAR_UI_API_SECRET=...` for dashboard API auth hardening
3. Start runtime:
   - `npm run dev`
4. Verify surfaces:
   - Web UI: `http://localhost:5173`
   - Telegram runner process starts without token errors
5. Confirm persistence path:
   - SQLite DB is `polar-system.db` at repository root

### 5.2 Deploy (what exists today)
1. Supported operational mode today is effectively single-node or manually split services using the same Node runtime packages.
2. There is no first-class production deployment manifest in this repo (no canonical k8s/helm/terraform baseline).
3. Minimum production hardening baseline:
   - pin Node runtime version
   - set explicit environment secrets (no defaults)
   - persist and back up `polar-system.db`
   - run behind a process supervisor (systemd/pm2/container runtime)
   - configure immutable sink for middleware audit/telemetry exports

### 5.3 Secret Rotation
1. Provider/API keys:
   - rotate upstream provider secrets
   - update Polar provider config (UI or config API) and verify `listModels`/`generateOutput` health
2. `POLAR_UI_API_SECRET`:
   - rotate env var and restart web process
   - verify unauthorized API requests return `401`
3. `POLAR_VAULT_KEY`:
   - if rotated/lost, existing encrypted values are not recoverable
   - regenerate key, re-enter all encrypted provider/extension secrets, and validate each connection

### 5.4 Troubleshoot `Invalid extension.gateway.execute.request`
1. Confirm required request fields match runtime schema:
   - `extensionId`, `extensionType`, `capabilityId`, `sessionId`, `userId`, `capabilityScope`, `input`
2. Confirm `capabilityScope` is non-empty and shaped as:
   - `{ "allowed": { "<extensionId>": ["<capabilityId>"] } }`
3. Re-run with minimal known-good payload through control-plane `executeExtension`.
4. If still failing, inspect:
   - middleware contract validation errors (`POLAR_CONTRACT_VALIDATION_ERROR`)
   - extension policy denials (`POLAR_EXTENSION_POLICY_DENIED`)
   - extension state (`listExtensionStates`) for lifecycle/trust mismatches
5. Capture trace and audit evidence:
   - include `traceId` in request
   - pull middleware audit events and extension execution response payload for incident ticket
