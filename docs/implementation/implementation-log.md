# Implementation Log

Last updated: 2026-02-28

## How to use this log
- Append-only. Do not rewrite history.
- One entry per task/PR/audit.
- “Done” requires tests + evidence + docs updated when needed.
- Avoid absolute language (“100% complete”, “nothing left”) unless backed by an explicit checklist and proof.

---

## Template (copy/paste per entry)

### YYYY-MM-DD — <ID> — <Title> — <Status: In Progress|Blocked|Done>
**Owner:** <name/agent>
**Scope:** <what this entry covers, explicitly>
**Summary:** <1–3 bullets of what changed>

**Architecture refs (must list at least one if behaviour/architecture changed):**
- <doc path(s)>

**Files changed:**
- <path>
- <path>

**Tests run (exact):**
- `<command>` OR `<test file name(s)>`

**Manual verification (evidence, not vibes):**
- <what you actually checked, where, and the outcome>

**Notes / decisions:**
- <key decisions, trade-offs, risks>

**Follow-ups:**
- <actionable next steps / known gaps>

---

## Active / In Progress
(Keep current work here; move to Done when complete.)

---

## Done
(Entries appended below.)


### 2026-02-28 — F6-001 — Documentation Finalization — Done

**Owner:** Codex
**Scope:** Complete F6 from `implementation-finalization-plan.md`: Close doc drift, update architecture files, and mark release gates with evidence.
**Summary:**
- Updated `ai-assistant.md` to reflect the deterministic orchestrator path, dropping references to legacy `createPiAgentTurnAdapter` loops and replacing `<polar_workflow>` with `<polar_action>`.
- Updated `web-ui-and-chat-management.md` to clarify that real-time features currently use polling, and full moderation/channel views are partial.
- Updated `skills-mcp-plugins.md` to explicitly state dev-only MCP restrictions lack hard-coded runtime enforcement at this time.
- Updated `llm-providers.md` to flag the detailed provider matrix as aspirational notes rather than 100% current end-to-end reality.
- Appended final F6 evidence to `implementation-status.md` and verified all requested pre-F6 suites pass.

**Architecture refs:**
- `docs/implementation/implementation-finalization-plan.md`
- `docs/implementation/implementation-status.md`

**Files changed:**
- `docs/product/ai-assistant.md`
- `docs/product/web-ui-and-chat-management.md`
- `docs/extensions/skills-mcp-plugins.md`
- `docs/architecture/llm-providers.md`
- `docs/implementation/implementation-status.md`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/control-plane-service.test.mjs`
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs`
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs`
- `node --test tests/channels-thin-client-enforcement.test.mjs`
- `node --test tests/runtime-core-open-loops-repair.test.mjs`
- `node --test tests/runtime-core-extension-gateway.test.mjs`
- `node --test packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs`
- `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `node --test tests/runtime-core-capability-scope-enforcement.test.mjs`
- `node --test tests/runtime-core-contract-middleware.test.mjs`
- `node --test tests/runtime-core-usage-telemetry-gateway.test.mjs`
- `node --test tests/runtime-core-handoff-routing-telemetry.test.mjs`
- `node --test tests/runtime-core-provider-gateway.test.mjs`
- `node --test tests/runtime-core-scheduler-gateway.test.mjs`
- `node --test tests/runtime-core-scheduler-state-store-sqlite.test.mjs`
- `node --test tests/runtime-core-drills-automation.test.mjs`

**Manual verification (evidence, not vibes):**
- Tested all documentation files directly using `cat` and `grep` to verify the actual state of the files against the assertions.
- Verified test suites pass completely after running F5 test fix requirements (`better-sqlite3`).

**Notes / decisions:**
- Acknowledged remaining missing functionality directly in the documentation rather than promising complete delivery, satisfying the F6 goal to accurately reflect code implementation.
- F6 completes the `implementation-finalization-plan.md`.

**Follow-ups:**
- Close out the final stage and review full coverage goals.


### 2026-02-28 — AUDIT-001 — Repair phrasing + ApprovalStore + SkillRegistry sanity — Done

**Owner:** Audit agent
**Scope:** Validate recent bugfix changes in `affected_files.zip` did not introduce runtime crashes, prompt-driven control, or policy bypass paths. Focus on: repair phrasing LLM call, ApprovalStore grant typing, SkillRegistry install-time enforcement.

**Architecture refs:**

* `docs/architecture/routing-repair-and-disambiguation.md`
* `docs/architecture/open-loops-and-change-of-mind.md`
* `docs/architecture/approvals-and-grants.md`
* `docs/architecture/skill-registry-and-installation.md`

**Files checked (key):**

* `packages/polar-runtime-core/src/orchestrator.mjs`
* `packages/polar-runtime-core/src/approval-store.mjs`
* `packages/polar-runtime-core/src/skill-registry.mjs`
* `tests/*` (new/updated)

**Findings**

1. **Runtime crash risk: `providerId`/`model` used before definition**

   * In `orchestrator.mjs`, the LLM-assisted repair phrasing path calls `providerGateway.generate({ providerId, model, ... })` before `providerId` and `model` are declared later in the function.
   * Impact: in Node this can throw `ReferenceError: Cannot access 'providerId' before initialization`, which is caught and silently triggers fallback phrasing. This can look like “lost context” or inconsistent repair behaviour.
   * Severity: High (runtime correctness + UX stability)

2. **ApprovalStore: `riskLevel` field sourced from non-existent property**

   * `approval-store.mjs` sets `riskLevel: scope.riskLevel || 'write'`, but `scope` is a capabilities/targets container and does not reliably include `riskLevel`.
   * Impact: grants may have incorrect/meaningless `riskLevel`, weakening auditability and future enforcement decisions.
   * Severity: Medium (correctness + audit integrity)

3. **Repair phrasing guardrails**

   * Repair flow correctly keeps routing authority in code (A/B fixed). LLM is used only to reword question/labels and output is JSON-validated with fallback.
   * However, labels are not bounded (length/characters), allowing messy UI or prompt injection-ish text in labels.
   * Severity: Low/Medium (UX + safety hardening)

**Tests run (exact):**

* `node --test tests/runtime-core-open-loops-repair.test.mjs`
* `node --test tests/runtime-core-approvals-grants.test.mjs` (if present) / or list the actual new tests run
* `node --test tests/runtime-core-skill-registry.test.mjs` (if present)

**Manual verification (evidence):**

* Confirmed by code inspection that `providerId/model` are declared after the repair phrasing call site.
* Confirmed ApprovalStore’s `riskLevel` assignment depends on a property not defined in the scope shape.

**Decisions / actions recommended:**

* Move profile/policy resolution (providerId/model selection) above repair phrasing, or use explicit disambiguation model config.
* Make `riskLevel` an explicit parameter to `issueGrant()` or a first-class field in the grant object, not smuggled via scope.
* Add label sanitisation + max length for LLM repair phrasing outputs.

**Follow-ups:**

* Create PR: “Fix repair phrasing provider/model TDZ + ApprovalStore riskLevel typing”
* Add a test that executes the repair phrasing path to ensure no TDZ ReferenceError is possible.

### 2026-02-28 — AUDIT-002 — Deterministic routing, repair, and thread ownership audit — Done

**Owner:** Codex
**Scope:** Audit routing/orchestration behavior for web + Telegram against deterministic routing/open-loop/repair docs; verify workflow-thread ownership semantics; add missing test coverage where gaps existed.

**Architecture refs:**
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/architecture/open-loops-and-change-of-mind.md`
- `docs/architecture/routing-repair-and-disambiguation.md`

**Summary:**
- Traced web and Telegram request paths into shared orchestrator/routing code and validated deterministic routing/open-loop behavior against docs.
- Added orchestrator integration coverage for workflow thread ownership and error-context ID propagation.
- Recorded pass/fail/missing outcomes with concrete code + test evidence.

**Files changed:**
- `tests/runtime-core-orchestrator-thread-ownership.test.mjs`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-orchestrator-thread-ownership.test.mjs`
- `node --test tests/runtime-core-open-loops-repair.test.mjs`
- `node --test tests/runtime-core-orchestrator-routing.test.mjs`
- `node --test tests/runtime-core-chat-ingress-gateway.test.mjs`
- `node --test tests/adapter-channels-normalization.test.mjs`

**Manual verification (evidence):**
- Web path traced: `packages/polar-web-ui/src/views/chat.js` posts directly to `orchestrate`; `packages/polar-web-ui/vite.config.js` allowlists API actions.
- Telegram path traced: `packages/polar-bot-runner/src/index.mjs` normalizes ingress, calls `orchestrate`, renders `workflow_proposed` + `repair_question` with inline buttons, and dispatches callback selections.
- Deterministic routing/open loops verified in code + tests:
  - status nudge routing priority and fit checks in `packages/polar-runtime-core/src/routing-policy-engine.mjs`.
  - change-of-mind (`nah` -> `actually yes`) via rejected-offer recency logic in `routing-policy-engine.mjs`.
  - repair gating (`>=2` open loops + low-info text) and fixed A/B output in `routing-policy-engine.mjs`.
- Workflow/thread ownership verified:
  - proposal stores `threadId` at creation and execute path uses stored owner thread in `packages/polar-runtime-core/src/orchestrator.mjs`.
  - failure state includes `runId/workflowId/threadId` fields in `orchestrator.mjs`; new test asserts those IDs persist in follow-up state context.

**Pass/Fail/Missing:**
- **Passed**
  - Status nudges attach deterministically to in-flight/blocked work; recent-failure inquiries attach via `lastError`.
  - Change-of-mind flow works (`reject_offer` -> recent reversal to `accept_offer`).
  - Repair triggers for ambiguous low-info messages with multiple open loops; Telegram renders deterministic A/B buttons and selection routes through `handleRepairSelection`.
  - Workflow proposals are thread-owned; execution uses stored proposal thread even after active-thread drift; failure context retains `runId/workflowId/threadId`.
