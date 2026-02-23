import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createAutomationGateway,
  createContractRegistry,
  createMiddlewarePipeline,
  registerAutomationContracts,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupAutomationGateway({
  automationAuthoring = {},
  automationExecutor = {},
  profileResolver = {},
  middleware = [],
} = {}) {
  const contractRegistry = createContractRegistry();
  registerAutomationContracts(contractRegistry);

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const gateway = createAutomationGateway({
    middlewarePipeline,
    automationAuthoring,
    automationExecutor,
    profileResolver,
  });

  return {
    gateway,
    auditEvents,
  };
}

function createDraftRequest(overrides = {}) {
  return {
    sessionId: "session-1",
    userId: "user-1",
    defaultProfileId: "profile-default",
    intentText: "Create a daily status summary automation",
    ...overrides,
  };
}

function createRunRequest(overrides = {}) {
  return {
    automationId: "auto.daily-summary",
    runId: "run-1",
    trigger: "schedule",
    profileId: "profile-default",
    executionPlan: {
      steps: ["collect", "summarize"],
    },
    capabilityScope: {
      allowedTools: ["memory.search"],
    },
    ...overrides,
  };
}

test("registerAutomationContracts registers draft and run contracts once", () => {
  const contractRegistry = createContractRegistry();
  registerAutomationContracts(contractRegistry);
  registerAutomationContracts(contractRegistry);

  assert.deepEqual(contractRegistry.list(), [
    "automation.draft.from-intent@1",
    "automation.run.execute@1",
  ]);
});

test("automation draft executes through middleware and derives deterministic baseline", async () => {
  const middlewareEvents = [];
  const { gateway, auditEvents } = setupAutomationGateway({
    middleware: [
      {
        id: "capture",
        before() {
          middlewareEvents.push("before");
        },
        after(context) {
          middlewareEvents.push(`after:${context.output.status}`);
        },
      },
    ],
  });

  const result = await gateway.draftFromIntent({
    traceId: "trace-auto-draft-1",
    ...createDraftRequest(),
  });

  assert.deepEqual(result, {
    status: "drafted",
    draftId: "draft.session-1.create-a-daily-status-summary",
    summary: "Create a daily status summary automation",
    triggerType: "schedule",
    schedule: {
      kind: "hourly",
      intervalHours: 24,
    },
    runScope: {
      sessionId: "session-1",
      userId: "user-1",
      profileId: "profile-default",
    },
    selectedModelLane: "local",
    approvalRequired: false,
  });

  assert.deepEqual(middlewareEvents, ["before", "after:drafted"]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "automation.draft.from-intent" &&
        event.traceId === "trace-auto-draft-1",
    ),
  );
});

test("automation draft allows controlled authoring overrides", async () => {
  const { gateway } = setupAutomationGateway({
    automationAuthoring: {
      async draftFromIntent(request) {
        return {
          summary: `Approved: ${request.baseDraft.summary}`,
          triggerType: "event",
          approvalRequired: true,
          reason: "Intent implies external side effects",
        };
      },
    },
  });

  const result = await gateway.draftFromIntent(
    createDraftRequest({
      intentText: "When build fails, send notification",
    }),
  );

  assert.equal(result.status, "drafted");
  assert.equal(result.triggerType, "event");
  assert.equal(result.approvalRequired, true);
  assert.equal(result.reason, "Intent implies external side effects");
  assert.match(result.summary, /^Approved:/);
});

test("automation run skips when inactive and blocks when approval is missing", async () => {
  const { gateway } = setupAutomationGateway();

  const skipped = await gateway.executeRun(
    createRunRequest({
      active: false,
    }),
  );
  assert.deepEqual(skipped, {
    status: "skipped",
    automationId: "auto.daily-summary",
    runId: "run-1",
    trigger: "schedule",
    selectedModelLane: "local",
    escalationApplied: false,
    stepCount: 2,
    skipReason: "policy_inactive",
    retryEligible: false,
    deadLetterEligible: false,
  });

  const blocked = await gateway.executeRun(
    createRunRequest({
      policyRequiresApproval: true,
    }),
  );
  assert.deepEqual(blocked, {
    status: "blocked",
    automationId: "auto.daily-summary",
    runId: "run-1",
    trigger: "schedule",
    selectedModelLane: "local",
    escalationApplied: false,
    stepCount: 2,
    blockReason: "approval_required",
    retryEligible: false,
    deadLetterEligible: false,
  });
});

