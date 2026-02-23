import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createHandoffGateway,
  createMiddlewarePipeline,
  createRoutingPolicyEngine,
  registerHandoffContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupHandoffGateway({
  middleware = [],
  handoffExecutor,
  routingPolicyEngine,
  profileResolver,
  projectCapabilityScope,
} = {}) {
  const registry = createContractRegistry();
  registerHandoffContract(registry);

  const auditEvents = [];
  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const gateway = createHandoffGateway({
    middlewarePipeline: pipeline,
    handoffExecutor,
    routingPolicyEngine,
    profileResolver,
    projectCapabilityScope,
  });

  return {
    gateway,
    auditEvents,
  };
}

test("registerHandoffContract registers handoff contract once", () => {
  const registry = createContractRegistry();
  registerHandoffContract(registry);
  registerHandoffContract(registry);

  assert.deepEqual(registry.list(), ["agent.handoff.execute@1"]);
});

test("routing policy engine deterministically selects direct/delegate/fanout-fanin", async () => {
  const engine = createRoutingPolicyEngine();

  const direct = await engine.decide({
    sourceAgentId: "primary",
    reason: "simple question",
    payload: { q: "status" },
  });
  const delegate = await engine.decide({
    sourceAgentId: "primary",
    targetAgentId: "planner",
    reason: "specialized coding",
    payload: { q: "refactor" },
  });
  const fanout = await engine.decide({
    sourceAgentId: "primary",
    targetAgentIds: ["research", "writer"],
    reason: "parallel synthesis",
    payload: { q: "brief" },
  });

  assert.deepEqual(direct, { mode: "direct" });
  assert.deepEqual(delegate, { mode: "delegate", targetAgentId: "planner" });
  assert.deepEqual(fanout, {
    mode: "fanout-fanin",
    targetAgentIds: ["research", "writer"],
  });
});

test("routing policy engine applies resolved-profile handoff mode and fanout constraints", async () => {
  const engine = createRoutingPolicyEngine();

  const constrainedFanout = await engine.decide({
    sourceAgentId: "primary",
    targetAgentIds: ["research", "coder", "writer"],
    reason: "parallel synthesis",
    payload: { q: "brief" },
    resolvedProfileConfig: {
      allowedHandoffModes: ["fanout-fanin"],
      maxFanoutAgents: 2,
    },
  });

  const constrainedDelegate = await engine.decide({
    sourceAgentId: "primary",
    targetAgentIds: ["planner", "reviewer"],
    reason: "parallel synthesis",
    payload: { q: "brief" },
    resolvedProfileConfig: {
      allowedHandoffModes: ["delegate"],
    },
  });

  assert.deepEqual(constrainedFanout, {
    mode: "fanout-fanin",
    targetAgentIds: ["research", "coder"],
  });
  assert.deepEqual(constrainedDelegate, {
    mode: "delegate",
    targetAgentId: "planner",
  });
});