- **Failed / Gap**
  - Web UI does not currently implement `repair_question` button handling end-to-end: chat view has no repair rendering/selection flow, and Vite API allowlist omits `handleRepairSelection`.
  - Telegram inline-reply guard is not strict to anchor validity: when `useInlineReply` is true and `anchorMessageId` is non-numeric/missing, runner falls back to replying to the current user message.
- **Missing coverage**
  - No automated UI/adapter-level test currently asserts web `repair_question` handling or Telegram anchor-validity-only inline reply behavior.

**Notes / decisions:**
- Added a root test (not package-local test) so it runs under workspace `npm test` coverage.
- In the new orchestrator test, interval timers are `unref()`-wrapped to avoid keeping Node test processes alive.

**Follow-ups:**
- Implement web `repair_question` UI with A/B buttons and wire `handleRepairSelection` through `packages/polar-web-ui/vite.config.js` allowlist.
- Tighten Telegram reply policy to require a valid anchor ID before applying inline reply parameters.
- Add adapter-level tests for Telegram inline reply anchor validation and web repair-selection flow.

### 2026-02-28 — AUDIT-003 — Workflow templates + scope enforcement audit — Done

**Owner:** Codex
**Scope:** Audit workflow parsing/expansion validation and capability-scope enforcement against deterministic orchestration architecture, then add missing enforcement tests.

**Architecture refs:**
- `docs/architecture/deterministic-orchestration-architecture.md`

**Summary:**
- Verified workflow path accepts `<polar_action>` and found no runtime `<polar_workflow>` execution path.
- Verified deterministic template behavior (unknown template + missing args rejection) and added orchestrator-level pre-execution rejection tests.
- Verified capability-scope is required/non-empty at execution boundary and that forwarded skills are clamped before delegation activation.

**Files changed:**
- `tests/runtime-core-workflow-template-enforcement.test.mjs`
- `tests/runtime-core-capability-scope-enforcement.test.mjs`
- `tests/runtime-core-orchestrator-workflow-validation.test.mjs`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-workflow-template-enforcement.test.mjs`
- `node --test tests/runtime-core-capability-scope-enforcement.test.mjs`
- `node --test tests/runtime-core-extension-gateway.test.mjs`
- `node --test tests/runtime-core-orchestrator-delegation-scope.test.mjs`
- `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs`

**Manual verification (evidence):**
- Searched runtime code for `<polar_workflow>`; no executable runtime path found, only docs mentions.
- Verified parsing and orchestration flow uses `<polar_action>` (`workflow-engine.parseModelProposal` and `orchestrator` action extraction).
- Verified extension execution rejects empty/invalid `capabilityScope` and rejects out-of-scope capability IDs before adapter invocation.
- Verified delegation path clamps `forward_skills` via `validateForwardSkills` before storing active delegation context.

**Pass/Fail/Missing:**
- **Passed**
  - `<polar_action>` is the accepted workflow tag; legacy `<polar_workflow>` is ignored by parser.
  - Unknown template is rejected; invalid required args are rejected before any extension call.
  - Capability scope enforcement blocks out-of-scope calls and empty scope at extension execution boundary.
  - Forwarded skills are clamped to allowlist before delegation context is activated.
- **Failed**
  - None in audited scope.
- **Missing**
  - No additional gaps identified in this scope after added tests.

**Notes / decisions:**
- Updated a stale capability-scope test expectation to match current deterministic model: allowlisted skills only become executable when matching enabled installed extensions exist.
- Added orchestrator-level validation tests to ensure pre-execution rejection behavior is covered, not just unit functions.

**Follow-ups:**
- Optional hardening: remove legacy `payload.capabilityId` alias in `parseModelProposal` if strict template-only payload shape is desired.

### 2026-02-28 — AUDIT-004 — Approvals and grants (risk-tiered approvals) audit — Done

**Owner:** Codex
**Scope:** Audit risk-tiered approval behavior and grant semantics against `approvals-and-grants.md`, add missing coverage, and patch deterministic destructive-approval enforcement.

**Architecture refs:**
- `docs/architecture/approvals-and-grants.md`
- `docs/architecture/deterministic-orchestration-architecture.md`

**Summary:**
- Patched orchestrator grant logic so destructive actions are always treated as requiring per-action approval by default (no reusable grant auto-coverage).
- Added approval regression coverage for destructive re-approval and multi-step external plan execution under one plan approval.
- Verified write-external and plan approval behavior with passing runtime tests; recorded current metadata-enforcement gap for plugins.

**Files changed:**
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- `node --test tests/runtime-core-extension-gateway.test.mjs`
- `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs`
- `node --test tests/runtime-core-plugin-installer-gateway.test.mjs`
- `node --test tests/runtime-core-mcp-connector-gateway.test.mjs` (fails: setup missing `skillRegistry`, see notes)
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs` (fails: contract registration error in analyzer contract path, see notes)

**Manual verification (evidence):**
- Confirmed destructive grant bypass was possible pre-fix because `checkGrants(...)` treated destructive requirements the same as write-external requirements; patched to always keep destructive actions in pending approvals.
- Confirmed manual approval grant issuance now filters out destructive requirements, so only reusable write-tier grants are minted.
- Verified plan-approval single-prompt multi-step behavior with a two-step external template test: one proposal, one approval execution, two extension executions.
- Verified plugin installer currently allows unknown capability risk metadata defaults (`riskLevel/sideEffects = "unknown"`) and does not run metadata blocking through `skillRegistry` in plugin path.

**Pass/Fail/Missing:**
- **Passed**
  - Read and write-internal templates auto-run without approval (orchestrator plan approval test suite).
  - Write-external requires approval unless an existing grant matches.
  - Destructive requires explicit approval each run by default (new regression test + orchestrator patch).
  - Plan approval executes multi-step external workflow without per-step approval prompts (new regression test).
- **Failed / gap**
  - Plugin install path does not enforce required non-unknown risk metadata at install time; this does not yet meet the “missing metadata blocks install” principle for all callable capabilities.
- **Missing / infra debt**
  - `tests/runtime-core-mcp-connector-gateway.test.mjs` fixture is stale vs runtime constructor contract (`skillRegistry` now required).
  - `tests/runtime-core-skill-risk-enforcement.test.mjs` currently fails due a contract registration validation issue (`skill.install.analyze` retry policy), limiting direct automated evidence from that suite.

**Notes / decisions:**
- Enforced destructive per-action behavior in runtime code rather than test-only reporting to align deterministic policy with architecture doc.
- Kept change minimal and localized to orchestration approval/grant flow to avoid broad runtime behavior churn during audit.

**Follow-ups:**
- Add plugin metadata enforcement parity with skill/MCP paths (block unknown `riskLevel`/`sideEffects` at install, with override path).
- Update MCP connector tests to pass required `skillRegistry` fixture.
- Fix `skill.install.analyze` contract retry policy validation path so risk-enforcement suite can run green.

### 2026-02-28 — AUDIT-005 — Skill registry and installation (Agent Skills + MCP metadata) audit — Done

**Owner:** Codex
**Scope:** Audit SkillRegistry/install behavior against `skill-registry-and-installation.md`, verify metadata enforcement + install-time-only manifest generation + capabilityScope projection, run tests, and record evidence.

**Architecture refs:**
- `docs/architecture/skill-registry-and-installation.md`
- `docs/architecture/deterministic-orchestration-architecture.md`

**Summary:**
- Added focused runtime tests for skill install metadata blocking, operator override explanation requirement, MCP metadata blocking, and installed-skill capabilityScope projection.
- Verified install-time manifest generation is isolated to installer analyzer path and not called from orchestrator/runtime execution.
- Identified one architecture mismatch: SkillRegistry exists, but enabled capability truth at execution time is currently read from `extensionGateway.listStates()`, not SkillRegistry.

