import test from "node:test";
import assert from "node:assert/strict";

import {
  ContractValidationError,
  RuntimeExecutionError,
} from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createControlPlaneGateway,
  createMiddlewarePipeline,
  createProfileResolutionGateway,
  registerControlPlaneContracts,
  registerProfileResolutionContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupProfileResolutionGateway({
  middleware = [],
  initialRecords,
  now = () => Date.UTC(2026, 1, 23, 10, 0, 0),
} = {}) {
  const contractRegistry = createContractRegistry();
  registerControlPlaneContracts(contractRegistry);
  registerProfileResolutionContract(contractRegistry);

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const controlPlaneGateway = createControlPlaneGateway({
    middlewarePipeline,
    initialRecords,
    now,
  });
  const profileResolutionGateway = createProfileResolutionGateway({
    middlewarePipeline,
    readConfigRecord: controlPlaneGateway.readConfigRecord,
  });

  return {
    controlPlaneGateway,
    profileResolutionGateway,
    auditEvents,
  };
}

test("registerProfileResolutionContract registers profile resolution contract once", () => {
  const contractRegistry = createContractRegistry();
  registerProfileResolutionContract(contractRegistry);
  registerProfileResolutionContract(contractRegistry);

  assert.deepEqual(contractRegistry.list(), ["profile.resolve@1"]);
});

test("profile resolution honors session -> workspace -> global precedence through middleware", async () => {
  const middlewareEvents = [];
  const { controlPlaneGateway, profileResolutionGateway, auditEvents } =
    setupProfileResolutionGateway({
      middleware: [
        {
          id: "capture-profile-resolve",
          before(context) {
            if (context.actionId === "profile.resolve") {
              middlewareEvents.push(`before:${context.actionId}`);
            }
          },
          after(context) {
            if (context.actionId === "profile.resolve") {
              middlewareEvents.push(`after:${context.output.status}`);
            }
          },
        },
      ],
    });

  await controlPlaneGateway.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.global",
    config: { modelLane: "worker" },
  });
  await controlPlaneGateway.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.workspace",
    config: { modelLane: "brain" },
  });
  await controlPlaneGateway.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.session",
    config: { modelLane: "local" },
  });

  await controlPlaneGateway.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:global",
    config: { profileId: "profile.global" },
  });
  await controlPlaneGateway.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:workspace:workspace-1",
    config: { profileId: "profile.workspace" },
  });
  await controlPlaneGateway.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:session:session-1",
    config: { profileId: "profile.session" },
  });

  const resolved = await profileResolutionGateway.resolve({
    traceId: "trace-profile-resolve-1",
    sessionId: "session-1",
    workspaceId: "workspace-1",
    defaultProfileId: "profile.global",
  });

  assert.deepEqual(resolved, {
    status: "resolved",
    resolvedScope: "session",
    profileId: "profile.session",
    profileVersion: 1,
    pinResourceId: "profile-pin:session:session-1",
    profileConfig: { modelLane: "local" },
  });
  assert.deepEqual(middlewareEvents, [
    "before:profile.resolve",
    "after:resolved",
  ]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "profile.resolve" &&
        event.traceId === "trace-profile-resolve-1",
    ),
  );
});

test("profile resolution falls back to workspace and then global pin when higher scopes are absent", async () => {
  const { controlPlaneGateway, profileResolutionGateway } =
    setupProfileResolutionGateway();

  await controlPlaneGateway.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.global",
    config: { modelLane: "worker" },
  });
  await controlPlaneGateway.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.workspace",
    config: { modelLane: "brain" },
  });

  await controlPlaneGateway.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:global",
    config: { profileId: "profile.global" },
  });
  await controlPlaneGateway.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:workspace:workspace-1",
    config: { profileId: "profile.workspace" },
  });

  const workspaceResolved = await profileResolutionGateway.resolve({
    sessionId: "session-unknown",
    workspaceId: "workspace-1",
    includeProfileConfig: false,
  });
  assert.deepEqual(workspaceResolved, {
    status: "resolved",
    resolvedScope: "workspace",
    profileId: "profile.workspace",
    profileVersion: 1,
    pinResourceId: "profile-pin:workspace:workspace-1",
  });

  const globalResolved = await profileResolutionGateway.resolve({
    workspaceId: "workspace-unknown",
  });
  assert.deepEqual(globalResolved, {
    status: "resolved",
    resolvedScope: "global",
    profileId: "profile.global",
    profileVersion: 1,
    pinResourceId: "profile-pin:global",
    profileConfig: { modelLane: "worker" },
  });
});

test("profile resolution supports user pin precedence between session and global", async () => {
  const { controlPlaneGateway, profileResolutionGateway } = setupProfileResolutionGateway();

  await controlPlaneGateway.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.global",
    config: { modelLane: "worker" },
  });
  await controlPlaneGateway.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.user",
    config: { modelLane: "brain" },
  });
  await controlPlaneGateway.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:global",
    config: { profileId: "profile.global" },
  });
  await controlPlaneGateway.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:user:user-7",
    config: { profileId: "profile.user" },
  });

  const resolved = await profileResolutionGateway.resolve({
    sessionId: "session-no-pin",
    userId: "user-7",
  });
  assert.deepEqual(resolved, {
    status: "resolved",
    resolvedScope: "user",
    profileId: "profile.user",
    profileVersion: 1,
    pinResourceId: "profile-pin:user:user-7",
    profileConfig: { modelLane: "brain" },
  });
});

test("profile resolution falls back to default profile when no scoped pin exists", async () => {
  const { controlPlaneGateway, profileResolutionGateway } =
    setupProfileResolutionGateway();

  await controlPlaneGateway.upsertConfig({
    resourceType: "profile",
    resourceId: "profile.default",
    config: { modelLane: "worker" },
  });

  const resolved = await profileResolutionGateway.resolve({
    workspaceId: "workspace-1",
    defaultProfileId: "profile.default",
  });

  assert.deepEqual(resolved, {
    status: "resolved",
    resolvedScope: "default",
    profileId: "profile.default",
    profileVersion: 1,
    profileConfig: { modelLane: "worker" },
  });
});

test("profile resolution returns typed not_found output for missing pinned/default profiles", async () => {
  const { controlPlaneGateway, profileResolutionGateway } =
    setupProfileResolutionGateway();

  await controlPlaneGateway.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:session:session-1",
    config: { profileId: "profile.missing" },
  });

  const pinnedMissing = await profileResolutionGateway.resolve({
    sessionId: "session-1",
    workspaceId: "workspace-1",
    defaultProfileId: "profile.default",
  });
  assert.deepEqual(pinnedMissing, {
    status: "not_found",
    resolvedScope: "session",
    profileId: "profile.missing",
    pinResourceId: "profile-pin:session:session-1",
    reason: 'Pinned session profile "profile.missing" is not configured',
  });

  const noPinNoFallback = await profileResolutionGateway.resolve({
    allowDefaultFallback: false,
  });
  assert.deepEqual(noPinNoFallback, {
    status: "not_found",
    reason: "No pinned profile found for requested scopes",
  });
});

test("profile resolution rejects invalid request or pin policy shapes deterministically", async () => {
  const { controlPlaneGateway, profileResolutionGateway } =
    setupProfileResolutionGateway();

  await assert.rejects(
    async () =>
      profileResolutionGateway.resolve({
        sessionId: "",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await controlPlaneGateway.upsertConfig({
    resourceType: "policy",
    resourceId: "profile-pin:global",
    config: {
      invalid: true,
    },
  });

  await assert.rejects(
    async () =>
      profileResolutionGateway.resolve({}),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR",
  );
});