test("automation run executes with escalation and returns executor outcome", async () => {
  const { gateway } = setupAutomationGateway({
    automationExecutor: {
      async executePlan(request) {
        return {
          status: "executed",
          outcome: {
            lane: request.selectedModelLane,
            completed: true,
          },
          retryEligible: false,
          deadLetterEligible: false,
        };
      },
    },
  });

  const result = await gateway.executeRun(
    createRunRequest({
      modelLaneDefault: "local",
      escalationEnabled: true,
      escalationFailureThreshold: 2,
      recentFailureCount: 2,
      escalationTargetLane: "brain",
      approvalTicket: "APP-1",
      policyRequiresApproval: true,
    }),
  );

  assert.deepEqual(result, {
    status: "executed",
    automationId: "auto.daily-summary",
    runId: "run-1",
    trigger: "schedule",
    selectedModelLane: "brain",
    escalationApplied: true,
    stepCount: 2,
    outcome: {
      lane: "brain",
      completed: true,
    },
    retryEligible: false,
    deadLetterEligible: false,
  });
});

test("automation run maps executor failure to typed failed output", async () => {
  const { gateway } = setupAutomationGateway({
    automationExecutor: {
      async executePlan() {
        throw new Error("executor timeout");
      },
    },
  });

  const result = await gateway.executeRun(createRunRequest());
  assert.deepEqual(result, {
    status: "failed",
    automationId: "auto.daily-summary",
    runId: "run-1",
    trigger: "schedule",
    selectedModelLane: "local",
    escalationApplied: false,
    stepCount: 2,
    failure: {
      code: "POLAR_RUNTIME_EXECUTION_ERROR",
      message: "Automation execution failed",
      cause: "executor timeout",
    },
    retryEligible: true,
    deadLetterEligible: false,
  });
});

test("automation run resolves profile when profileId is omitted", async () => {
  const resolverRequests = [];
  const { gateway } = setupAutomationGateway({
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
    automationExecutor: {
      async executePlan(request) {
        return {
          status: "executed",
          outcome: {
            profileId: request.profileId,
          },
        };
      },
    },
  });

  const runRequest = createRunRequest({
    sessionId: "session-1",
    workspaceId: "workspace-1",
    defaultProfileId: "profile.global",
  });
  delete runRequest.profileId;

  const result = await gateway.executeRun(runRequest);

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
  assert.equal(result.resolvedProfileScope, "workspace");
  assert.deepEqual(result.outcome, {
    profileId: "profile.workspace",
  });
});

test("automation run blocks with profile_not_resolved when profile is unavailable", async () => {
  const { gateway } = setupAutomationGateway({
    profileResolver: {
      async resolveProfile() {
        return {
          status: "not_found",
          reason: "No pinned profile found",
        };
      },
    },
  });

  const runRequest = createRunRequest({
    sessionId: "session-1",
    workspaceId: "workspace-1",
    defaultProfileId: "profile.global",
  });
  delete runRequest.profileId;

  const result = await gateway.executeRun(runRequest);

  assert.deepEqual(result, {
    status: "blocked",
    automationId: "auto.daily-summary",
    runId: "run-1",
    trigger: "schedule",
    selectedModelLane: "local",
    escalationApplied: false,
    stepCount: 2,
    blockReason: "profile_not_resolved",
    retryEligible: false,
    deadLetterEligible: false,
  });
});

test("automation run honors middleware-patched gating and plan fields", async () => {
  const { gateway } = setupAutomationGateway({
    middleware: [
      {
        id: "patch-automation-input",
        before(context) {
          if (context.actionId !== "automation.run.execute") {
            return undefined;
          }

          return {
            input: {
              ...context.input,
              active: false,
              forceRun: false,
              modelLaneDefault: "brain",
              executionPlan: {
                steps: [],
              },
            },
          };
        },
      },
    ],
  });

  const result = await gateway.executeRun(
    createRunRequest({
      active: true,
      forceRun: true,
      modelLaneDefault: "local",
      executionPlan: {
        steps: ["collect", "summarize"],
      },
    }),
  );

  assert.deepEqual(result, {
    status: "skipped",
    automationId: "auto.daily-summary",
    runId: "run-1",
    trigger: "schedule",
    selectedModelLane: "brain",
    escalationApplied: false,
    stepCount: 0,
    skipReason: "policy_inactive",
    retryEligible: false,
    deadLetterEligible: false,
  });
});

test("automation gateway rejects invalid request shapes deterministically", async () => {
  const { gateway } = setupAutomationGateway();

  await assert.rejects(
    async () =>
      gateway.draftFromIntent(
        createDraftRequest({
          intentText: "",
        }),
      ),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      gateway.executeRun({
        ...createRunRequest(),
        unexpected: true,
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