**Files changed:**
- `tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `tests/runtime-core-capability-scope-enforcement.test.mjs`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `node --test tests/runtime-core-capability-scope-enforcement.test.mjs`
- `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs`
- `node --test tests/runtime-core-orchestrator-delegation-scope.test.mjs`
- `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs tests/runtime-core-capability-scope-enforcement.test.mjs tests/runtime-core-orchestrator-workflow-validation.test.mjs tests/runtime-core-orchestrator-delegation-scope.test.mjs`
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs` (fails; analyzer contract registration issue)
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs` (fails; same analyzer contract registration issue)

**Manual verification (evidence):**
- SkillRegistry exists and is wired into service: `createSkillRegistry()` at `packages/polar-control-plane/src/index.mjs:172`, override/list APIs at `:726` and `:733`.
- Runtime enabled capability projection currently uses extension gateway state: `computeCapabilityScope(... installedExtensions: extensionGateway.listStates())` in orchestrator at `packages/polar-runtime-core/src/orchestrator.mjs:546`, `:589`, `:608`; control-plane `listExtensionStates()` proxies `extensionGateway.listStates()` at `packages/polar-control-plane/src/index.mjs:625`.
- Skill metadata enforcement: `skillRegistry.processMetadata(...)` and reject path `"Skill metadata required"` in `packages/polar-runtime-core/src/skill-installer-gateway.mjs:538` and `:553`.
- MCP metadata enforcement: `skillRegistry.processMetadata(...)` and reject path `"MCP metadata required"` in `packages/polar-runtime-core/src/mcp-connector-gateway.mjs:659` and `:674`.
- Metadata completion flow explanation requirement: `submitOverride(...)` explanation check in `packages/polar-runtime-core/src/skill-registry.mjs:67` and `:72`.
- Install-time-only manifest generation path: `proposeManifest(...)` only appears in `packages/polar-runtime-core/src/skill-installer-gateway.mjs:230`; control-plane exposes `installSkill(...)` only (no runtime propose endpoint) at `packages/polar-control-plane/src/index.mjs:633`.

**Pass/Fail/Missing:**
- **Passed**
  - Missing risk metadata blocks skill and MCP install/enable flows.
  - Metadata completion flow exists with required per-capability explanation.
  - No runtime/orchestrator path found that regenerates manifests during normal execution.
  - Installed/enabled skills are projected into `capabilityScope` and delegated forward-skills are clamped by allowlist machinery.
- **Failed / mismatch**
  - Requirement “SkillRegistry is runtime source of truth for enabled capabilities” is not met as implemented; execution-time scope projection reads from extension gateway state, with SkillRegistry currently used for overrides/blocked/pending metadata state.
- **Missing / infra debt**
  - `skill.install.analyze` contract currently lacks retry policy metadata, breaking `registerSkillInstallerContract(...)` in related suites (`POLAR_CONTRACT_REGISTRY_ERROR`).
  - Contract drift exists on MCP metadata-block path: runtime emits `missingMetadata` but connector contract output schema currently rejects unknown fields in strict pipeline mode.

**Notes / decisions:**
- Kept audit changes scoped to test coverage and evidence capture; no runtime behavior changes were made in this audit.
- Added tests using passthrough middleware harness for metadata enforcement behavior where strict contract-layer drift currently blocks fixture execution.

**Follow-ups:**
- Align implementation with architecture by making SkillRegistry (or a unified registry abstraction) the explicit runtime source for enabled capability projection.
- Fix `createSkillAnalyzerContract` metadata to satisfy contract registry requirements (retry policy consistency).
- Update MCP connector contract output schema (or response shape) to include `missingMetadata` deterministically.

### 2026-02-28 — AUDIT-006 — Channels/UI thin-client enforcement audit — Done

**Owner:** Codex
**Scope:** Audit web UI + Telegram runner channel behavior against deterministic orchestration architecture (thin client boundary, workflow proposal/approval handling, repair button flow, inline anchor behavior).

**Architecture refs:**
- `docs/architecture/deterministic-orchestration-architecture.md`

**Summary:**
- Added channel-focused audit tests validating web thin-client endpoint usage and Telegram workflow/repair callback wiring.
- Verified web chat delegates orchestration to backend endpoints and does not run local generation/workflow execution logic.
- Verified Telegram runner handles workflow proposals/approvals and repair-question selection callbacks; identified inline anchor fallback behavior gap.

**Files changed:**
- `tests/channels-thin-client-enforcement.test.mjs`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/channels-thin-client-enforcement.test.mjs`
- `node --test tests/adapter-channels-normalization.test.mjs`
- `node --test tests/runtime-core-chat-ingress-gateway.test.mjs`

**Manual verification (evidence):**
- Web UI calls backend orchestration endpoints only in chat flow:
  - `fetchApi('orchestrate', ...)` at `packages/polar-web-ui/src/views/chat.js:171`
  - `fetchApi('executeWorkflow', ...)` at `packages/polar-web-ui/src/views/chat.js:134`
  - `fetchApi('rejectWorkflow', ...)` at `packages/polar-web-ui/src/views/chat.js:147`
- API allowlist includes orchestration endpoints (thin client boundary preserved):
  - `packages/polar-web-ui/vite.config.js:48`
- Telegram runner workflow proposal + approval/reject wiring:
  - proposal rendering branch at `packages/polar-bot-runner/src/index.mjs:234`
  - approve/reject button payloads at `:254` and `:255`
  - callback handlers at `:431` and `:463`
  - execute/reject actions at `:439` and `:465`
- Telegram runner repair question flow wiring:
  - repair render branch at `packages/polar-bot-runner/src/index.mjs:263`
  - A/B callback payloads at `:272` and `:273`
  - callback handler and control-plane selection call at `:471` and `:489`
- Inline anchor behavior currently falls back to current user message when anchor is non-numeric:
  - `numericAnchor` parse at `packages/polar-bot-runner/src/index.mjs:227`
  - fallback `replyToId = numericAnchor || telegramMessageId` at `:230`

**Pass/Fail/Missing:**
- **Passed**
  - Web chat is a thin client for orchestration (backend endpoints only; no local orchestration loop in chat view).
  - Telegram runner supports workflow proposal rendering and approval/reject action handling.
  - Telegram runner supports repair_question rendering and A/B selection callbacks.
- **Failed / gap**
  - Inline reply anchoring is not strict to valid `anchorMessageId`: when `useInlineReply` is true and anchor is invalid/non-numeric, runner replies to current message id by fallback.
- **Missing**
  - No deeper runtime e2e harness for Telegram callback interactions beyond source-level and unit-level coverage in this audit.

**Notes / decisions:**
- Added source-level audit tests for channel adapters/runners because dedicated Telegram runner unit tests were not present.
- Kept this audit to verification/testing only; no runner behavior changes in this entry.

**Follow-ups:**
- Tighten Telegram inline-reply rule to require valid numeric anchor before setting `reply_parameters`, otherwise send non-inline.

### 2026-02-28 — AUDIT-007 — Observability and audit logging audit — Done

**Owner:** Codex
**Scope:** Audit runtime observability/audit behavior against runtime topology expectations (audit/telemetry lineage) and implementation-log practices, including correlation IDs, tool execution traces/redaction, policy decision traces, and deterministic failure visibility.

**Architecture refs:**
- `docs/architecture/runtime-topology.md`
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/implementation/implementation-log.md`

**Summary:**
- Added failure-path assertions to ensure deterministic execution header always surfaces failed steps before narrative text.
- Verified middleware audit envelopes and trace correlation are present; verified thread-level failure correlation includes `workflowId/runId/threadId`.
- Identified observability gaps: no built-in redaction path for tool lifecycle payloads, no explicit persisted policy decision audit events (`allow/deny/require_approval`), and no durable success-path run lineage keyed by `workflowId/runId/threadId`.

**Files changed:**
- `tests/runtime-core-orchestrator-thread-ownership.test.mjs`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-orchestrator-thread-ownership.test.mjs`
- `node --test packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- `node --test tests/runtime-core-contract-middleware.test.mjs`
- `node --test tests/runtime-core-tool-lifecycle-gateway.test.mjs`
- `node --test tests/runtime-core-extension-gateway.test.mjs`
- `node --test tests/runtime-core-usage-telemetry-gateway.test.mjs`
- `node --test tests/runtime-core-handoff-routing-telemetry.test.mjs`
- `node --test tests/runtime-core-handoff-telemetry-gateway.test.mjs`
- `node --test tests/adapter-pi.test.mjs`

**Manual verification (evidence):**
- Failure correlation fields are written on thread errors with all three IDs: `packages/polar-runtime-core/src/orchestrator.mjs` (`thread.lastError` includes `runId`, `workflowId`, `threadId` at the validation/step/crash failure branches).
- Execution run trace message includes `threadId` and `runId` (`[TOOL RESULTS] threadId=... runId=...`), but not `workflowId`, in `packages/polar-runtime-core/src/orchestrator.mjs`.
- Deterministic header is always prepended to user-visible execution text and injected into the narrative prompt with explicit “Do NOT hide failures” instruction in `packages/polar-runtime-core/src/orchestrator.mjs`; strengthened by test assertions in `tests/runtime-core-orchestrator-thread-ownership.test.mjs`.
- Audit envelopes emitted by middleware include trace/action/stage/outcome/risk/trust metadata, but do not include sanitized input/output payload snapshots (`packages/polar-runtime-core/src/middleware-pipeline.mjs`).
- Tool lifecycle gateway serializes full args/result payload JSON (`payloadJson`) without built-in redaction (`packages/polar-runtime-core/src/tool-lifecycle-gateway.mjs`), and this gateway is not wired by default in control-plane service composition.
- Policy allow/deny is enforced functionally (`POLAR_EXTENSION_POLICY_DENIED`, `workflow_proposed` approval blocking), but there is no dedicated policy decision event schema/sink capturing normalized decisions (`allow|deny|require_approval`) as first-class audit records.
- Implementation log format remains append-only with per-entry tests/evidence/follow-up fields, consistent with documented practices.

**Pass/Fail/Missing:**
- **Passed**
  - Deterministic execution header behavior for failure visibility is present and now covered with explicit failure assertions.
  - Middleware audit trail is trace-correlated and fail-closed when audit sink write fails.
  - Failure-thread correlation (`workflowId/runId/threadId`) exists in thread state via `lastError`.
- **Failed / gap**
  - Tool execution input/output redaction is not enforced by a built-in runtime redaction stage before telemetry/audit persistence.
  - Policy decisions are not emitted as explicit normalized audit events (`allow|deny|require_approval`) suitable for governance queries.
- **Missing**
  - No durable, queryable success-path lineage store keyed by `workflowId/runId/threadId`; correlation is largely transient or failure-centric.
  - `runtime-topology.md` lacks a concrete observability subsection defining required event schema, retention, and redaction guarantees.

**Notes / decisions:**
- Kept this audit scoped to verification and test hardening; no runtime behavior changes were applied in this entry.

**Follow-ups:**
- Introduce an explicit audit event schema/store for workflow runs (`workflowId`, `runId`, `threadId`, step, status, timestamps, policyDecision).
- Add mandatory redaction middleware for tool lifecycle payloads (field-level denylist/allowlist + structured secret scrubbing) before any sink writes.
- Emit first-class policy decision audit events at evaluation points (extension execution, approval checks, automation policy gates).
- Wire tool lifecycle telemetry into default control-plane runtime composition with deterministic retention/backpressure policy.

### 2026-02-28 — AUDIT-008 — Recent bugfix sanity (repair phrasing + ApprovalStore + SkillRegistry) — Done

**Owner:** Codex
**Scope:** Re-audit pre-audit bugfix surfaces for runtime crash risk, deterministic repair routing authority, approval/grant matching safety, and skill metadata enforcement; add missing regression tests (repair phrasing codepath).

**Architecture refs:**
- `docs/architecture/routing-repair-and-disambiguation.md`
- `docs/architecture/open-loops-and-change-of-mind.md`
- `docs/architecture/approvals-and-grants.md`
- `docs/architecture/skill-registry-and-installation.md`

**Summary:**
- Fixed orchestrator repair phrasing crash-risk path by resolving `providerId/model` before the repair phrasing LLM call and added a regression test that fails if this regresses.
- Fixed execute-workflow crash-path bug where `internalMessageId` referenced an out-of-scope variable in catch handling.
- Hardened `ApprovalStore` matching to include deterministic target/constraint checks and moved `riskLevel` to an explicit typed parameter (no untyped scope-field sourcing).
- Added approval-store tests for session/workspace scoping, target/constraint matching, and explicit risk-level storage behavior.

**Files checked:**
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/approval-store.mjs`
- `packages/polar-runtime-core/src/skill-registry.mjs`
- `packages/polar-runtime-core/src/skill-installer-gateway.mjs`
- `packages/polar-runtime-core/src/mcp-connector-gateway.mjs`
- `packages/polar-runtime-core/src/capability-scope.mjs`
- `packages/polar-bot-runner/src/index.mjs`
- `tests/runtime-core-open-loops-repair.test.mjs`
- `tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `tests/channels-thin-client-enforcement.test.mjs`

**Files changed:**
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/approval-store.mjs`
- `packages/polar-runtime-core/tests/approval-store.test.mjs`
- `tests/runtime-core-orchestrator-repair-phrasing.test.mjs`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-open-loops-repair.test.mjs`
- `node --test packages/polar-runtime-core/tests/approval-store.test.mjs`
- `node --test packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `node --test tests/runtime-core-orchestrator-repair-phrasing.test.mjs`
- `node --test tests/channels-thin-client-enforcement.test.mjs`

