# Implementation Finalization Plan (Agent-Chunked)
Last updated: 2026-02-28

This plan converts the audit outputs into deterministic execution chunks that agents can run over long sessions without losing context.

## Scope and success criteria
Finalization means all of the following are true:
1. Known contract blocker is fixed and blocked suites are green.
2. Routing/repair/approval behavior matches deterministic architecture docs in code, not prompts.
3. Extension install/enable lifecycle is explicitly policy- and HITL-governed.
4. Audit/telemetry lineage is durable and queryable by `workflowId`, `runId`, and `threadId`.
5. Product/ops docs match runtime reality and release gates are evidence-based.

## Baseline evidence refresh (2026-02-28)
Focused verification run before writing this plan:
- Failing (known blocker):
  - `node --test tests/control-plane-service.test.mjs`
  - `node --test tests/runtime-core-skill-installer-gateway.test.mjs`
  - `node --test tests/runtime-core-skill-risk-enforcement.test.mjs`
- Passing:
  - `node --test tests/runtime-core-open-loops-repair.test.mjs`
  - `node --test tests/runtime-core-extension-gateway.test.mjs`
  - `node --test tests/runtime-core-contract-middleware.test.mjs`

Failure signature remains unchanged:
- `POLAR_CONTRACT_REGISTRY_ERROR` on `skill.install.analyze` due to invalid `retryPolicy.maxAttempts`.

## Execution order (dependency-safe)
1. `F0` is mandatory first (unblocks core test surfaces).
2. `F1` and `F2` can run in parallel after `F0`.
3. `F3` depends on `F0` and should follow `F2`.
4. `F4` depends on `F2` (policy decisions) and can overlap late `F3`.
5. `F5` depends on `F4` interfaces for telemetry validation.
6. `F6` is final and only closes after previous chunks are verified.

## Chunk tracker
| Chunk | Theme | Status | Primary refs |
| --- | --- | --- | --- |
| F0 | Contract blocker + test harness restore | Not Started | `docs/implementation/AUDIT-A-architecture-reality.md`, `docs/implementation/AUDIT-D-extensibility.md` |
| F1 | Chat UX closure (inline anchor + web repair flow) | Not Started | `docs/implementation/AUDIT-C-chat-ux.md`, `docs/architecture/deterministic-orchestration-architecture.md` |
| F2 | Policy/approval choke-point hardening | Not Started | `docs/implementation/AUDIT-B-security-policy.md`, `docs/architecture/approvals-and-grants.md` |
| F3 | Extension lifecycle and registry authority alignment | Not Started | `docs/implementation/AUDIT-D-extensibility.md`, `docs/architecture/skill-registry-and-installation.md` |
| F4 | Durable lineage + repair/policy telemetry | Not Started | `docs/implementation/AUDIT-E-ops-observability.md`, `docs/architecture/runtime-topology.md` |
| F5 | Reliability envelopes + drill automation | Not Started | `docs/implementation/AUDIT-E-ops-observability.md`, `docs/operations/incident-response-and-drills.md` |
| F6 | Docs alignment + release gate closure | Not Started | `docs/implementation/implementation-status.md`, `docs/operations/quality-and-safety.md` |

## Chunk definitions

### F0 - Fix contract blocker and restore blocked suites
Objective:
- Repair `skill.install.analyze` contract registration so integration suites execute.

Primary code targets:
- `packages/polar-runtime-core/src/skill-installer-gateway.mjs`
- `packages/polar-runtime-core/src/contract-registry.mjs`

Required tests:
- `node --test tests/control-plane-service.test.mjs`
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs`
- `node --test tests/runtime-core-skill-risk-enforcement.test.mjs`

Done criteria:
1. All three suites pass.
2. No new contract registry errors.
3. `implementation-status.md` risk #1 updated with evidence.

### F1 - Close deterministic chat UX gaps
Objective:
- Enforce strict inline anchor behavior and add web repair selection parity.

Primary code targets:
- `packages/polar-bot-runner/src/index.mjs`
- `packages/polar-web-ui/src/views/chat.js`
- `packages/polar-web-ui/vite.config.js`

Required tests:
- `node --test tests/channels-thin-client-enforcement.test.mjs`
- `node --test tests/runtime-core-open-loops-repair.test.mjs`
- Add/execute adapter/UI tests for:
  - invalid anchor -> non-inline response
  - web `repair_question` A/B selection -> `handleRepairSelection`

Done criteria:
1. Telegram does not fallback to current message when anchor is invalid.
2. Web supports deterministic repair selection path end-to-end.
3. Routing behavior remains code-owned and tested.

### F2 - Harden policy and approval choke points
Objective:
- Remove bypass risk where direct control-plane execution can diverge from orchestrated approval semantics.

Primary code targets:
- `packages/polar-control-plane/src/index.mjs`
- `packages/polar-runtime-core/src/extension-gateway.mjs`
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/tool-synthesis-middleware.mjs`
- `packages/polar-runtime-core/src/memory-extraction-middleware.mjs`

