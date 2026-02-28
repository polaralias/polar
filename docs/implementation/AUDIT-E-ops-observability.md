# AUDIT-E: Observability, Operations, and Reliability

Date: 2026-02-28  
Scope docs:
- `docs/architecture/runtime-topology.md`
- `docs/operations/quality-and-safety.md`
- `docs/operations/incident-response-and-drills.md`
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/implementation/implementation-log.md` (logging practice alignment)

## Summary
- Implemented: middleware audit envelopes with trace correlation, provider/handoff usage telemetry pipelines, scheduler retry/dead-letter controls, workflow/thread/run correlation in workflow-thread paths, deterministic execution header on successful workflow summaries.
- Partial: run correlation is present but fragmented; step-level records do not consistently include both `extensionId` and `capabilityId`.
- Missing/gap: no default durable audit sink, no explicit policy-decision audit events (allow/deny/require approval) with reasons, no standard timeout wrapper for tool execution and provider `generate/stream/embed`.

## 1) Correlation and audit trail

### What exists
- Middleware audit events include `traceId`, execution type, action/version, stage/checkpoint, risk/trust classes:
  - `packages/polar-runtime-core/src/middleware-pipeline.mjs:337-351`
- Middleware emits structured lifecycle checkpoints (`run.received`, `execution.completed`, `run.completed`, etc.):
  - `packages/polar-runtime-core/src/middleware-pipeline.mjs:380-649`
- Workflow ownership and failure correlation IDs are attached on thread state:
  - proposal stores owner thread: `packages/polar-runtime-core/src/orchestrator.mjs:427-433`
  - run ID generated and threaded through execution: `packages/polar-runtime-core/src/orchestrator.mjs:508`
  - `lastError` includes `runId/workflowId/threadId` + extension/capability on failures:
  - `packages/polar-runtime-core/src/orchestrator.mjs:566-567`, `638-639`, `660-661`, `714-715`
- System log message includes `[TOOL RESULTS] threadId=... runId=...` and per-step outcomes:
  - `packages/polar-runtime-core/src/orchestrator.mjs:676`

### Gaps
- Step records are not fully normalized to `{ extensionId, capabilityId }`:
  - current `toolResults.push` stores `tool` (capability id) and output/status only:
  - `packages/polar-runtime-core/src/orchestrator.mjs:629-631`
- Policy decisions are enforced but not emitted as first-class audit events with allow/deny/require-approval reason fields.
  - Denials are returned in execution payloads (`POLAR_EXTENSION_POLICY_DENIED`), not structured in middleware audit envelope:
  - `packages/polar-runtime-core/src/extension-gateway.mjs:539-545`
  - middleware audit envelope does not include output/policy fields:
  - `packages/polar-runtime-core/src/middleware-pipeline.mjs:341-354`
- Audit sink is optional and defaults to no-op unless explicitly configured:
  - `packages/polar-runtime-core/src/middleware-pipeline.mjs:274`
  - `packages/polar-control-plane/src/index.mjs:165`

## 2) Failure truthfulness (deterministic header)

### What exists
- Workflow summary prompt always includes deterministic execution header text and explicit instruction not to hide failures:
  - `packages/polar-runtime-core/src/orchestrator.mjs:675`, `685`
- User-facing completion text prepends deterministic header before narrative:
  - `packages/polar-runtime-core/src/orchestrator.mjs:700`
- Regression evidence: header-first behavior is asserted in orchestrator workflow ownership test:
  - `tests/runtime-core-orchestrator-thread-ownership.test.mjs`

### Gaps
- If post-execution summarization crashes, orchestrator returns crash error and does not return the deterministic header payload to the user in that response path:
  - `packages/polar-runtime-core/src/orchestrator.mjs:708-728`

## 3) Reliability controls

### Implemented
- Provider fallback, cooldown, and usage telemetry:
  - cooldown + fallback orchestration: `packages/polar-runtime-core/src/provider-gateway.mjs:322-548`
  - telemetry on success/failure attempts: `packages/polar-runtime-core/src/provider-gateway.mjs:461-548`
- Scheduler retry/dead-letter with backoff, queue actions, and durable stores:
  - `packages/polar-runtime-core/src/scheduler-gateway.mjs` (retry/disposition path, queue actions, diagnostics)
  - `packages/polar-runtime-core/src/scheduler-state-store-file.mjs`
  - `packages/polar-runtime-core/src/scheduler-state-store-sqlite.mjs`
- Orchestrator in-memory TTL controls:
  - pending workflow/thread/repair cleanup:
  - `packages/polar-runtime-core/src/orchestrator.mjs:28-49`
  - constants: `WORKFLOW_TTL_MS`, `THREAD_TTL_MS`, `REPAIR_TTL_MS`

### Missing / partial
- No explicit timeout wrapper for provider `generate/stream/embed` requests in native adapter (except `listModels` discovery path):
  - provider calls without abort timeout:
  - `packages/polar-adapter-native/src/index.mjs:314`, `363`, `491`
  - only `listModels` uses `AbortController` timeout:
  - `packages/polar-adapter-native/src/index.mjs:530-534`
- No standard timeout/retry wrapper for extension/tool execution (single `executeCapability` call path):
  - `packages/polar-runtime-core/src/extension-gateway.mjs:546-589`
- No central ingress rate-limiting/backoff for chat requests (only Telegram client-side debounce):
  - Telegram debounce only:
  - `packages/polar-bot-runner/src/index.mjs` (`DEBOUNCE_TIMEOUT_MS`)

## 4) Ops docs alignment

### Before audit
- `docs/operations/incident-response-and-drills.md` had incident playbooks and drills but lacked practical runbook detail for:
  - local run steps
  - current deployment reality
  - explicit secret rotation for UI/API secret and runtime configs
  - troubleshooting `Invalid extension.gateway.execute.request`

### Update made
- Added actionable runbook sections to `docs/operations/incident-response-and-drills.md`:
  - `5.1 Run Locally`
  - `5.2 Deploy (what exists today)`
  - `5.3 Secret Rotation`
  - `5.4 Troubleshoot Invalid extension.gateway.execute.request`

### Remaining doc drift
- `docs/architecture/runtime-topology.md` describes “audit store for immutable execution logs” as a boundary, but current runtime has optional/no-op audit sink by default and no built-in immutable storage backend in this repo.

## 5) Tests run (exact)
- `node --test tests/runtime-core-contract-middleware.test.mjs`
- `node --test tests/runtime-core-usage-telemetry-gateway.test.mjs`
- `node --test tests/runtime-core-handoff-routing-telemetry.test.mjs`
- `node --test tests/runtime-core-provider-gateway.test.mjs`
- `node --test tests/runtime-core-scheduler-gateway.test.mjs`
- `node --test tests/runtime-core-scheduler-state-store-file.test.mjs`
- `node --test tests/runtime-core-scheduler-state-store-sqlite.test.mjs`
- `node --test tests/runtime-core-telemetry-alert-gateway.test.mjs`
- `node --test tests/runtime-core-extension-gateway.test.mjs`
- `node --test tests/runtime-core-orchestrator-thread-ownership.test.mjs`

All executed suites passed in this audit run.

## 6) Recommendations
1. Add a durable default audit sink (SQLite/table or append-only event store) and make sink configuration mandatory outside development.
2. Emit explicit policy-decision audit events (`allow|deny|require_approval`) including structured reason codes.
3. Normalize workflow step logs to include both `extensionId` and `capabilityId` for every step event.
4. Add timeout/cancellation wrappers for provider `generate/stream/embed` and extension tool execution.
5. Add server-side ingress rate limiting/backoff controls (not only channel-level debounce).