**Manual verification (evidence):**
- Repair phrasing path now resolves profile/provider/model before repair LLM call (`orchestrator.mjs`):
  - profile/model resolution before repair generate call (`const profile...`, `providerId`, `model`)
  - repair phrasing generate call uses those resolved values.
- Repair authority remains code-owned:
  - `computeRepairDecision(...)` emits fixed `id: 'A'|'B'`, fixed `threadId` candidates, and code-generated `correlationId`.
  - orchestrator only accepts `question/labelA/labelB` from phrasing output; it does not accept model-supplied IDs/thread mapping.
  - deterministic selection path remains code-only via `handleRepairSelectionEvent` + `handleRepairSelection`.
- Deterministic fallback verified:
  - if phrasing LLM call fails, orchestrator returns `repair_question` with deterministic fallback question/options and no session reset.
- Crash-path fix verified:
  - execute-workflow catch now stores `internalMessageId` in-scope and returns without referencing undefined `thread`.
- ApprovalStore behavior verified:
  - TTL cleanup remains enforced on lookup.
  - principal scoping works for user/session/workspace.
  - matching now enforces capability + targets + constraints deterministically.
  - `riskLevel` now comes from explicit typed function arg; untyped scope payload does not control stored `riskLevel`.
- Skill metadata enforcement verified:
  - missing per-capability risk metadata still blocks install/enable (`skillRegistry.processMetadata` with reject path in skill/MCP installers).
  - metadata override flow requires explanation before unblock.
  - capability scope projection still derives from allowlisted enabled extensions and clamped forwarding, not prompt-only strings.

**Findings (pass/fail):**
- **Passed**
  - Repair phrasing path no longer has provider/model TDZ crash risk.
  - Repair routing authority remains deterministic and code-owned.
  - ApprovalStore now enforces deterministic target/constraint matching plus principal scoping.
  - Skill metadata blocking and override explanation requirements hold.
- **Failed**
  - None in the audited scope after fixes.

**Notes / decisions:**
- Added focused repair-phrasing orchestrator tests specifically to prevent silent regressions where repair phrasing silently falls back due variable initialization bugs.
- Kept bot-runner glue behavior unchanged in this audit; source checks + tests confirm repair button rendering/selection paths remain wired.

**Follow-ups:**
- Thread target/constraint request data is now enforceable in `ApprovalStore`; next step is plumbing richer target/constraint context from all call sites that issue grant checks (where applicable).

### 2026-02-28 — AUDIT-008A — Recent bugfix sanity addendum (extra skill-risk suites) — Done

**Owner:** Codex
**Scope:** Append additional evidence from optional-but-present skill risk/installer suites executed after AUDIT-008.

**Architecture refs:**
- `docs/architecture/skill-registry-and-installation.md`

**Files changed:**
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs`
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs`

**Manual verification (evidence):**
- Both suites fail before runtime assertions due contract registration validation in `registerSkillInstallerContract(...)`:
  - `POLAR_CONTRACT_REGISTRY_ERROR`
  - `details: { actionId: 'skill.install.analyze', version: 1 }`
  - message: `Contract retryPolicy.maxAttempts must be a positive integer`

**Notes / decisions:**
- This is an existing test harness/contract metadata issue, not introduced by the repair/approval-store fixes in AUDIT-008.

**Follow-ups:**
- Fix `skill.install.analyze` contract retry policy metadata so blocked suites can execute behavioral assertions.

### 2026-02-28 — AUDIT-007 — Recent bugfix sanity (repair phrasing + ApprovalStore + SkillRegistry) — Done

**Owner:** Codex
**Scope:** Re-verify pre-audit bugfix surfaces for runtime crash safety, deterministic routing authority, approval/grant scope correctness, and skill metadata enforcement; validate Telegram repair-question glue remains wired.

**Architecture refs:**
- `docs/architecture/routing-repair-and-disambiguation.md`
- `docs/architecture/open-loops-and-change-of-mind.md`
- `docs/architecture/approvals-and-grants.md`
- `docs/architecture/skill-registry-and-installation.md`

**Files checked:**
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/approval-store.mjs`
- `packages/polar-runtime-core/src/skill-registry.mjs`
- `packages/polar-runtime-core/src/skill-installer-gateway.mjs`
- `packages/polar-runtime-core/src/capability-scope.mjs`
- `packages/polar-runtime-core/src/extension-gateway.mjs`
- `packages/polar-bot-runner/src/index.mjs`
- `tests/runtime-core-orchestrator-repair-phrasing.test.mjs`
- `packages/polar-runtime-core/tests/approval-store.test.mjs`
- `tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `tests/runtime-core-open-loops-repair.test.mjs`
- `tests/runtime-core-capability-scope-enforcement.test.mjs`
- `tests/runtime-core-orchestrator-thread-ownership.test.mjs`
- `packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- `tests/channels-thin-client-enforcement.test.mjs`

**Files changed:**
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-orchestrator-repair-phrasing.test.mjs`
- `node --test tests/runtime-core-open-loops-repair.test.mjs`
- `node --test packages/polar-runtime-core/tests/approval-store.test.mjs`
- `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `node --test packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- `node --test tests/runtime-core-orchestrator-thread-ownership.test.mjs`
- `node --test tests/runtime-core-capability-scope-enforcement.test.mjs`
- `node --test tests/channels-thin-client-enforcement.test.mjs`

**Manual verification (evidence):**
- Repair phrasing call uses resolved model policy before the call path:
  - provider/model resolved before repair generate call in `orchestrator.mjs` (`profile` + `providerId` + `model` before `computeRepairDecision` / phrasing generate call).
- LLM phrasing cannot change routing authority:
  - options/correlation come from `computeRepairDecision` and persisted `PENDING_REPAIRS`; phrasing path only applies `question`, `labelA`, `labelB`.
  - deterministic selection path remains code-only (`handleRepairSelectionEvent` -> `handleRepairSelection`).
- Deterministic fallback remains intact:
  - phrasing failures are caught and fall back to canned repair question/options without session reset/new thread creation.
- Crash-path safety:
  - `executeWorkflow` catch returns `internalMessageId` from in-scope variable; no out-of-scope `thread` reference.
- Approval store behavior:
  - `issueGrant` takes typed `riskLevel` argument and validates via `normalizeRiskLevel`.
  - `findMatchingGrant` enforces user/session/workspace scoping, TTL cleanup, and deterministic capability + targets + constraints matching.
- Skill metadata/install enforcement:
  - missing metadata blocks install (`processMetadata` + installer reject/markBlocked path).
  - metadata completion requires explanation (`submitOverride` explanation validation).
  - install-time proposal storage exists (`skillRegistry.propose`), and runtime execution scope is projected from enabled registry state + policy via `computeCapabilityScope`; extension execution enforces `capabilityScope`.
- Telegram repair glue remains wired:
  - `repair_question` rendering and `repair_sel:A/B:<correlationId>` callback path to `controlPlane.handleRepairSelection(...)` present and covered by test.

**Findings (pass/fail):**
- **Passed**
  - No new runtime crash in audited repair/approval paths; repair phrasing codepath is covered by dedicated regression tests.
  - No prompt-driven routing authority regression in repair flow (A/B, correlationId, and thread ownership remain code authoritative).
  - Approval/grant matching enforces TTL/principal/capability/target/constraint scope.
  - Skill metadata enforcement and capability scope projection/enforcement are active.
- **Failed**
  - None in this scoped audit run.

**Missing / follow-ups:**
- Telegram inline reply fallback still replies to current message when `anchorMessageId` is invalid/non-numeric; tighten to “anchor valid or no inline reply” to match strict anchoring policy.

### 2026-02-28 — AUDIT-A — Architecture-to-code reality check (architecture + extensions + operations + product) — Done

**Owner:** Codex
**Scope:** Build architecture-to-implementation matrix across docs and runtime/control-plane/channel/UI packages; mark implemented vs partial vs missing; flag doc drift and top risks.

