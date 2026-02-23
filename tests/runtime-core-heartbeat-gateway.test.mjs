import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createHeartbeatGateway,
  createMiddlewarePipeline,
  registerHeartbeatContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupHeartbeatGateway({
  heartbeatExecutor = {},
  profileResolver = {},
  middleware = [],
} = {}) {
  const contractRegistry = createContractRegistry();
  registerHeartbeatContract(contractRegistry);

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const gateway = createHeartbeatGateway({
    middlewarePipeline,
    heartbeatExecutor,
    profileResolver,
  });

  return {
    gateway,
    auditEvents,
  };
}

function createBaseRequest(overrides = {}) {
  return {
    policyId: "policy-1",
    profileId: "profile-default",
    runId: "run-1",
    trigger: "schedule",
    timestampMs: Date.UTC(2026, 1, 22, 12, 0, 0),
    cadenceMinutes: 30,
    deliveryRule: "ok",
    activeCheckIds: ["check.tasks"],
    ...overrides,
  };
}

test("registerHeartbeatContract registers heartbeat contract once", () => {
  const contractRegistry = createContractRegistry();
  registerHeartbeatContract(contractRegistry);
  registerHeartbeatContract(contractRegistry);

  assert.deepEqual(contractRegistry.list(), ["heartbeat.tick.execute@1"]);
});

test("heartbeat tick executes through middleware and defaults to local model lane", async () => {
  const middlewareEvents = [];
  const { gateway, auditEvents } = setupHeartbeatGateway({
    heartbeatExecutor: {
      async runChecks(request) {
        return {
          completed: request.checkIds,
        };
      },
    },
    middleware: [
      {
        id: "capture",
        before(context) {
          middlewareEvents.push(`before:${context.executionType}`);
        },
        after(context) {
          middlewareEvents.push(`after:${context.output.status}`);
        },
      },
    ],
  });

  const result = await gateway.tick(
    createBaseRequest({
      traceId: "trace-heartbeat-1",
    }),
  );

  assert.deepEqual(result, {
    status: "executed",
    policyId: "policy-1",
    profileId: "profile-default",
    runId: "run-1",
    trigger: "schedule",
    selectedModelLane: "local",
    escalationApplied: false,
    checkCount: 1,
    deliveryRule: "ok",
    executionPlan: {
      checkIds: ["check.tasks"],
      forceRun: false,
      selectedModelLane: "local",
      escalationApplied: false,
    },
    outcome: {
      completed: ["check.tasks"],
    },
  });

  assert.deepEqual(middlewareEvents, ["before:heartbeat", "after:executed"]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "heartbeat.tick.execute" &&
        event.traceId === "trace-heartbeat-1",
    ),
  );
});

test("heartbeat tick escalates to worker lane when failure threshold is reached", async () => {
  const { gateway } = setupHeartbeatGateway({
    heartbeatExecutor: {
      async runChecks(request) {
        return {
          lane: request.selectedModelLane,
        };
      },
    },
  });

  const result = await gateway.tick(
    createBaseRequest({
      escalationEnabled: true,
      escalationFailureThreshold: 2,
      recentFailureCount: 2,
      escalationTargetLane: "worker",
    }),
  );

  assert.equal(result.status, "executed");
  assert.equal(result.selectedModelLane, "worker");
  assert.equal(result.escalationApplied, true);
  assert.deepEqual(result.outcome, { lane: "worker" });
});

test("heartbeat tick skips when policy is inactive", async () => {
  const { gateway } = setupHeartbeatGateway();

  const result = await gateway.tick(
    createBaseRequest({
      active: false,
    }),
  );

  assert.deepEqual(result, {
    status: "skipped",
    policyId: "policy-1",
    profileId: "profile-default",
    runId: "run-1",
    trigger: "schedule",
    selectedModelLane: "local",
    escalationApplied: false,
    checkCount: 1,
    deliveryRule: "ok",
    skipReason: "policy_inactive",
    executionPlan: {
      checkIds: ["check.tasks"],
      forceRun: false,
    },
  });
});

test("heartbeat tick skips when outside active-hour window", async () => {
  const { gateway } = setupHeartbeatGateway();

  const result = await gateway.tick(
    createBaseRequest({
      timestampMs: Date.UTC(2026, 1, 22, 3, 0, 0),
      activeFromHourUtc: 8,
      activeToHourUtc: 18,
    }),
  );

  assert.deepEqual(result, {
    status: "skipped",
    policyId: "policy-1",
    profileId: "profile-default",
    runId: "run-1",
    trigger: "schedule",
    selectedModelLane: "local",
    escalationApplied: false,
    checkCount: 1,
    deliveryRule: "ok",
    skipReason: "outside_active_hours",
    executionPlan: {
      checkIds: ["check.tasks"],
      forceRun: false,
      activeWindow: {
        fromHourUtc: 8,
        toHourUtc: 18,
      },
    },
  });
});

