# Control-plane API contract for surfaces

## Purpose
Surfaces (Telegram runner, Web UI, CLI) must only call a stable, explicitly allowed set of control-plane methods. This prevents surfaces turning into a privileged backdoor and keeps security boundaries enforceable.

This document defines:
- the methods surfaces can call
- how they are intended to be used
- where allowlists must be enforced

## Canonical creation
Control plane is created by:
- `packages/polar-control-plane/src/index.mjs` → `createControlPlaneService(config)`

Surfaces must obtain it via:
- `@polar/platform` (`docs/specs/BOOTSTRAP.md`)

## Surface rules
- Telegram runner: call `orchestrate` for chat turns. Do not call `generateOutput` directly.
- Web UI: only exposes allowlisted methods via Vite plugin. Anything not allowlisted is inaccessible.

## Current method set (existing)
### Health and config
- `health()`
- `getConfig(request)`
- `listConfigs(request)`
- `upsertConfig(request)`

### Budget
- `checkInitialBudget(request)`
- `getBudgetPolicy(request)`
- `upsertBudgetPolicy(request)`

### Sessions and messages
- `appendMessage(request)`
- `getSessionHistory(request)`
- `listSessions(request)`
- `searchMessages(request)`
- `applySessionRetentionPolicy(request)`

### Tasks
- `upsertTask(request)`
- `transitionTask(request)`
- `listTasks(request)`
- `listTaskEvents(request)`
- `replayTaskRunLinks(request)`

### Telemetry (while it exists)
- `listHandoffRoutingTelemetry(request)`
- `listUsageTelemetry(request)`
- `listTelemetryAlerts(request)`
- `routeTelemetryAlerts(request)`

### Scheduler
- `listSchedulerEventQueue(request)`
- `runSchedulerQueueAction(request)`

### Run ledger
- `listAutomationRunLedger(request)`
- `listHeartbeatRunLedger(request)`

### Provider operations (operator-only)
- `generateOutput(request)`
- `streamOutput(request)`
- `embedText(request)`
- `listModels(request)`
- `getModelRegistry(request?)`
- `upsertModelRegistry(request)`
- `setModelRegistryDefault(request)`

### Extensions and skills
- `executeExtension(request)`
- `applyExtensionLifecycle(request)`
- `listExtensionStates(request)`
- `installSkill(request)`
- `reviewSkillInstallProposal(request)`
- `syncMcpServer(request)`
- `installPlugin(request)`
- `submitSkillMetadataOverride(request)`
- `listBlockedSkills()`
- `listCapabilityAuthorityStates()` (non-async)

### Memory
- `searchMemory(request)`
- `getMemory(request)`
- `upsertMemory(request)`
- `compactMemory(request)`

### Feedback events
- `recordFeedbackEvent(request)`
- `listFeedbackEvents(request)`

### Orchestration and UX callbacks (Telegram critical)
- `orchestrate(envelope)`
- `updateMessageChannelId(sessionId, internalId, channelId)`
- `executeWorkflow(workflowId | { workflowId })`
- `rejectWorkflow(workflowId | { workflowId })`
- `consumeAutomationProposal(proposalId | { proposalId })`
- `rejectAutomationProposal(proposalId | { proposalId })`
- `handleRepairSelection({ sessionId, selection, correlationId })`

## Automations
- `createAutomationJob(request)`
- `listAutomationJobs(request)`
- `updateAutomationJob(request)`
- `disableAutomationJob(request)` (or `deleteAutomationJob(request)`)

## Proactive inbox scaffolding
- `proactiveInboxCheckHeaders(request)`
- `proactiveInboxReadBody(request)`
- `proactiveInboxDryRun(request)`

## Personalisation

- `getPersonalityProfile`
- `getEffectivePersonality`
- `upsertPersonalityProfile`
- `resetPersonalityProfile`
- `listPersonalityProfiles`

## Allowlist enforcement points
### Web UI
`packages/polar-web-ui/vite.config.js` must:
- enforce `ALLOWED_ACTIONS`
- refuse anything not in the set
- optionally require `POLAR_UI_API_SECRET` for authorisation

### Any future HTTP gateway
If you expose control plane via a server, the same allowlist approach applies:
- method allowlist
- capability gating
- audit logging

## Acceptance criteria
- Surfaces call only methods in this doc.
- Web UI allowlist matches this doc.
- Tests pass: `npm test`

## Agent checklist
- Check `AGENTS.md` first.
- When done, write to `docs/IMPLEMENTATION_LOG.md`.