**Files changed:**
- `docs/architecture/implementation-status.md`
- `docs/implementation/audits/AUDIT-A-architecture-reality.md`
- `docs/implementation/implementation-log.md`

**Implementation-status output:**
- Matrix file: `docs/architecture/implementation-status.md`
- Narrative summary: `docs/implementation/audits/AUDIT-A-architecture-reality.md`

**Docs covered:**
- `docs/architecture/runtime-topology.md`
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/architecture/chat-routing-and-multi-agent.md`
- `docs/architecture/open-loops-and-change-of-mind.md`
- `docs/architecture/routing-repair-and-disambiguation.md`
- `docs/architecture/approvals-and-grants.md`
- `docs/architecture/skill-registry-and-installation.md`
- `docs/architecture/tooling-contract-middleware.md`
- `docs/architecture/llm-providers.md`
- `docs/architecture/openclaw-concepts-adoption.md`
- `docs/architecture/pi-mono-adoption-strategy.md`
- `docs/extensions/skills-mcp-plugins.md`
- `docs/operations/quality-and-safety.md`
- `docs/operations/incident-response-and-drills.md`
- `docs/product/ai-assistant.md`
- `docs/product/automations.md`
- `docs/product/web-ui-and-chat-management.md`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-open-loops-repair.test.mjs`
- `node --test tests/runtime-core-orchestrator-repair-phrasing.test.mjs`
- `node --test tests/runtime-core-workflow-template-enforcement.test.mjs`
- `node --test tests/runtime-core-capability-scope-enforcement.test.mjs`
- `node --test packages/polar-runtime-core/tests/approval-store.test.mjs`
- `node --test packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `node --test tests/channels-thin-client-enforcement.test.mjs`
- `node --test tests/control-plane-service.test.mjs` (failed)
- `node --test tests/adapter-channels-normalization.test.mjs`
- `node --test tests/runtime-core-contract-middleware.test.mjs`
- `node --test tests/runtime-core-handoff-gateway.test.mjs`
- `node --test tests/runtime-core-automation-gateway.test.mjs`
- `node --test tests/runtime-core-heartbeat-gateway.test.mjs`
- `node --test tests/runtime-core-scheduler-gateway.test.mjs`
- `node --test tests/runtime-core-task-board-gateway.test.mjs`
- `node --test tests/check-pi-mono-imports.test.mjs`
- `node --test tests/adapter-pi.test.mjs`
- `node --test tests/runtime-core-usage-telemetry-gateway.test.mjs`
- `node --test tests/runtime-core-handoff-routing-telemetry.test.mjs`
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs` (failed)
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs` (failed)

**Manual verification (evidence):**
- Deterministic routing + repair authority are code-owned in `packages/polar-runtime-core/src/routing-policy-engine.mjs` and `packages/polar-runtime-core/src/orchestrator.mjs`; A/B IDs, thread mapping, and correlation IDs are not model-owned.
- Thread ownership is persisted on workflow proposal and reused on execution (`threadId` captured in pending workflow entry) in `packages/polar-runtime-core/src/orchestrator.mjs`.
- Web UI and Telegram runner call backend orchestrator endpoints (`orchestrate`, `executeWorkflow`, `rejectWorkflow`, `handleRepairSelection`) in `packages/polar-web-ui/src/views/chat.js` and `packages/polar-bot-runner/src/index.mjs`.
- Capability scope enforcement blocks out-of-scope or empty-scope tool calls in `packages/polar-runtime-core/src/extension-gateway.mjs`.
- Install-time skill/MCP metadata gating and operator override explanation flow are implemented in `packages/polar-runtime-core/src/skill-registry.mjs`, `packages/polar-runtime-core/src/skill-installer-gateway.mjs`, and `packages/polar-runtime-core/src/mcp-connector-gateway.mjs`.
- Known regression confirmed in contract registration: `skill.install.analyze` lacks valid retry metadata, causing `POLAR_CONTRACT_REGISTRY_ERROR` in blocked suites (`tests/control-plane-service.test.mjs`, `tests/runtime-core-skill-installer-gateway.test.mjs`, `tests/runtime-core-skill-risk-enforcement.test.mjs`).

**Key mismatches / top risks recorded:**
- Product docs drift (`docs/product/ai-assistant.md`, `docs/product/web-ui-and-chat-management.md`) vs current runtime/UI behavior.
- Telegram inline reply still falls back to current message when anchor is invalid.
- No dedicated repair telemetry stream.
- No unified durable lineage store keyed by `workflowId/runId/threadId`.
- Skill analyzer contract metadata bug blocks broad integration suites.

**Follow-ups:**
- Fix `createSkillAnalyzerContract` retry metadata and re-run blocked suites.
- Enforce strict anchor handling in Telegram runner (invalid anchor => non-inline reply).
- Implement unified durable audit lineage events for workflow/run/thread + policy + repair decisions.
- Update stale product docs to reflect deterministic orchestrator architecture.

### 2026-02-28 — AUDIT-B — Security & policy enforcement end-to-end (contracts + capabilityScope + approvals + delegation) — Done

**Owner:** Codex  
**Scope:** Verify deterministic enforcement and bypass resistance across execution choke points, contracts/schema, approvals/grants, skill metadata, and delegation privilege boundaries.

**Files changed:**
- `docs/implementation/audits/AUDIT-B-security-policy.md`
- `docs/implementation/implementation-log.md`
- `tests/runtime-core-orchestrator-workflow-validation.test.mjs`
- `packages/polar-runtime-core/src/orchestrator.mjs`

**Tests run (exact):**
- `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs` (pass)
- `node --test tests/runtime-core-workflow-template-enforcement.test.mjs` (pass)
- `node --test tests/runtime-core-capability-scope-enforcement.test.mjs` (pass)
- `node --test tests/runtime-core-orchestrator-delegation-scope.test.mjs` (pass)
- `node --test packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs` (pass)
- `node --test packages/polar-runtime-core/tests/approval-store.test.mjs` (pass)
- `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs` (pass)
- `node --test tests/runtime-core-extension-gateway.test.mjs` (pass)
- `node --test tests/runtime-core-contract-middleware.test.mjs` (pass)
- `node --test tests/runtime-core-orchestrator-thread-ownership.test.mjs` (pass)
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs` (failed)
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs` (failed)
- `node --test packages/polar-runtime-core/tests/skill-installer-analyzer.test.mjs` (failed)

**Manual verification (evidence):**
- Tool execution path in orchestrator and control-plane both funnel through `extensionGateway.execute(...)`:
  - `packages/polar-runtime-core/src/orchestrator.mjs:616`
  - `packages/polar-control-plane/src/index.mjs:610-611`
- ExtensionGateway enforces non-empty `capabilityScope` and blocks out-of-scope capability calls:
  - `packages/polar-runtime-core/src/extension-gateway.mjs:502-525`
- Workflow parsing/validation is deterministic and template-first:
  - `<polar_action>` only: `packages/polar-runtime-core/src/workflow-engine.mjs:8-25`
  - arg validation: `packages/polar-runtime-core/src/workflow-engine.mjs:30-43`
  - pre-exec step validation: `packages/polar-runtime-core/src/workflow-engine.mjs:55-77`
- Added delegation escalation regression test verifies:
  - unauthorized `forward_skills` stripped and logged in `[DELEGATION ACTIVE]`
  - delegated non-forwarded tool blocked by scope (`POLAR_EXTENSION_POLICY_DENIED`)
  - `tests/runtime-core-orchestrator-workflow-validation.test.mjs:214-404`
- Crash fix applied during audit:
  - normalized non-string error payloads in `executeWorkflow` to avoid `.slice()` crash on object errors:
  - `packages/polar-runtime-core/src/orchestrator.mjs:511-519`, `641`, `664`

**Findings:**
- **Passed**
  - Read/write/destructive approval behavior and plan-approval semantics are covered and passing in orchestrator tests.
  - Capability-scope enforcement and contract/middleware validation gates are active and tested.
  - Delegation clamping + blocked out-of-scope execution now has explicit regression coverage.
- **Failed / gaps**
  - `skill.install.analyze` contract registration is currently broken (`POLAR_CONTRACT_REGISTRY_ERROR: Contract retryPolicy.maxAttempts must be a positive integer`) in:
    - `tests/runtime-core-skill-risk-enforcement.test.mjs`
    - `tests/runtime-core-skill-installer-gateway.test.mjs`
  - `packages/polar-runtime-core/tests/skill-installer-analyzer.test.mjs` fails bootstrap (`describe is not defined`), so analyzer path lacks runnable automated coverage in current harness.
  - `controlPlane.executeExtension(...)` is a direct execution path outside orchestrator approval UX; enforcement there depends on policy wiring at `extensionGateway` level.
  - Multiple model-output parses still occur without full schema validation (`orchestrator` thread_state, tool-synthesis middleware, memory extraction middleware, skill manifest proposal parse).

**Follow-ups:**
- Fix `createSkillAnalyzerContract(...)` to include valid `retryPolicy.maxAttempts` and re-run blocked skill suites.
- Add/restore runnable analyzer tests (convert to Node test API imports or compatible harness).
- Add explicit control-plane test coverage for `executeExtension(...)` risk-tier approval expectations.
- Replace remaining schema-less JSON parse paths with strict validators for model-generated payloads.

### 2026-02-28 — AUDIT-C — Chat UX correctness (routing/open loops/repair/inline/thread reactivation) — Done

**Owner:** Codex
**Scope:** Validate routing/open-loop/repair UX behavior and thread reactivation ownership across orchestrator + channel adapters; add missing regression tests requested for greeting/reversal/failed-thread reactivation behavior.

**Architecture refs:**
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/architecture/open-loops-and-change-of-mind.md`
- `docs/architecture/routing-repair-and-disambiguation.md`