test("routing policy engine rejects preferred mode blocked by resolved profile policy", async () => {
  const engine = createRoutingPolicyEngine();

  await assert.rejects(
    async () =>
      engine.decide({
        sourceAgentId: "primary",
        preferredMode: "delegate",
        targetAgentId: "planner",
        reason: "delegate planning",
        payload: { task: "plan" },
        resolvedProfileConfig: {
          allowedHandoffModes: ["direct"],
        },
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.message.includes("Requested preferred handoff mode is not allowed"),
  );
});

test("handoff gateway enforces middleware path and fanout capability projection", async () => {
  const middlewareEvents = [];
  let executorInput = null;
  const { gateway, auditEvents } = setupHandoffGateway({
    middleware: [
      {
        id: "capture",
        before(context) {
          middlewareEvents.push(`before:${context.input.mode}`);
        },
        after(context) {
          middlewareEvents.push(`after:${context.output.status}`);
        },
      },
    ],
    async handoffExecutor(input) {
      executorInput = input;
      return {
        status: "completed",
        outputPayload: {
          delegatedTo: input.targetAgentIds,
          task: "fanout complete",
        },
      };
    },
  });

  const result = await gateway.execute({
    traceId: "trace-handoff-1",
    sourceAgentId: "primary",
    targetAgentIds: ["research", "coder", "writer"],
    reason: "parallel solve",
    sessionId: "session-1",
    userId: "user-1",
    capabilityScope: {
      allowedTools: ["search", "read_file", "write_file"],
      allowedExtensions: ["mcp.git", "skill.docs"],
      maxToolCalls: 9,
    },
    payload: {
      goal: "implement feature",
    },
  });

  assert.deepEqual(result, {
    status: "completed",
    mode: "fanout-fanin",
    sourceAgentId: "primary",
    targetAgentIds: ["research", "coder", "writer"],
    capabilityScope: {
      allowedTools: ["search", "read_file", "write_file"],
      allowedExtensions: ["mcp.git", "skill.docs"],
      maxToolCalls: 9,
      maxToolCallsPerAgent: 3,
      targetAgentIds: ["research", "coder", "writer"],
    },
    outputPayload: {
      delegatedTo: ["research", "coder", "writer"],
      task: "fanout complete",
    },
  });

  assert.deepEqual(executorInput, {
    mode: "fanout-fanin",
    sourceAgentId: "primary",
    targetAgentIds: ["research", "coder", "writer"],
    reason: "parallel solve",
    sessionId: "session-1",
    userId: "user-1",
    capabilityScope: {
      allowedTools: ["search", "read_file", "write_file"],
      allowedExtensions: ["mcp.git", "skill.docs"],
      maxToolCalls: 9,
      maxToolCallsPerAgent: 3,
      targetAgentIds: ["research", "coder", "writer"],
    },
    payload: {
      goal: "implement feature",
    },
  });

  assert.deepEqual(middlewareEvents, [
    "before:fanout-fanin",
    "after:completed",
  ]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "agent.handoff.execute" &&
        event.executionType === "handoff" &&
        event.traceId === "trace-handoff-1",
    ),
  );
});

test("handoff gateway returns deterministic failed payload when delegated execution throws", async () => {
  const { gateway } = setupHandoffGateway({
    async handoffExecutor() {
      throw new Error("sub-agent timed out");
    },
  });

  const result = await gateway.execute({
    traceId: "trace-handoff-2",
    sourceAgentId: "primary",
    targetAgentId: "planner",
    reason: "delegate planning",
    sessionId: "session-2",
    userId: "user-2",
    capabilityScope: {
      allowedTools: ["search"],
      maxToolCalls: 2,
    },
    payload: {
      task: "build rollout plan",
    },
  });

  assert.deepEqual(result, {
    status: "failed",
    mode: "delegate",
    sourceAgentId: "primary",
    targetAgentId: "planner",
    capabilityScope: {
      allowedTools: ["search"],
      allowedExtensions: [],
      maxToolCalls: 2,
      targetAgentId: "planner",
    },
    failure: {
      code: "POLAR_RUNTIME_EXECUTION_ERROR",
      message: "sub-agent timed out",
      details: {
        sourceAgentId: "primary",
        targetAgentId: "planner",
        targetAgentIds: [],
      },
      traceId: "trace-handoff-2",
    },
  });
});

test("handoff gateway rejects invalid delegate envelope before execution", async () => {
  const { gateway } = setupHandoffGateway({
    async handoffExecutor() {
      assert.fail("executor should not run");
    },
  });

  await assert.rejects(
    async () =>
      gateway.execute({
        sourceAgentId: "primary",
        preferredMode: "delegate",
        reason: "missing target agent",
        sessionId: "session-3",
        userId: "user-3",
        capabilityScope: {
          allowedTools: ["search"],
          maxToolCalls: 1,
        },
        payload: {
          task: "should fail",
        },
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("handoff gateway supports custom routing policy overrides", async () => {
  const routingPolicyEngine = createRoutingPolicyEngine({
    decide(request) {
      if (request.reason.includes("fanout")) {
        return {
          mode: "fanout-fanin",
          targetAgentIds: ["analyst", "writer"],
        };
      }

      return {
        mode: "direct",
      };
    },
  });

  const { gateway } = setupHandoffGateway({
    routingPolicyEngine,
    async handoffExecutor(input) {
      return {
        status: "completed",
        outputPayload: {
          mode: input.mode,
          targets: input.targetAgentIds,
        },
      };
    },
  });

  const result = await gateway.execute({
    sourceAgentId: "primary",
    reason: "run fanout review",
    sessionId: "session-4",
    userId: "user-4",
    capabilityScope: {
      allowedTools: ["search", "summarize"],
      maxToolCalls: 4,
    },
    payload: {
      task: "draft summary",
    },
  });

  assert.deepEqual(result, {
    status: "completed",
    mode: "fanout-fanin",
    sourceAgentId: "primary",
    targetAgentIds: ["analyst", "writer"],
    capabilityScope: {
      allowedTools: ["search", "summarize"],
      allowedExtensions: [],
      maxToolCalls: 4,
      maxToolCallsPerAgent: 2,
      targetAgentIds: ["analyst", "writer"],
    },
    outputPayload: {
      mode: "fanout-fanin",
      targets: ["analyst", "writer"],
    },
  });
});

test("handoff gateway resolves profile and projects delegated scope using profile constraints", async () => {
  const resolverRequests = [];
  let executorInput = null;
  const { gateway } = setupHandoffGateway({
    profileResolver: {
      async resolveProfile(request) {
        resolverRequests.push(request);
        return {
          status: "resolved",
          profileId: "profile.workspace",
          resolvedScope: "workspace",
          profileConfig: {
            allowedTools: ["search", "summarize"],
            allowedExtensions: ["skill.docs"],
            maxToolCalls: 2,
          },
        };
      },
    },
    async handoffExecutor(input) {
      executorInput = input;
      return {
        status: "completed",
        outputPayload: {
          delegated: true,
        },
      };
    },
  });

  const result = await gateway.execute({
    sourceAgentId: "primary",
    targetAgentId: "planner",
    reason: "delegate scoped plan",
    sessionId: "session-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    defaultProfileId: "profile.global",
    capabilityScope: {
      allowedTools: ["search", "read_file"],
      allowedExtensions: ["skill.docs", "mcp.git"],
      maxToolCalls: 5,
    },
    payload: {
      task: "plan release",
    },
  });

  assert.deepEqual(resolverRequests, [
    {
      sessionId: "session-1",
      workspaceId: "workspace-1",
      defaultProfileId: "profile.global",
      includeProfileConfig: true,
      allowDefaultFallback: true,
    },
  ]);
  assert.deepEqual(result, {
    status: "completed",
    mode: "delegate",
    sourceAgentId: "primary",
    targetAgentId: "planner",
    profileId: "profile.workspace",
    resolvedProfileScope: "workspace",
    capabilityScope: {
      allowedTools: ["search"],
      allowedExtensions: ["skill.docs"],
      maxToolCalls: 2,
      targetAgentId: "planner",
    },
    routingDiagnostics: {
      requestedMode: "delegate",
      resolvedMode: "delegate",
      requestedTargetCount: 1,
      resolvedTargetCount: 1,
      routeAdjusted: false,
      adjustmentReasons: [],
      profileResolution: {
        status: "resolved",
        profileId: "profile.workspace",
        resolvedScope: "workspace",
      },
    },
    outputPayload: {
      delegated: true,
    },
  });
  assert.deepEqual(executorInput, {
    mode: "delegate",
    sourceAgentId: "primary",
    targetAgentId: "planner",
    reason: "delegate scoped plan",
    sessionId: "session-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    profileId: "profile.workspace",
    defaultProfileId: "profile.global",
    resolvedProfileScope: "workspace",
    capabilityScope: {
      allowedTools: ["search"],
      allowedExtensions: ["skill.docs"],
      maxToolCalls: 2,
      targetAgentId: "planner",
    },
    routingDiagnostics: {
      requestedMode: "delegate",
      resolvedMode: "delegate",
      requestedTargetCount: 1,
      resolvedTargetCount: 1,
      routeAdjusted: false,
      adjustmentReasons: [],
      profileResolution: {
        status: "resolved",
        profileId: "profile.workspace",
        resolvedScope: "workspace",
      },
    },
    payload: {
      task: "plan release",
    },
  });
});

test("handoff gateway merges routing diagnostics into provided policy and trace contexts", async () => {
  let executorInput = null;
  const { gateway } = setupHandoffGateway({
    profileResolver: {
      async resolveProfile() {
        return {
          status: "resolved",
          profileId: "profile.workspace",
          resolvedScope: "workspace",
          profileConfig: {
            allowedHandoffModes: ["delegate"],
          },
        };
      },
    },
    async handoffExecutor(input) {
      executorInput = input;
      return {
        status: "completed",
        outputPayload: {
          delegated: true,
        },
      };
    },
  });

  const result = await gateway.execute({
    sourceAgentId: "primary",
    targetAgentId: "planner",
    reason: "delegate with context",
    sessionId: "session-context",
    workspaceId: "workspace-context",
    userId: "user-context",
    defaultProfileId: "profile.global",
    capabilityScope: {
      allowedTools: ["search"],
      maxToolCalls: 2,
    },
    payload: {
      task: "plan with context",
    },
    policyContext: {
      budgetPolicy: "strict",
    },
    traceMetadata: {
      origin: "orchestrator-v1",
    },
  });

  assert.equal(
    /** @type {Record<string, unknown>} */ (executorInput.policyContext)
      .budgetPolicy,
    "strict",
  );
  assert.equal(
    /** @type {Record<string, unknown>} */ (executorInput.traceMetadata).origin,
    "orchestrator-v1",
  );
  assert.equal(
    /** @type {Record<string, unknown>} */ (
      /** @type {Record<string, unknown>} */ (executorInput.policyContext)
        .handoffRouting
    ).resolvedMode,
    "delegate",
  );
  assert.equal(
    /** @type {Record<string, unknown>} */ (
      /** @type {Record<string, unknown>} */ (executorInput.traceMetadata)
        .handoffRouting
    ).requestedMode,
    "delegate",
  );
  assert.equal(
    /** @type {Record<string, unknown>} */ (result.routingDiagnostics)
      .resolvedMode,
    "delegate",
  );
});

test("handoff gateway applies resolved-profile routing constraints before fanout execution", async () => {
  const resolverRequests = [];
  let executorInput = null;
  const { gateway } = setupHandoffGateway({
    profileResolver: {
      async resolveProfile(request) {
        resolverRequests.push(request);
        return {
          status: "resolved",
          profileId: "profile.workspace",
          resolvedScope: "workspace",
          profileConfig: {
            allowedHandoffModes: ["fanout-fanin"],
            maxFanoutAgents: 2,
            allowedTools: ["search"],
            maxToolCalls: 4,
          },
        };
      },
    },
    async handoffExecutor(input) {
      executorInput = input;
      return {
        status: "completed",
        outputPayload: {
          delegatedTo: input.targetAgentIds,
        },
      };
    },
  });

  const result = await gateway.execute({
    sourceAgentId: "primary",
    targetAgentIds: ["research", "coder", "writer"],
    reason: "parallel solve",
    sessionId: "session-2",
    workspaceId: "workspace-2",
    userId: "user-2",
    defaultProfileId: "profile.global",
    capabilityScope: {
      allowedTools: ["search", "read_file"],
      maxToolCalls: 6,
    },
    payload: {
      task: "implement feature",
    },
  });

  assert.deepEqual(resolverRequests, [
    {
      sessionId: "session-2",
      workspaceId: "workspace-2",
      defaultProfileId: "profile.global",
      includeProfileConfig: true,
      allowDefaultFallback: true,
    },
  ]);
  assert.deepEqual(result, {
    status: "completed",
    mode: "fanout-fanin",
    sourceAgentId: "primary",
    targetAgentIds: ["research", "coder"],
    profileId: "profile.workspace",
    resolvedProfileScope: "workspace",
    capabilityScope: {
      allowedTools: ["search"],
      allowedExtensions: [],
      maxToolCalls: 4,
      maxToolCallsPerAgent: 2,
      targetAgentIds: ["research", "coder"],
    },
    routingDiagnostics: {
      requestedMode: "fanout-fanin",
      resolvedMode: "fanout-fanin",
      requestedTargetCount: 3,
      resolvedTargetCount: 2,
      routeAdjusted: true,
      adjustmentReasons: ["fanout_limited"],
      profileResolution: {
        status: "resolved",
        profileId: "profile.workspace",
        resolvedScope: "workspace",
      },
      profileRoutingConstraints: {
        allowedHandoffModes: ["fanout-fanin"],
        maxFanoutAgents: 2,
      },
    },
    outputPayload: {
      delegatedTo: ["research", "coder"],
    },
  });
  assert.deepEqual(executorInput, {
    mode: "fanout-fanin",
    sourceAgentId: "primary",
    targetAgentIds: ["research", "coder"],
    reason: "parallel solve",
    sessionId: "session-2",
    workspaceId: "workspace-2",
    userId: "user-2",
    profileId: "profile.workspace",
    defaultProfileId: "profile.global",
    resolvedProfileScope: "workspace",
    capabilityScope: {
      allowedTools: ["search"],
      allowedExtensions: [],
      maxToolCalls: 4,
      maxToolCallsPerAgent: 2,
      targetAgentIds: ["research", "coder"],
    },
    routingDiagnostics: {
      requestedMode: "fanout-fanin",
      resolvedMode: "fanout-fanin",
      requestedTargetCount: 3,
      resolvedTargetCount: 2,
      routeAdjusted: true,
      adjustmentReasons: ["fanout_limited"],
      profileResolution: {
        status: "resolved",
        profileId: "profile.workspace",
        resolvedScope: "workspace",
      },
      profileRoutingConstraints: {
        allowedHandoffModes: ["fanout-fanin"],
        maxFanoutAgents: 2,
      },
    },
    payload: {
      task: "implement feature",
    },
  });
});

test("handoff gateway can reroute delegated request to direct when profile policy allows only direct mode", async () => {
  const { gateway } = setupHandoffGateway({
    profileResolver: {
      async resolveProfile() {
        return {
          status: "resolved",
          profileId: "profile.workspace",
          resolvedScope: "workspace",
          profileConfig: {
            allowedHandoffModes: ["direct"],
          },
        };
      },
    },
    async handoffExecutor() {
      assert.fail("executor should not run when routing policy resolves to direct mode");
    },
  });

  const result = await gateway.execute({
    sourceAgentId: "primary",
    targetAgentId: "planner",
    reason: "delegate if allowed",
    sessionId: "session-3",
    workspaceId: "workspace-3",
    userId: "user-3",
    defaultProfileId: "profile.global",
    capabilityScope: {
      allowedTools: ["search"],
      maxToolCalls: 2,
    },
    payload: {
      task: "answer directly",
    },
  });

  assert.deepEqual(result, {
    status: "completed",
    mode: "direct",
    sourceAgentId: "primary",
    profileId: "profile.workspace",
    resolvedProfileScope: "workspace",
    capabilityScope: {
      allowedTools: [],
      allowedExtensions: [],
      maxToolCalls: 0,
    },
    routingDiagnostics: {
      requestedMode: "delegate",
      resolvedMode: "direct",
      requestedTargetCount: 1,
      resolvedTargetCount: 0,
      routeAdjusted: true,
      adjustmentReasons: ["mode_adjusted"],
      profileResolution: {
        status: "resolved",
        profileId: "profile.workspace",
        resolvedScope: "workspace",
      },
      profileRoutingConstraints: {
        allowedHandoffModes: ["direct"],
      },
    },
    outputPayload: {
      task: "answer directly",
    },
  });
});

test("handoff gateway returns typed failure when delegated profile cannot be resolved", async () => {
  const { gateway } = setupHandoffGateway({
    profileResolver: {
      async resolveProfile() {
        return {
          status: "not_found",
          reason: "No pinned profile available for session/workspace scope",
        };
      },
    },
    async handoffExecutor() {
      assert.fail("executor should not run when profile resolution fails");
    },
  });

  const result = await gateway.execute({
    traceId: "trace-handoff-profile-miss",
    sourceAgentId: "primary",
    targetAgentId: "planner",
    reason: "delegate with profile resolution",
    sessionId: "session-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    defaultProfileId: "profile.global",
    capabilityScope: {
      allowedTools: ["search"],
      maxToolCalls: 2,
    },
    payload: {
      task: "plan release",
    },
  });

  assert.deepEqual(result, {
    status: "failed",
    mode: "delegate",
    sourceAgentId: "primary",
    targetAgentId: "planner",
    capabilityScope: {
      allowedTools: ["search"],
      allowedExtensions: [],
      maxToolCalls: 2,
      targetAgentId: "planner",
    },
    routingDiagnostics: {
      requestedMode: "delegate",
      resolvedMode: "delegate",
      requestedTargetCount: 1,
      resolvedTargetCount: 1,
      routeAdjusted: false,
      adjustmentReasons: [],
      profileResolution: {
        status: "not_resolved",
        failure: {
          code: "POLAR_PROFILE_NOT_RESOLVED",
          message: "No pinned profile available for session/workspace scope",
          traceId: "trace-handoff-profile-miss",
        },
      },
    },
    failure: {
      code: "POLAR_PROFILE_NOT_RESOLVED",
      message: "No pinned profile available for session/workspace scope",
      traceId: "trace-handoff-profile-miss",
    },
  });
});
