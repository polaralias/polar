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

## Current method set
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

### Feedback
- `recordFeedbackEvent(request)`
- `listFeedbackEvents(request)`

### Telemetry (while it exists)
- `listHandoffRoutingTelemetry(request)`
- `listUsageTelemetry(request)`
- `listTelemetryAlerts(request)`
- `routeTelemetryAlerts(request)`

### Scheduler
- `listSchedulerEventQueue(request)`
- `runSchedulerQueueAction(request)`

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
- `listPendingSkillInstallProposals()`
- `reviewSkillInstallProposal(request)`
- `syncMcpServer(request)`
- `installPlugin(request)`
- `submitSkillMetadataOverride(request)`
- `listBlockedSkills()`
- `listCapabilityAuthorityStates()` (non-async)

Skill install review contract:
- `installSkill(request)` stages a skill manifest for human review. If `SKILL.md` already contains a manifest, the parsed manifest becomes the pending proposal. If the manifest is missing, the control plane generates a proposal from available MCP inventory first.
- `listPendingSkillInstallProposals()` returns the pending proposals that still require approval or rejection.
- `reviewSkillInstallProposal(request)` is the approval/rejection step that finalizes installation (and optional enablement) after the manifest has been reviewed.

### Memory
- `searchMemory(request)`
- `getMemory(request)`
- `upsertMemory(request)`
- `compactMemory(request)`

### Automations
- `createAutomationJob(request)`
- `listAutomationJobs(request)`
- `updateAutomationJob(request)`
- `disableAutomationJob(request)`
- `deleteAutomationJob(request)`

### Agent registry and pinning
- `getAgentRegistry(request?)`
- `listAgentProfiles()`
- `getAgentProfile(request)`
- `registerAgentProfile(request)`
- `unregisterAgentProfile(request)`
- `pinProfileForScope(request)`
- `unpinProfileForScope(request)`
- `getEffectivePinnedProfile(request)`

### Orchestration and UX callbacks (Telegram critical)
- `orchestrate(envelope)`
- `updateMessageChannelId(sessionId, internalId, channelId)`
- `executeWorkflow(workflowId | { workflowId, approved?, authorizationMode? })`
- `rejectWorkflow(workflowId | { workflowId })`
- `cancelWorkflow(workflowId | { workflowId })`
- `getWorkflowProposal(workflowId | { workflowId })`
- `consumeAutomationProposal(proposalId | { proposalId })`
- `rejectAutomationProposal(proposalId | { proposalId })`
- `handleRepairSelection({ sessionId, selection, correlationId })`

## Interactive proposal contract
Interactive chat surfaces must call `orchestrate` with `metadata.executionType = "interactive"` so the runtime can distinguish surface-driven chat from non-interactive callers.

Workflow responses:
- `workflow_proposed` with `proposalMode = "auto_start"` means the workflow may start immediately after the surface renders a reject/cancel affordance.
- `workflow_proposed` with `proposalMode = "dry_run_approval"` means the workflow must not execute live until the surface calls `executeWorkflow({ workflowId, approved: true })`.
- `approval_required` from `executeWorkflow(...)` means the caller attempted to run a dry-run-gated workflow without explicit approval.
- `cancelWorkflow(...)` is the code-bound stop path for in-flight runs. Runtime semantics are: stop future steps, best-effort interrupt the current step, and report `succeeded` / `failed` / `not attempted` counts.
- `getWorkflowProposal(...)` returns the stored proposal, including preview summary/payload for dry-run flows.

Automation responses:
- `automation_created` means the control plane has already created the job and the surface should render a reject/delete affordance in-thread.
- `automation_proposed` remains a fallback if auto-creation fails; surfaces may still explicitly consume/reject the proposal.

## Planned additions
Run ledger:
- `listAutomationRunLedger(request)`
- `listHeartbeatRunLedger(request)`

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