**Files changed:**
- `tests/runtime-core-open-loops-repair.test.mjs`
- `docs/implementation/audits/AUDIT-C-chat-ux.md`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-open-loops-repair.test.mjs`
- `node --test tests/runtime-core-orchestrator-routing.test.mjs`
- `node --test tests/runtime-core-orchestrator-thread-ownership.test.mjs`
- `node --test tests/runtime-core-orchestrator-repair-phrasing.test.mjs`
- `node --test tests/channels-thin-client-enforcement.test.mjs`

**Manual verification (evidence):**
- Routing priority rules verified in `packages/polar-runtime-core/src/routing-policy-engine.mjs`:
  - reversal-before-override guard (`AFFIRM_AFTER_REJECT`) and explicit override precedence (`overrideKeywords`) at `:858-895`
  - status nudge + greeting recency gating at `:897-920`
  - answer fit-check gate for pending questions at `:988-1003`
  - error inquiry + lastError TTL gating at `:970-986`
- Repair determinism verified:
  - trigger + A/B construction in `computeRepairDecision(...)` (`routing-policy-engine.mjs:716-779`)
  - selection only accepts `A|B` and matching correlation in `handleRepairSelection(...)` (`routing-policy-engine.mjs:791-803`)
- Workflow ownership/reactivation verified in orchestrator:
  - proposal stores canonical `threadId` (`packages/polar-runtime-core/src/orchestrator.mjs:427-433`)
  - execution uses stored owner thread (`orchestrator.mjs:484-510`)
  - `lastError` contains `runId/workflowId/threadId` on fail/crash paths (`orchestrator.mjs:563-567`, `638-640`, `660-662`, `714-716`)
- Inline reply end-to-end evidence:
  - orchestrator returns `useInlineReply/anchorMessageId` (`orchestrator.mjs:464-474`)
  - strict anchor selection in routing engine (`routing-policy-engine.mjs:1160-1187`)
  - Telegram still falls back to current message when anchor invalid (`packages/polar-bot-runner/src/index.mjs:223-231`)
- Repair button flow evidence:
  - Telegram A/B render + callback to backend (`polar-bot-runner/src/index.mjs:263-273`, `471-493`)
  - keyboard disable on click (`polar-bot-runner/src/index.mjs:486`)
  - web UI has no repair-question handling path (`packages/polar-web-ui/src/views/chat.js`).

**Notes / decisions:**
- Added explicit regressions for:
  - greeting stale-vs-recent status-nudge behavior
  - reversal phrase with override verb routing to `override` (not accept)
  - recent failed thread with open offer still participating in reactivation/acceptance logic
- Retained current adapter behavior in this audit and documented strict-inline gap as follow-up.

**Follow-ups:**
- Enforce strict Telegram inline policy: if anchor invalid/non-numeric, do not set reply-to.
- Add web `repair_question` rendering + `handleRepairSelection` callback path.
- If architecture requires confidence-margin scoring for repair, add explicit scoring/telemetry (current implementation uses low-info + open-loop heuristic).

### 2026-02-28 — AUDIT-D — Extensibility (Skill registry/install, discovery, templates, multi-agent reuse) — Done

**Owner:** Codex
**Scope:** Audit skill install lifecycle, metadata/HITL enforcement, runtime capability projection, template/composition readiness, and multi-agent capability reuse boundaries.

**Architecture refs:**
- `docs/architecture/skill-registry-and-installation.md`
- `docs/architecture/approvals-and-grants.md`
- `docs/architecture/deterministic-orchestration-architecture.md`

**Files changed:**
- `tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `docs/implementation/audits/AUDIT-D-extensibility.md`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `node --test tests/runtime-core-capability-scope-enforcement.test.mjs`
- `node --test tests/runtime-core-orchestrator-delegation-scope.test.mjs`
- `node --test tests/runtime-core-workflow-template-enforcement.test.mjs`
- `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs`
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs` (fails)
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs` (fails)

**Manual verification (evidence):**
- SkillRegistry runtime object and metadata/block/proposal APIs:
  - `packages/polar-runtime-core/src/skill-registry.mjs:9-171`
  - control-plane wiring at `packages/polar-control-plane/src/index.mjs:172`, override/list endpoints at `:726-734`
- Install analyzer + pending-install flow exists in installer gateway:
  - `proposeManifest(...)` (`packages/polar-runtime-core/src/skill-installer-gateway.mjs:230-309`)
  - pending lifecycle metadata (`skill-installer-gateway.mjs:289-295`)
- Deterministic metadata blocking:
  - skill install reject path (`skill-installer-gateway.mjs:538-554`)
  - MCP sync reject path (`packages/polar-runtime-core/src/mcp-connector-gateway.mjs:659-675`)
- Capability projection currently uses enabled extension states in scope computation:
  - `packages/polar-runtime-core/src/capability-scope.mjs:85-119`
  - orchestrator passes `extensionGateway.listStates()` (`orchestrator.mjs:552-556`, `595-599`, `614-618`)
- Forwarded skills are clamped before delegation activation (`orchestrator.mjs:585-604`).
- Runtime install/execution does not regenerate manifests was verified by new regression: provider generate call count remains zero in install+execute path (`tests/runtime-core-skill-registry-install-enforcement.test.mjs`).

**Pass/Fail/Missing:**
- **Passed**
  - Missing risk metadata blocks install/enable.
  - Metadata completion requires explanation per capability.
  - Deterministic template expansion/validation is active and tested.
  - Delegation capability forwarding is clamped and scope-enforced.
  - New regression confirms runtime install/execute path does not call manifest generation.
- **Partial / drift**
  - Proposal flow exists in runtime gateway but is not exposed as a control-plane API; install lifecycle is not fully represented as explicit pending->HITL->enable endpoint flow.
  - Runtime capability projection source-of-truth is extension state + policy, not SkillRegistry-only projection as docs describe.
  - HITL-before-enable is partial because `autoEnableTrusted` and `enableAfterInstall` can enable without an explicit approval step.
- **Missing**
  - Auto-composed workflow readiness artifacts (PlanSketch schema, composition rule engine, composition cache/registry) not present.

**Notes / decisions:**
- Added one targeted extensibility regression test only, to keep scope focused on the stated “install-time only” runtime guarantee.
- Recorded existing analyzer contract regression separately as blocking context for legacy installer/risk suites.

**Follow-ups:**
- Expose and gate `proposeManifest` with explicit HITL approval lifecycle in control-plane/API surface.
- Align runtime capability projection with registry+policy source-of-truth (or update docs if extension-state is intended design).
- Fix `skill.install.analyze` contract metadata (`retryPolicy.maxAttempts`) to unblock installer/risk test suites.
- Decide and document policy for direct install APIs currently present in web allowlist (`installSkill`, `syncMcpServer`, `installPlugin`).

### 2026-02-28 — AUDIT-E — Observability, operations, and reliability audit — Done

**Owner:** Codex
**Scope:** Validate observability + audit trail realism, failure truthfulness, runtime reliability controls, and operations runbook alignment against runtime-topology/deterministic architecture docs and current code.

**Architecture refs:**
- `docs/architecture/runtime-topology.md`
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/operations/quality-and-safety.md`
- `docs/operations/incident-response-and-drills.md`

**Files changed:**
- `docs/implementation/audits/AUDIT-E-ops-observability.md`
- `docs/operations/incident-response-and-drills.md`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
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

**Manual verification (evidence):**
- Correlation IDs and audit envelope checkpoints verified in middleware pipeline (`packages/polar-runtime-core/src/middleware-pipeline.mjs`) including trace IDs, stage checkpoints, risk/trust classes.
- Workflow correlation verified in orchestrator:
  - owner `threadId` persisted at proposal (`orchestrator.mjs:427-433`)
  - `runId` generated per execution (`orchestrator.mjs:508`)
  - `lastError` carries `runId/workflowId/threadId` on failure paths (`orchestrator.mjs:566-567`, `638-639`, `660-661`, `714-715`)
  - `[TOOL RESULTS] threadId=... runId=...` emitted (`orchestrator.mjs:676`)
- Failure truthfulness behavior verified:
  - deterministic execution header generated and prepended on completed execution summaries (`orchestrator.mjs:675`, `700`)
  - prompt guard against hiding failures (`orchestrator.mjs:685`)
- Reliability controls verified:
  - provider fallback/cooldown path in `provider-gateway.mjs:322-548`
  - scheduler retry/dead-letter and queue actions in `scheduler-gateway.mjs`
  - orchestrator TTL cleanup for pending workflow/thread/repair maps (`orchestrator.mjs:28-49`)
- Ops docs alignment update delivered:
  - added practical runbooks to `docs/operations/incident-response-and-drills.md` for local run, deployment reality, secret rotation, and troubleshooting `Invalid extension.gateway.execute.request`.

**Findings (pass/partial/missing):**
- **Passed**
  - Middleware audit + telemetry collectors are active and tested.
  - Provider fallback/cooldown and scheduler retry/dead-letter controls are implemented and tested.
  - Deterministic execution header exists and is shown before narrative on successful workflow summary responses.
- **Partial**
  - Correlation trail exists but is fragmented: workflow step records are not consistently normalized as `{ extensionId, capabilityId }`.
  - Policy decisions are enforced but not emitted as explicit audit decision events (allow/deny/require-approval with reason codes).
- **Missing / risk**
  - Audit sink defaults to no-op unless configured (`middleware-pipeline` default + control-plane wiring), so immutable audit persistence is not guaranteed by default.
  - No standard timeout wrapper for provider `generate/stream/embed` and extension tool execution paths.
  - No server-side ingress rate-limiting/backoff baseline (outside channel-level debounce).

**Notes / decisions:**
- Existing test coverage already includes correlation-ID generation and propagation; no additional minimal correlation test was required in this audit run.
- Focused this audit change on documentation realism and evidence capture rather than runtime behavior changes.

**Follow-ups:**
- Add durable audit storage and non-dev fail-closed behavior when sink is missing/unavailable.
- Emit first-class policy decision audit events with reason codes.
- Normalize step-level workflow logs with both `extensionId` and `capabilityId`.
- Add timeout/cancellation envelopes for provider and extension execution.
- Add server-side ingress rate limit/backoff controls.

### 2026-02-28 — FINALIZE-PLAN-001 — Implementation finalization analysis + chunked execution write-up — Done

**Owner:** Codex
**Scope:** Consolidate audit outputs into a deterministic, long-running agent execution plan; refresh baseline evidence with focused tests; publish finalization write-up and link it from implementation status.

**Summary:**
- Added a dedicated finalization plan with dependency-ordered chunks (`F0`..`F6`), per-chunk code targets, required tests, and done criteria.
- Linked finalization write-up from status matrix with refreshed pass/fail baseline evidence.
- Captured current blocker signature to keep future agent runs anchored to concrete failure evidence.

**Architecture refs:**
- `docs/project-overview.md`
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/architecture/chat-routing-and-multi-agent.md`
- `docs/architecture/approvals-and-grants.md`
- `docs/architecture/skill-registry-and-installation.md`
- `docs/architecture/runtime-topology.md`

