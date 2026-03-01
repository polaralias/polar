# AUDIT-D: Extensibility (Skills install/registry, discovery, templates, multi-agent reuse)

Date: 2026-02-28  
Scope docs:
- `docs/architecture/skill-registry-and-installation.md`
- `docs/architecture/approvals-and-grants.md`
- `docs/architecture/deterministic-orchestration-architecture.md`

## Summary
- Implemented: SkillRegistry metadata/blocking flows, deterministic template expansion/validation, capability-scope enforcement with forwarded-skill clamping, and install/execution path test proving no runtime manifest regeneration.
- Partial: install-time proposal flow exists in runtime gateway but is not surfaced through control-plane API; capability projection source-of-truth is extension state, not SkillRegistry alone.
- Missing: explicit auto-composition artifacts (PlanSketch schema, composition rules/cache), and fully wired HITL approval gate before enable for all installs.

## 1) Agent Skills install lifecycle
- SkillRegistry exists and tracks proposed manifests, blocked installs, metadata overrides:
  - `packages/polar-runtime-core/src/skill-registry.mjs:9-171`
  - wired in control plane: `packages/polar-control-plane/src/index.mjs:172`
- Install-time analyzer/proposal flow exists:
  - `proposeManifest(...)`: `packages/polar-runtime-core/src/skill-installer-gateway.mjs:230-309`
  - proposal enforces MCP inventory references and sets `pending_install` lifecycle metadata:
  - `packages/polar-runtime-core/src/skill-installer-gateway.mjs:281-295`
- Metadata enforcement blocks enable/install when risk metadata is missing:
  - skill: `packages/polar-runtime-core/src/skill-installer-gateway.mjs:538-554`
  - MCP sync: `packages/polar-runtime-core/src/mcp-connector-gateway.mjs:659-675`
- Metadata completion requires explanation per capability:
  - `packages/polar-runtime-core/src/skill-registry.mjs:67-73`

Findings:
- `proposeManifest` is not exposed as a control-plane method; public service exposes `installSkill`/`syncMcpServer` only:
  - `packages/polar-control-plane/src/index.mjs:633-646`
- HITL-before-enable is partial: trusted installs may auto-enable via policy (`autoEnableTrusted`) and `enableAfterInstall` flags:
  - `packages/polar-runtime-core/src/skill-installer-gateway.mjs:618-640`

## 2) Capability discovery and allowlisting
- Delegation forwarding is clamped via server allowlist:
  - `packages/polar-runtime-core/src/capability-scope.mjs:9-33`
  - orchestrator uses this before activating delegation:
  - `packages/polar-runtime-core/src/orchestrator.mjs:585-594`
- Runtime capabilityScope projection derives from enabled installed extensions and allowlisted skills:
  - `packages/polar-runtime-core/src/capability-scope.mjs:85-119`
  - orchestrator passes `extensionGateway.listStates()` into projection:
  - `packages/polar-runtime-core/src/orchestrator.mjs:552-556`, `595-599`, `614-618`

Finding:
- Docs describe SkillRegistry as runtime source of truth; current execution scope projection is extension-state driven (SkillRegistry is used for metadata/blocked/proposal state).

## 3) Templates and workflow planning readiness
- Template registry is hard-coded and deterministic:
  - `packages/polar-runtime-core/src/workflow-templates.mjs:3-86`
- Workflow path uses deterministic parse/expand/validate:
  - parse `<polar_action>` only: `packages/polar-runtime-core/src/workflow-engine.mjs:8-25`
  - deterministic expansion: `packages/polar-runtime-core/src/workflow-engine.mjs:30-53`
  - step validation against scope: `packages/polar-runtime-core/src/workflow-engine.mjs:55-77`

Readiness gaps for safe auto-composed workflows:
1. No `PlanSketch` schema/contract found.
2. No composition constraint/rule engine found.
3. No composition cache/registry for generated workflow compositions found.

## 4) Multi-agent usage and privilege boundaries
- Sub-agent forwarded skills are intersected with allowlist and unknown requests are rejected/clamped:
  - `packages/polar-runtime-core/src/capability-scope.mjs:9-33`
  - `packages/polar-runtime-core/src/orchestrator.mjs:585-604`
- Delegated scope recomputation occurs after delegation change and after task completion:
  - `packages/polar-runtime-core/src/orchestrator.mjs:595-618`
- Install actions are not exposed as workflow templates by default (no install template in `WORKFLOW_TEMPLATES`), but direct control-plane methods exist:
  - templates: `packages/polar-runtime-core/src/workflow-templates.mjs:3-86`
  - control-plane methods: `packages/polar-control-plane/src/index.mjs:633-646`
  - web API allowlist currently includes install actions:
  - `packages/polar-web-ui/vite.config.js:45-46`

## 5) Tests run (exact)
- `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `node --test tests/runtime-core-capability-scope-enforcement.test.mjs`
- `node --test tests/runtime-core-orchestrator-delegation-scope.test.mjs`
- `node --test tests/runtime-core-workflow-template-enforcement.test.mjs`
- `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs`
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs` (fails)
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs` (fails)

New AUDIT-D test added:
- `tests/runtime-core-skill-registry-install-enforcement.test.mjs`
  - `runtime install/execute path never regenerates manifests via provider gateway`

Known failing suite evidence:
- Both failing suites abort with `POLAR_CONTRACT_REGISTRY_ERROR`:
  - `skill.install.analyze` contract metadata (`retryPolicy.maxAttempts` must be a positive integer)
  - observed in `tests/runtime-core-skill-installer-gateway.test.mjs` and `tests/runtime-core-skill-risk-enforcement.test.mjs`.

## 6) Gap list / follow-ups
1. Expose and gate install-time `proposeManifest` through control-plane/API with explicit HITL approval transition before enable.
2. Align runtime capability projection source-of-truth with SkillRegistry + policy (or update docs to match extension-state source).
3. Decide policy for direct install APIs in web control plane surfaces and restrict by role/environment.
4. Fix `skill.install.analyze` contract metadata so blocked skill installer/risk suites can run behavioral assertions.
5. Define and implement auto-composition safety artifacts (PlanSketch, constraints, composition cache/registry) before claiming composition readiness.