Required tests:
- `node --test tests/runtime-core-extension-gateway.test.mjs`
- `node --test packages/polar-runtime-core/tests/orchestrator-plan-approvals.test.mjs`
- `node --test tests/runtime-core-orchestrator-workflow-validation.test.mjs`
- Add tests for control-plane direct execution approval semantics.

Done criteria:
1. Direct execution and orchestrated execution share enforceable approval/policy behavior.
2. JSON model parses for runtime control data are schema-validated.
3. No new policy bypass path is introduced.

### F3 - Align extension lifecycle and capability authority
Objective:
- Make install lifecycle explicitly pending/reviewed/enabled and align capability projection authority with architecture.

Primary code targets:
- `packages/polar-runtime-core/src/skill-installer-gateway.mjs`
- `packages/polar-runtime-core/src/skill-registry.mjs`
- `packages/polar-runtime-core/src/capability-scope.mjs`
- `packages/polar-control-plane/src/index.mjs`

Required tests:
- `node --test tests/runtime-core-skill-installer-gateway.test.mjs`
- `node --test tests/runtime-core-skill-registry-install-enforcement.test.mjs`
- `node --test tests/runtime-core-capability-scope-enforcement.test.mjs`
- Add tests for manifest proposal + HITL transition APIs.

Done criteria:
1. Install proposal/review/enable lifecycle is explicit in control-plane APIs.
2. Runtime scope projection source-of-truth is clearly unified (or docs are explicitly revised with tests).
3. Auto-enable behavior is policy-governed and auditable.

### F4 - Deliver durable lineage and repair/policy telemetry
Objective:
- Produce immutable, queryable execution lineage and explicit repair/policy decision events.

Primary code targets:
- `packages/polar-runtime-core/src/middleware-pipeline.mjs`
- `packages/polar-runtime-core/src/orchestrator.mjs`
- `packages/polar-runtime-core/src/usage-telemetry-gateway.mjs`
- `packages/polar-runtime-core/src/handoff-routing-telemetry-gateway.mjs`
- durable store module(s) in `packages/polar-runtime-core/src/`

Required tests:
- `node --test tests/runtime-core-contract-middleware.test.mjs`
- `node --test tests/runtime-core-usage-telemetry-gateway.test.mjs`
- `node --test tests/runtime-core-handoff-routing-telemetry.test.mjs`
- Add tests for:
  - repair trigger/selection/outcome event emission
  - policy decision events with reason codes
  - durable lineage query by `workflowId/runId/threadId`

Done criteria:
1. Audit sink is durable by default outside dev mode.
2. Step-level logs include both `extensionId` and `capabilityId`.
3. Repair and policy decisions are first-class telemetry events.

### F5 - Add reliability envelopes and drill automation
Objective:
- Standardize timeout/cancellation/rate-limit controls and make drills executable.

Primary code targets:
- `packages/polar-adapter-native/src/index.mjs`
- `packages/polar-runtime-core/src/extension-gateway.mjs`
- ingress gateway modules under `packages/polar-runtime-core/src/`
- new drill harness scripts under `scripts/` or `tests/`

Required tests:
- `node --test tests/runtime-core-provider-gateway.test.mjs`
- `node --test tests/runtime-core-scheduler-gateway.test.mjs`
- `node --test tests/runtime-core-scheduler-state-store-sqlite.test.mjs`
- Add drill automation tests/scenarios for:
  - provider blackout failover
  - audit/store degradation behavior
  - multi-agent loop panic containment

Done criteria:
1. Provider and extension executions enforce consistent timeouts.
2. Server-side ingress rate limiting/backoff exists and is tested.
3. Drill scenarios are repeatable with pass/fail criteria.

### F6 - Close doc drift and release gates
Objective:
- Bring product/ops docs in line with implemented behavior and freeze evidence-based release gates.

Primary doc targets:
- `docs/product/ai-assistant.md`
- `docs/product/web-ui-and-chat-management.md`
- `docs/extensions/skills-mcp-plugins.md`
- `docs/architecture/llm-providers.md`
- `docs/implementation/implementation-status.md`

Required checks:
- Re-run all chunk-level required suites from `F0` to `F5`.
- Confirm `docs/implementation/implementation-log.md` has append-only evidence entries for each chunk.

Done criteria:
1. No known high-severity doc drift remains for core runtime behavior.
2. Release gate checklist links to concrete tests and runtime evidence.
3. Final status matrix reflects actual code state with no unsupported completion claims.

## Agent execution protocol (long-run safe)
For each chunk:
1. Read chunk refs first and copy acceptance criteria into working notes.
2. Implement smallest deterministic change-set that satisfies one chunk objective.
3. Run the chunk's required tests before moving to next chunk.
4. Update:
   - `docs/implementation/implementation-status.md` (status deltas)
   - `docs/implementation/implementation-log.md` (append-only evidence)
5. If blocked, append a `Blocked` log entry with exact error signature and file pointer, then stop at chunk boundary.

This keeps execution resumable across agent handoffs without relying on prompt memory.