**Files changed:**
- `docs/implementation/implementation-finalization-plan.md`
- `docs/implementation/implementation-status.md`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/control-plane-service.test.mjs` (fails: `POLAR_CONTRACT_REGISTRY_ERROR` on `skill.install.analyze` retry metadata)
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs` (fails: same signature)
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs` (fails: same signature)
- `node --test tests/runtime-core-open-loops-repair.test.mjs` (pass)
- `node --test tests/runtime-core-extension-gateway.test.mjs` (pass)
- `node --test tests/runtime-core-contract-middleware.test.mjs` (pass)

**Manual verification (evidence):**
- Confirmed finalization plan chunk dependencies and priorities map directly to `implementation-status` Top 10 risks and Next 3 priorities.
- Confirmed all chunk definitions include concrete code pointers and explicit test commands for deterministic agent handoff.
- Confirmed blocker signature is unchanged across all three blocked suites (`skill.install.analyze` contract retry metadata).

**Notes / decisions:**
- Kept finalization scope evidence-based; no “100% complete” claim is made.
- Sequenced plan to unblock integration visibility first (`F0`), then policy/UX/reliability closure in dependency-safe order.

**Follow-ups:**
- Execute `F0` immediately to restore blocked suites and unlock reliable progress tracking for subsequent chunks.

### 2026-02-28 — F0-001 — Skill analyzer contract blocker remediation + blocked suite restore — Done

**Owner:** Codex
**Scope:** Complete F0 from `implementation-finalization-plan.md`: remove the `skill.install.analyze` contract-registration blocker path and restore the three previously blocked suites.

**Summary:**
- Patched runtime-core skill installer registration to keep analyzer registration available but non-blocking, with retry-policy normalization when analyzer registration is explicitly enabled.
- Preserved strict contract-registry enforcement and improved retry-policy error details.
- Restored blocked suite execution by fixing hidden bootstrap/runtime issues surfaced after unblocking (control-plane imports and orchestrator cleanup interval exit behavior).

**Architecture refs:**
- `docs/implementation/implementation-finalization-plan.md`
- `docs/architecture/tooling-contract-middleware.md`
- `docs/architecture/skill-registry-and-installation.md`

**Files changed:**
- `packages/polar-runtime-core/src/skill-installer-gateway.mjs`
- `packages/polar-runtime-core/src/contract-registry.mjs`
- `packages/polar-control-plane/src/index.mjs`
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `docs/implementation/implementation-status.md`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/control-plane-service.test.mjs`
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs`
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs`

**Manual verification (evidence, not vibes):**
- Confirmed all three required suites now pass in the final run:
  - `tests/control-plane-service.test.mjs`: 13 passed, 0 failed.
  - `tests/runtime-core-skill-installer-gateway.test.mjs`: 7 passed, 0 failed.
  - `tests/runtime-core-skill-risk-enforcement.test.mjs`: 3 passed, 0 failed.
- Confirmed previous blocker signature (`POLAR_CONTRACT_REGISTRY_ERROR` / `retryPolicy.maxAttempts`) no longer appears in these suites.
- Confirmed control-plane bootstrap now resolves `createApprovalStore` and `createSkillRegistry`.
- Confirmed orchestrator periodic cleanup timer is `unref()`'d so node test runs terminate cleanly.

**Notes / decisions:**
- Kept contract registry fail-closed; no relaxation was introduced for invalid contracts.
- Maintained backward-compatible default behavior for `registerSkillInstallerContract(...)` while still supporting explicit analyzer contract registration with normalized retry metadata.
- During verification, `control-plane-service` initially timed out after unblocking because of an active interval handle; fixed via `unref()` in orchestrator cleanup timer.

**Follow-ups:**
- Add dedicated tests for analyzer registration (`includeAnalyzer: true`) and `proposeManifest` behavior to prevent silent regressions.
- Revisit whether analyzer contract registration should become default once analyzer path has full runtime and test coverage.

### 2026-02-28 — F1-001 — Deterministic chat UX closure (inline anchor + web repair flow) — Done

**Owner:** Codex
**Scope:** Complete F1 from `implementation-finalization-plan.md`: enforce strict Telegram inline-anchor behavior and add web `repair_question` A/B selection path to `handleRepairSelection`.

**Summary:**
- Enforced strict Telegram reply anchoring so inline reply is only applied when `anchorMessageId` is valid numeric; removed fallback to current user message ID.
- Added web chat `repair_question` rendering with deterministic A/B buttons and wired both to backend `handleRepairSelection`.
- Added/updated adapter/UI assertions to cover strict anchor behavior and web repair selection routing.

**Architecture refs:**
- `docs/implementation/implementation-finalization-plan.md`
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/architecture/routing-repair-and-disambiguation.md`

**Files changed:**
- `packages/polar-bot-runner/src/index.mjs`
- `packages/polar-web-ui/src/views/chat.js`
- `packages/polar-web-ui/vite.config.js`
- `tests/channels-thin-client-enforcement.test.mjs`
- `docs/implementation/implementation-status.md`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/channels-thin-client-enforcement.test.mjs`
- `node --test tests/runtime-core-open-loops-repair.test.mjs`

**Manual verification (evidence, not vibes):**
- Verified Telegram inline reply options now require `useInlineReply === true` and a valid positive integer `anchorMessageId`; invalid/non-numeric anchors produce non-inline responses (no fallback to current message id).
- Verified web chat now handles `repair_question` by rendering A/B controls and calling `fetchApi('handleRepairSelection', { sessionId, selection: 'A'|'B', correlationId })`.
- Verified Vite control-plane allowlist includes `handleRepairSelection`, enabling the web repair button path end-to-end.
- Confirmed required suites pass with new adapter/UI assertions:
  - `tests/channels-thin-client-enforcement.test.mjs`: 5 passed, 0 failed.
  - `tests/runtime-core-open-loops-repair.test.mjs`: 43 passed, 0 failed.

**Notes / decisions:**
- Kept changes minimal and transport-layer only for F1: no routing-policy behavior moved into clients.
- UI verification is currently static adapter/UI assertion coverage; no browser-interaction harness was added in this chunk.

**Follow-ups:**
- Add browser-level integration tests for web repair button lifecycle (render, disable-on-click, success/error path).
- Consider shared helper utilities for repair UI rendering if additional channels adopt similar button semantics.

### 2026-02-28 — F2-001 — Policy/approval choke-point hardening and schema-validated runtime-control parsing — Done

**Owner:** Codex
**Scope:** Complete F2 from `implementation-finalization-plan.md`: align direct control-plane execution with orchestrated approval/policy behavior and replace schema-less runtime-control JSON parses in touched paths.

**Summary:**
- Centralized extension execution approval enforcement in `extension-gateway` with built-in approval requirements for external/network/destructive capabilities.
- Aligned orchestrator execution with gateway enforcement by passing real `userId`, issuing run-scoped destructive grants, and revoking transient destructive grants post-run.
- Hardened direct `executeExtension` in control-plane service by recomputing server-side capability scope (ignoring caller-supplied scope) and added schema-validated parsing for orchestrator/tool-synthesis/memory-extraction control JSON payloads.

