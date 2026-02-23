import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createHandoffGateway,
  createHandoffRoutingTelemetryCollector,
  createHandoffRoutingTelemetryGateway,
  createMiddlewarePipeline,
  registerHandoffContract,
  registerHandoffRoutingTelemetryContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupTelemetryGateway({
  middleware = [],
  telemetrySink,
} = {}) {
  const contractRegistry = createContractRegistry();
  registerHandoffContract(contractRegistry);
  registerHandoffRoutingTelemetryContract(contractRegistry);

  const telemetryCollector = createHandoffRoutingTelemetryCollector({
    telemetrySink,
  });

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware: [...middleware, telemetryCollector.middleware],
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const handoffGateway = createHandoffGateway({
    middlewarePipeline,
    profileResolver: {
      async resolveProfile() {
        return {
          status: "resolved",
          profileId: "profile.workspace",
          resolvedScope: "workspace",
          profileConfig: {
            allowedHandoffModes: ["fanout-fanin"],
            maxFanoutAgents: 2,
          },
        };
      },
    },
    async handoffExecutor(input) {
      return {
        status: "completed",
        outputPayload: {
          targets: input.targetAgentIds,
        },
      };
    },
  });

  const telemetryGateway = createHandoffRoutingTelemetryGateway({
    middlewarePipeline,
    telemetryCollector,
  });

  return {
    handoffGateway,
    telemetryGateway,
    telemetryCollector,
    auditEvents,
  };
}

test("registerHandoffRoutingTelemetryContract registers contract once", () => {
  const contractRegistry = createContractRegistry();
  registerHandoffRoutingTelemetryContract(contractRegistry);
  registerHandoffRoutingTelemetryContract(contractRegistry);

  assert.deepEqual(contractRegistry.list(), ["agent.handoff.routing-telemetry.list@1"]);
});

test("handoff telemetry gateway lists collected events through middleware and contracts", async () => {
  const middlewareEvents = [];
  const { handoffGateway, telemetryGateway, auditEvents } = setupTelemetryGateway({
    middleware: [
      {
        id: "capture",
        before(context) {
          if (context.actionId === "agent.handoff.routing-telemetry.list") {
            middlewareEvents.push("before:list");
          }
        },
        after(context) {
          if (context.actionId === "agent.handoff.routing-telemetry.list") {
            middlewareEvents.push(`after:${context.output.status}`);
          }
        },
      },
    ],
  });

  await handoffGateway.execute({
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

  const listed = await telemetryGateway.listRoutingTelemetry({
    traceId: "trace-handoff-telemetry-list-1",
    routeAdjustedOnly: true,
    sessionId: "session-1",
    workspaceId: "workspace-1",
    sourceAgentId: "primary",
    status: "completed",
  });

  assert.deepEqual(listed, {
    status: "ok",
    fromSequence: 1,
    returnedCount: 1,
    totalCount: 1,
    items: [
      {
        sequence: 1,
        timestamp: listed.items[0].timestamp,
        traceId: listed.items[0].traceId,
        actionId: "agent.handoff.execute",
        version: 1,
        sourceAgentId: "primary",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        targetAgentIds: ["research", "coder"],
        status: "completed",
        requestedMode: "fanout-fanin",
        resolvedMode: "fanout-fanin",
        requestedTargetCount: 3,
        resolvedTargetCount: 2,
        routeAdjusted: true,
        adjustmentReasons: ["fanout_limited"],
        profileResolutionStatus: "resolved",
        profileId: "profile.workspace",
        profileResolvedScope: "workspace",
      },
    ],
  });
  assert.deepEqual(middlewareEvents, ["before:list", "after:ok"]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "agent.handoff.routing-telemetry.list" &&
        event.traceId === "trace-handoff-telemetry-list-1",
    ),
  );
});

test("handoff telemetry gateway rejects invalid list request shapes", async () => {
  const { telemetryGateway } = setupTelemetryGateway();

  await assert.rejects(
    async () =>
      telemetryGateway.listRoutingTelemetry({
        fromSequence: 0,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      telemetryGateway.listRoutingTelemetry({
        status: "not-a-status",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("handoff telemetry gateway constructor validates telemetry collector shape", () => {
  const contractRegistry = createContractRegistry();
  registerHandoffRoutingTelemetryContract(contractRegistry);

  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
  });

  assert.throws(
    () =>
      createHandoffRoutingTelemetryGateway({
        middlewarePipeline,
        telemetryCollector: /** @type {unknown} */ ({ listEvents: 1 }),
      }),
    (error) =>
      error instanceof Error &&
      error.message.includes("telemetryCollector must expose listEvents"),
  );
});