test("heartbeat tick skips on queue backpressure and budget limit", async () => {
  const { gateway } = setupHeartbeatGateway();

  const queueSkipped = await gateway.tick(
    createBaseRequest({
      queueDepth: 10,
      queueMaxDepth: 5,
    }),
  );
  assert.equal(queueSkipped.status, "skipped");
  assert.equal(queueSkipped.skipReason, "queue_backpressure");

  const budgetSkipped = await gateway.tick(
    createBaseRequest({
      remainingBudgetUsd: 0.01,
      estimatedRunCostUsd: 0.1,
    }),
  );
  assert.equal(budgetSkipped.status, "skipped");
  assert.equal(budgetSkipped.skipReason, "budget_exceeded");
});

test("heartbeat tick forceRun bypasses skip gates", async () => {
  const { gateway } = setupHeartbeatGateway({
    heartbeatExecutor: {
      async runChecks() {
        return {
          ran: true,
        };
      },
    },
  });

  const result = await gateway.tick(
    createBaseRequest({
      active: false,
      activeCheckIds: [],
      queueDepth: 10,
      queueMaxDepth: 1,
      remainingBudgetUsd: 0,
      estimatedRunCostUsd: 1,
      forceRun: true,
    }),
  );

  assert.equal(result.status, "executed");
  assert.deepEqual(result.outcome, { ran: true });
});

test("heartbeat tick resolves profile when profileId is omitted", async () => {
  const resolverRequests = [];
  const { gateway } = setupHeartbeatGateway({
    profileResolver: {
      async resolveProfile(request) {
        resolverRequests.push(request);
        return {
          status: "resolved",
          profileId: "profile.workspace",
          resolvedScope: "workspace",
        };
      },
    },
    heartbeatExecutor: {
      async runChecks(request) {
        return {
          profileId: request.profileId,
        };
      },
    },
  });

  const tickRequest = createBaseRequest({
    sessionId: "session-1",
    workspaceId: "workspace-1",
    defaultProfileId: "profile.global",
  });
  delete tickRequest.profileId;

  const result = await gateway.tick(tickRequest);

  assert.deepEqual(resolverRequests, [
    {
      sessionId: "session-1",
      workspaceId: "workspace-1",
      defaultProfileId: "profile.global",
      includeProfileConfig: false,
      allowDefaultFallback: true,
    },
  ]);
  assert.equal(result.status, "executed");
  assert.equal(result.profileId, "profile.workspace");
  assert.equal(result.resolvedProfileScope, "workspace");
  assert.deepEqual(result.outcome, {
    profileId: "profile.workspace",
  });
});

test("heartbeat tick skips with profile_not_resolved when profile is unavailable", async () => {
  const { gateway } = setupHeartbeatGateway({
    profileResolver: {
      async resolveProfile() {
        return {
          status: "not_found",
        };
      },
    },
  });

  const tickRequest = createBaseRequest({
    sessionId: "session-1",
    workspaceId: "workspace-1",
    defaultProfileId: "profile.global",
  });
  delete tickRequest.profileId;

  const result = await gateway.tick(tickRequest);

  assert.deepEqual(result, {
    status: "skipped",
    policyId: "policy-1",
    runId: "run-1",
    trigger: "schedule",
    selectedModelLane: "local",
    escalationApplied: false,
    checkCount: 1,
    deliveryRule: "ok",
    skipReason: "profile_not_resolved",
    executionPlan: {
      checkIds: ["check.tasks"],
      forceRun: false,
    },
  });
});

test("heartbeat tick honors middleware-patched gating fields", async () => {
  const { gateway } = setupHeartbeatGateway({
    middleware: [
      {
        id: "patch-heartbeat-input",
        before(context) {
          if (context.actionId !== "heartbeat.tick.execute") {
            return undefined;
          }

          return {
            input: {
              ...context.input,
              active: false,
              forceRun: false,
              activeCheckIds: [],
              modelLaneDefault: "worker",
            },
          };
        },
      },
    ],
  });

  const result = await gateway.tick(
    createBaseRequest({
      active: true,
      forceRun: true,
      modelLaneDefault: "local",
      activeCheckIds: ["check.tasks"],
    }),
  );

  assert.deepEqual(result, {
    status: "skipped",
    policyId: "policy-1",
    profileId: "profile-default",
    runId: "run-1",
    trigger: "schedule",
    selectedModelLane: "worker",
    escalationApplied: false,
    checkCount: 0,
    deliveryRule: "ok",
    skipReason: "policy_inactive",
    executionPlan: {
      checkIds: [],
      forceRun: false,
    },
  });
});

test("heartbeat tick rejects invalid request shapes deterministically", async () => {
  const { gateway } = setupHeartbeatGateway();

  await assert.rejects(
    async () =>
      gateway.tick(
        createBaseRequest({
          cadenceMinutes: 0,
        }),
      ),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      gateway.tick({
        ...createBaseRequest(),
        unexpected: true,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