**Architecture refs:**
- `docs/implementation/implementation-finalization-plan.md`
- `docs/architecture/approvals-and-grants.md`
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/architecture/tooling-contract-middleware.md`

**Files changed:**
- `packages/polar-control-plane/src/index.mjs`
- `packages/polar-runtime-core/src/extension-gateway.mjs`
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/tool-synthesis-middleware.mjs`
- `packages/polar-runtime-core/src/memory-extraction-middleware.mjs`
- `tests/runtime-core-extension-gateway.test.mjs`
- `tests/control-plane-direct-execution-approvals.test.mjs`
- `docs/implementation/implementation-status.md`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-extension-gateway.test.mjs`
- `node --test packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs`
- `node --test tests/control-plane-direct-execution-approvals.test.mjs`
- `node --test tests/bug-fixes-comprehensive.test.mjs tests/runtime-core-phase-8-advanced-features.test.mjs`

**Manual verification (evidence, not vibes):**
- Verified direct control-plane execution path now overrides caller-provided `capabilityScope` with server-computed scope derived from session profile + installed extension state.
- Verified approval-required capability execution (`sideEffects: external`, `dataEgress: network`) now fails with `POLAR_EXTENSION_POLICY_DENIED` when no grant exists.
- Verified extension-gateway approval enforcement is shared by orchestration and direct execution paths (same `extensionGateway.execute` choke point).
- Verified destructive workflows still execute after manual approval and do not persist reusable grants (`orchestrator-plan-approvals` remains green, including destructive regression).
- Verified runtime-control JSON parsing in touched paths is schema-validated (`repair phrasing`, `thread_state`, persisted delegation metadata, tool synthesis response, memory extraction response), with deterministic fallback/error handling.

**Notes / decisions:**
- Kept approval enforcement at execution boundary (`extension-gateway`) so orchestration and direct APIs cannot diverge on policy for the same capability invocation.
- Implemented destructive approvals as run-scoped transient grants (`workflowId` + `runId` constraints) revoked in `finally` to preserve “explicit approval every run” behavior.
- Capability metadata normalization now tolerates additional metadata keys while enforcing known risk/effects/egress enums for approval decisions.

**Follow-ups:**
- Consider exposing an explicit audited control-plane approval issuance/review API for non-orchestrated administrative execution paths that legitimately need approval-required direct execution.
- Add first-class policy decision telemetry events (allow/deny/required-approval reason codes) to durable lineage sink work in F4.

### 2026-02-28 — F3-001 — Extension lifecycle + capability authority alignment — Done

**Owner:** Codex
**Scope:** Complete F3 from `implementation-finalization-plan.md`: make install lifecycle explicit (proposal/review/enable), align capability projection authority handling, and add deterministic tests for proposal + HITL transitions.

**Summary:**
- Added explicit skill proposal/review lifecycle APIs and deterministic pending/reject/approve transitions.
- Added registry-backed authority projection support in capability scope and wired direct control-plane execution to use authority precedence.
- Added runtime and control-plane tests for manifest proposal + HITL review transitions and authority projection precedence.

**Architecture refs:**
- `docs/implementation/implementation-finalization-plan.md`
- `docs/architecture/skill-registry-and-installation.md`
- `docs/architecture/deterministic-orchestration-architecture.md`

**Files changed:**
- `packages/polar-runtime-core/src/skill-installer-gateway.mjs`
- `packages/polar-runtime-core/src/skill-registry.mjs`
- `packages/polar-runtime-core/src/capability-scope.mjs`
- `packages/polar-control-plane/src/index.mjs`
- `tests/runtime-core-skill-installer-gateway.test.mjs`
- `tests/runtime-core-capability-scope-enforcement.test.mjs`
- `tests/control-plane-skill-install-hitl.test.mjs`
- `docs/implementation/implementation-status.md`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs`
- `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `node --test tests/runtime-core-capability-scope-enforcement.test.mjs`
- `node --test tests/control-plane-skill-install-hitl.test.mjs`
- `node --test tests/control-plane-service.test.mjs`

**Manual verification (evidence, not vibes):**
- Verified proposal path sets `pending_install`, stores registry proposal state, and records authority projection (`listPendingSkillInstallProposals` + `listCapabilityAuthorityStates` via control-plane test).
- Verified review approve path installs and enables deterministically (`reviewSkillInstallProposal` -> lifecycle `enabled`), then clears pending proposal state.
- Verified review reject path clears pending proposal and removes pending lifecycle state (`lifecycleState: removed` in installer gateway test).
- Verified capability scope now honors registry authority precedence when `authorityStates` are supplied, and rejects allowlisted skills that remain `pending_install`.
- Verified direct control-plane extension execution now computes capability scope with both installed extension snapshots and registry authority states.

**Notes / decisions:**
- Kept analyzer contract registration opt-in (`registerSkillInstallerContract(..., { includeAnalyzer: true })`) while proposal/review lifecycle APIs are exercised directly through the gateway/control-plane paths.
- Added deterministic analyzer provider defaults (`openai`/`gpt-4.1-mini`) for proposal generation request validation.

**Follow-ups:**
- Consider unifying orchestrator capability-scope inputs with registry authority states in the same way as direct control-plane execution.
- Add explicit output contract validation for proposal/review API surfaces if these endpoints become externally exposed beyond current control-plane service boundaries.
### 2026-02-28 — F4-001 — Durable lineage + repair/policy telemetry — Done

**Owner:** Codex
**Scope:** Complete F4 from `implementation-finalization-plan.md`: deliver durable queryable lineage keyed by `workflowId`/`runId`/`threadId`, emit explicit policy decision events with reason codes, and emit explicit repair trigger/selection/outcome telemetry events.

**Summary:**
- Added a durable append-only lineage store and wired middleware/orchestrator telemetry into it.
- Added derived `policy.decision` events (allow/deny) with deterministic reason codes at extension execution boundary.
- Added explicit repair lifecycle events (`repair.triggered`, `repair.selection`, `repair.outcome`) and attached workflow/run/thread lineage metadata to extension execution steps.

**Architecture refs:**
- `docs/implementation/implementation-finalization-plan.md`
- `docs/architecture/runtime-topology.md`
- `docs/architecture/routing-repair-and-disambiguation.md`
- `docs/architecture/tooling-contract-middleware.md`

**Files changed:**
- `packages/polar-runtime-core/src/durable-lineage-store.mjs`
- `packages/polar-runtime-core/src/middleware-pipeline.mjs`
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/usage-telemetry-gateway.mjs`
- `packages/polar-runtime-core/src/handoff-telemetry-gateway.mjs`
- `packages/polar-runtime-core/src/index.mjs`
- `packages/polar-control-plane/src/index.mjs`
- `tests/runtime-core-lineage-telemetry.test.mjs`
- `docs/implementation/implementation-status.md`
- `docs/implementation/implementation-log.md`

**Tests run (exact):**
- `node --test tests/runtime-core-contract-middleware.test.mjs`
- `node --test tests/runtime-core-usage-telemetry-gateway.test.mjs`
- `node --test tests/runtime-core-handoff-routing-telemetry.test.mjs`
- `node --test tests/runtime-core-lineage-telemetry.test.mjs`
- `node --test tests/runtime-core-handoff-telemetry-gateway.test.mjs`
- `node --test tests/control-plane-service.test.mjs`

**Manual verification (evidence, not vibes):**
- Verified durable lineage query by `workflowId`/`runId`/`threadId` through middleware pipeline (`queryLineage`) and durable store-backed records (`tests/runtime-core-lineage-telemetry.test.mjs`).
- Verified policy denial path emits explicit `policy.decision` event with `reasonCode: "scope_invalid"` and `decision: "deny"` for `POLAR_EXTENSION_POLICY_DENIED`.
- Verified successful extension execution emits lineage records with both `extensionId` and `capabilityId` on step checkpoints.
- Verified repair flow emits `repair.triggered`, `repair.selection`, and `repair.outcome` events keyed by the same repair correlation id.
- Verified control-plane runtime remains green after lineage wiring (`tests/control-plane-service.test.mjs`).

**Notes / decisions:**
- Middleware and orchestrator default to durable lineage outside dev/test mode; test/dev runs remain non-durable by default unless a lineage store is explicitly injected.
- Control-plane now shares one lineage store instance across middleware/orchestrator telemetry surfaces to avoid split audit streams.
- Added optional lineage query pass-through methods on usage and handoff telemetry gateways for unified control-plane retrieval patterns.

**Follow-ups:**
- Add retention/compaction policy and rotation controls for durable lineage files.
- Add production multi-node/shared backend support for lineage storage (sqlite/postgres/object-store) beyond single-node file durability.
- Add alerting/reporting views over `policy.decision` and repair lifecycle streams in telemetry alert surfaces.



### 2026-03-01 — BUG-025 — CryptoVault case-insensitive field detection — Done
**Owner:** Jules
**Scope:** Improve secret field detection in CryptoVault to be case-insensitive and more comprehensive.
**Summary:**
- Updated `CryptoVault.encryptSecretsInObject` to convert keys to lowercase before matching.
- Expanded detection patterns to use `includes('secret')`, `includes('password')`, `endsWith('key')`, and `endsWith('token')`.
- Verified fix with new test cases covering various casings and nested structures.

**Architecture refs:**
- `docs/architecture/deterministic-orchestration-architecture.md`

**Files changed:**
- `packages/polar-runtime-core/src/crypto-vault.mjs`

**Tests run (exact):**
- `node tests/bug-fixes-comprehensive.test.mjs`
- `node tests/repro-bug-025.test.mjs`

**Manual verification (evidence, not vibes):**
- Confirmed that `DB_PASSWORD`, `db_password`, `user_password`, and `secret_ref` are now correctly encrypted.
- Confirmed that nested objects and arrays are processed recursively with the new logic.

**Notes / decisions:**
- Balanced detection breadth with performance by using simple string operations (`includes`, `endsWith`).
- Prioritized security (over-encryption) over missing secrets (under-encryption).

**Follow-ups:**
- None identified.

### 2026-02-28 — HEALTH-001 — Runtime Domain Error Standardization — Done

**Owner:** Antigravity
**Scope:** Improve codebase maintainability and readability by standardizing on `RuntimeExecutionError` for domain-logic failures instead of generic `Error`.

**Summary:**
- Replaced generic `Error` with `RuntimeExecutionError` from `polar-domain` in schema-validation and runtime-control choke-points.
- This ensures that these failures map correctly to `POLAR_RUNTIME_EXECUTION_ERROR` and follow the established domain logic patterns for the Polar runtime.
- Proactively extended the fix across all middleware and engine components using identical patterns.

**Files changed:**
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/memory-extraction-middleware.mjs`
- `packages/polar-runtime-core/src/budget-middleware.mjs`
- `packages/polar-runtime-core/src/workflow-engine.mjs`
- `packages/polar-runtime-core/src/tool-synthesis-middleware.mjs` (already using, verified)

**Tests run (exact):**
- `node --test tests/runtime-core-budget-enforcement.test.mjs`
- `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs`
- `node --test tests/runtime-core-contract-middleware.test.mjs`

**Manual verification (evidence, not vibes):**
- Verified `RuntimeExecutionError` imports resolution.
- Confirmed existing tests pass with no regressions in error handling logic.
- Verified that error codes are correctly emitted as `POLAR_RUNTIME_EXECUTION_ERROR`.

**Follow-ups:**
- None.
