import test from "node:test";
import assert from "node:assert/strict";

import {
  ContractValidationError,
} from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createHandoffGateway,
  createHandoffRoutingTelemetryCollector,
  createMiddlewarePipeline,
  registerHandoffContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupGatewayWithCollector({
  profileResolver,
  handoffExecutor,
  telemetryCollector,
} = {}) {
  const registry = createContractRegistry();
  registerHandoffContract(registry);

  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware: telemetryCollector
      ? [telemetryCollector.middleware]
      : [],
  });

  const gateway = createHandoffGateway({
    middlewarePipeline: pipeline,
    profileResolver,
    handoffExecutor,
  });

  return {
    gateway,
  };
}

test("handoff routing telemetry collector captures resolver-aware routing events and supports filtering", async () => {
  let nowMs = Date.parse("2026-02-23T12:00:00.000Z");
  const sinkEvents = [];
  const telemetryCollector = createHandoffRoutingTelemetryCollector({
    now: () => {
      nowMs += 1_000;
      return nowMs;
    },
    telemetrySink(event) {
      sinkEvents.push(event);
    },
  });

  const { gateway } = setupGatewayWithCollector({
    telemetryCollector,
    profileResolver: {
      async resolveProfile() {
        return {
          status: "resolved",
          profileId: "profile.workspace",
          resolvedScope: "workspace",
          profileConfig: {
            allowedHandoffModes: ["fanout-fanin", "direct"],
            maxFanoutAgents: 2,
          },
        };
      },
    },
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

  await gateway.execute({
    sourceAgentId: "primary",
    targetAgentIds: ["research", "coder", "writer"],
    reason: "parallel solve",
    sessionId: "session-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    defaultProfileId: "profile.global",
    capabilityScope: {
      allowedTools: ["search"],
      maxToolCalls: 6,
    },
    payload: {
      task: "implement feature",
    },
  });

  await gateway.execute({
    sourceAgentId: "primary",
    targetAgentId: "planner",
    reason: "delegate if allowed",
    sessionId: "session-2",
    workspaceId: "workspace-2",
    userId: "user-2",
    defaultProfileId: "profile.global",
    capabilityScope: {
      allowedTools: ["search"],
      maxToolCalls: 2,
    },
    payload: {
      task: "answer directly",
    },
    preferredMode: "direct",
  });

  const allEvents = telemetryCollector.listEvents();
  assert.deepEqual(allEvents.status, "ok");
  assert.equal(allEvents.returnedCount, 2);
  assert.equal(allEvents.totalCount, 2);
  assert.equal(allEvents.nextFromSequence, undefined);
  assert.equal(sinkEvents.length, 2);

  const fanoutOnly = telemetryCollector.listEvents({
    mode: "fanout-fanin",
  });
  assert.equal(fanoutOnly.returnedCount, 1);
  assert.equal(fanoutOnly.items[0].resolvedMode, "fanout-fanin");
  assert.equal(fanoutOnly.items[0].resolvedTargetCount, 2);
  assert.equal(fanoutOnly.items[0].routeAdjusted, true);
  assert.deepEqual(fanoutOnly.items[0].adjustmentReasons, ["fanout_limited"]);

  const adjustedOnly = telemetryCollector.listEvents({
    routeAdjustedOnly: true,
  });
  assert.equal(adjustedOnly.returnedCount, 1);
  assert.equal(adjustedOnly.items[0].sequence, 1);
});

test("handoff routing telemetry collector captures not_resolved profile diagnostics on failed delegated handoff", async () => {
  const telemetryCollector = createHandoffRoutingTelemetryCollector({
    now: () => Date.parse("2026-02-23T13:00:00.000Z"),
  });

  const { gateway } = setupGatewayWithCollector({
    telemetryCollector,
    profileResolver: {
      async resolveProfile() {
        return {
          status: "not_found",
          reason: "No profile pin",
        };
      },
    },
    async handoffExecutor() {
      assert.fail("executor should not run");
    },
  });

  const result = await gateway.execute({
    sourceAgentId: "primary",
    targetAgentId: "planner",
    reason: "delegate with profile resolution",
    sessionId: "session-miss",
    workspaceId: "workspace-miss",
    userId: "user-miss",
    defaultProfileId: "profile.global",
    capabilityScope: {
      allowedTools: ["search"],
      maxToolCalls: 1,
    },
    payload: {
      task: "plan",
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failure.code, "POLAR_PROFILE_NOT_RESOLVED");

  const events = telemetryCollector.listEvents({
    profileResolutionStatus: "not_resolved",
  });
  assert.equal(events.returnedCount, 1);
  assert.equal(events.items[0].status, "failed");
  assert.equal(events.items[0].requestedMode, "delegate");
  assert.equal(events.items[0].resolvedMode, "delegate");
  assert.equal(events.items[0].profileResolutionStatus, "not_resolved");
});

test("handoff routing telemetry collector list request is strictly validated", () => {
  const telemetryCollector = createHandoffRoutingTelemetryCollector();

  assert.throws(
    () =>
      telemetryCollector.listEvents({
        mode: "invalid-mode",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("handoff routing telemetry sink failures fail closed through middleware", async () => {
  const telemetryCollector = createHandoffRoutingTelemetryCollector({
    telemetrySink() {
      throw new Error("telemetry sink offline");
    },
  });
  const { gateway } = setupGatewayWithCollector({
    telemetryCollector,
  });

  await assert.rejects(
    async () =>
      gateway.execute({
        sourceAgentId: "primary",
        reason: "direct with explicit profile",
        sessionId: "session-direct",
        userId: "user-direct",
        profileId: "profile.session",
        capabilityScope: {
          allowedTools: ["search"],
          maxToolCalls: 1,
        },
        payload: {
          task: "echo",
        },
      }),
    (error) =>
      error.code === "POLAR_MIDDLEWARE_EXECUTION_ERROR" &&
      error.details.stage === "after",
  );
});
