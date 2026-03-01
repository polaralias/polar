# AUDIT-B: Security & Policy Enforcement End-to-End

Date: 2026-02-28  
Scope docs:
- `docs/architecture/deterministic-orchestration-architecture.md`
- `docs/architecture/approvals-and-grants.md`
- `docs/architecture/skill-registry-and-installation.md`
- `docs/architecture/chat-routing-and-multi-agent.md`

## Summary
- Implemented: deterministic template validation, capability-scope enforcement, plan approvals/grants, delegation skill/model clamping, and install-time skill metadata blocking.
- Partial: policy/approval enforcement is strong on orchestrated chat paths, but direct `controlPlane.executeExtension(...)` relies on optional policy wiring.
- Missing/at-risk: schema-less model JSON parses in several middleware/install paths; skill analyzer contract registration is currently broken by missing retry policy metadata.

## 1) Enforcement choke points
- Tool execution entry points found:
  - `packages/polar-runtime-core/src/orchestrator.mjs:616` (`extensionGateway.execute(...)`)
  - `packages/polar-control-plane/src/index.mjs:610` (`executeExtension(...) -> extensionGateway.execute(...)`)
- Runtime execution path is centralized in `ExtensionGateway` adapter dispatch:
  - `packages/polar-runtime-core/src/extension-gateway.mjs:580`
- Policy evaluation points:
  - execution: `packages/polar-runtime-core/src/extension-gateway.mjs:532-535`
  - install/sync: `packages/polar-runtime-core/src/skill-installer-gateway.mjs:474-498`, `packages/polar-runtime-core/src/plugin-installer-gateway.mjs:672-685`, `packages/polar-runtime-core/src/mcp-connector-gateway.mjs:681-694`
- Non-empty capability scope enforcement is explicit:
  - `packages/polar-runtime-core/src/extension-gateway.mjs:502-511`

Finding:
- `controlPlane.executeExtension(...)` is a direct execution path that bypasses orchestrator risk-tier approval logic. It still goes through `ExtensionGateway`, but approval behavior depends on whether `extensionPolicy.evaluateExecution` is configured (`packages/polar-control-plane/src/index.mjs:173-179`, `packages/polar-runtime-core/src/extension-gateway.mjs:532-535`).

## 2) Contract/schema enforcement
- Template and workflow validation are deterministic in code:
  - `packages/polar-runtime-core/src/workflow-engine.mjs:8-25` (`<polar_action>` parsing, unknown template reject)
  - `packages/polar-runtime-core/src/workflow-engine.mjs:30-43` (required args reject)
  - `packages/polar-runtime-core/src/workflow-engine.mjs:55-77` (step validation against `capabilityScope`)
- Tool input/output contracts are enforced by middleware pipeline:
  - `packages/polar-runtime-core/src/middleware-pipeline.mjs:413-426` (input validation)
  - `packages/polar-runtime-core/src/middleware-pipeline.mjs:511-520` (output validation)
- Invalid/unknown capability execution is rejected by scope policy:
  - `packages/polar-runtime-core/src/extension-gateway.mjs:517-525`
  - test evidence: `tests/runtime-core-capability-scope-enforcement.test.mjs:88-127`

Red flags (parsing without full schema validation):
- `packages/polar-runtime-core/src/orchestrator.mjs:382` (`<thread_state>` parse is allowlisted but not schema-validated)
- `packages/polar-runtime-core/src/skill-installer-gateway.mjs:269` (LLM proposed manifest parse with basic checks)
- `packages/polar-runtime-core/src/tool-synthesis-middleware.mjs:46`
- `packages/polar-runtime-core/src/memory-extraction-middleware.mjs:40`

## 3) Approvals/grants enforcement
- ApprovalStore checks are orchestrator-owned in plan generation:
  - `packages/polar-runtime-core/src/orchestrator.mjs:116-130` (`checkGrants(...)` -> `approvalStore.findMatchingGrant(...)`)
- Read actions auto-run:
  - test evidence: `packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs:100-110`
- Write-external requires approval/grant:
  - test evidence: `packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs:123-135`
- Destructive requires explicit approval each run by default:
  - code: `packages/polar-runtime-core/src/orchestrator.mjs:118-121`, `487-490`
  - test: `packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs:170-193`
- Plan approval applies to multi-step workflows (single approval, no per-step prompts):
  - test evidence: `packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs:195-244`
- “proposal for every read tool” behavior is not present:
  - read workflow auto-runs in tests (`packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs:100-110`)

Gap:
- Data egress (`dataEgress: network`) is included in risk aggregation (`packages/polar-runtime-core/src/orchestrator.mjs:86-95`) but is not forced to per-action approval by default; reusable grants can still satisfy it.

## 4) Skill registry and metadata enforcement
- Missing risk metadata blocks enable/install:
  - `packages/polar-runtime-core/src/skill-installer-gateway.mjs:538-556`
  - `packages/polar-runtime-core/src/mcp-connector-gateway.mjs:659-677`
- Metadata completion requires explanation per capability:
  - `packages/polar-runtime-core/src/skill-registry.mjs:67-73`
- Capability scope projection uses installed extensions + allowlist, not prompt strings:
  - `packages/polar-runtime-core/src/capability-scope.mjs:85-119`
  - test evidence: `tests/runtime-core-skill-registry-install-enforcement.test.mjs:195-235`

Gaps:
- Docs say SkillRegistry is runtime source of truth; current projection uses `installedExtensions` from `extensionGateway.listStates()` (registry used mainly for metadata/blocking), so this is partial alignment.
- Runtime does not hard-block unknown-risk execution in `extension-gateway` itself if a capability reaches enabled state with unknown metadata via non-skill paths.

## 5) Delegation and privilege escalation
- Forwarded skills are clamped as untrusted input:
  - `packages/polar-runtime-core/src/orchestrator.mjs:585-594`
- Model override is clamped by allowlist:
  - `packages/polar-runtime-core/src/orchestrator.mjs:586`
  - `packages/polar-runtime-core/src/capability-scope.mjs:44-74`
- Delegation activation is logged as deterministic system event:
  - `packages/polar-runtime-core/src/orchestrator.mjs:606`
- Sub-agent cannot execute non-forwarded capability after delegation scope projection:
  - enforced by `extension-gateway` scope checks (`packages/polar-runtime-core/src/extension-gateway.mjs:517-525`)
  - test evidence added: `tests/runtime-core-orchestrator-workflow-validation.test.mjs:214-404`

## 6) Tests run (exact)
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
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs` (fail: `POLAR_CONTRACT_REGISTRY_ERROR`, `skill.install.analyze`)
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs` (fail: `POLAR_CONTRACT_REGISTRY_ERROR`, `skill.install.analyze`)
- `node --test packages/polar-runtime-core/tests/skill-installer-analyzer.test.mjs` (fail: `describe is not defined`)

## 7) Added test coverage in this audit
- Added `tests/runtime-core-orchestrator-workflow-validation.test.mjs:214-404`
  - Verifies unauthorized `forward_skills` are stripped and logged in `[DELEGATION ACTIVE]`.
  - Verifies delegated sub-agent attempt to use non-forwarded tool is blocked by scope (`POLAR_EXTENSION_POLICY_DENIED`), with adapter not called.

## 8) Additional fix made during audit
- Fixed orchestrator crash when failed tool outputs are structured objects (not strings):
  - `packages/polar-runtime-core/src/orchestrator.mjs:511-519`, `641`, `664`
  - Ensures deterministic failure handling instead of `.slice()` runtime crash on object payloads.
