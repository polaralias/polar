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
  registerControlPlaneContracts,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupControlPlaneGateway({
  middleware = [],
  initialRecords,
  now = () => Date.UTC(2026, 1, 22, 12, 0, 0),
} = {}) {
  const contractRegistry = createContractRegistry();
  registerControlPlaneContracts(contractRegistry);

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const gateway = createControlPlaneGateway({
    middlewarePipeline,
    initialRecords,
    now,
  });

  return {
    gateway,
    auditEvents,
  };
}

test("registerControlPlaneContracts registers control-plane contracts once", () => {
  const contractRegistry = createContractRegistry();
  registerControlPlaneContracts(contractRegistry);
  registerControlPlaneContracts(contractRegistry);

  assert.deepEqual(contractRegistry.list(), [
    "control-plane.config.get@1",
    "control-plane.config.list@1",
    "control-plane.config.upsert@1",
  ]);
});

test("control-plane upsert applies config through middleware and audit trail", async () => {
  const middlewareEvents = [];
  const { gateway, auditEvents } = setupControlPlaneGateway({
    middleware: [
      {
        id: "capture",
        before(context) {
          middlewareEvents.push(`before:${context.actionId}`);
        },
        after(context) {
          middlewareEvents.push(`after:${context.output.status}`);
        },
      },
    ],
  });

  const applied = await gateway.upsertConfig({
    traceId: "trace-control-upsert-1",
    resourceType: "profile",
    resourceId: "default",
    config: {
      modelLane: "worker",
      skills: ["skill.docs-helper"],
    },
    actorId: "admin-1",
  });

  assert.deepEqual(applied, {
    status: "applied",
    resourceType: "profile",
    resourceId: "default",
    version: 1,
    previousVersion: 0,
    config: {
      modelLane: "worker",
      skills: ["skill.docs-helper"],
    },
  });
  assert.deepEqual(middlewareEvents, [
    "before:control-plane.config.upsert",
    "after:applied",
  ]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "control-plane.config.upsert" &&
        event.traceId === "trace-control-upsert-1",
    ),
  );
});

test("control-plane upsert rejects optimistic lock conflicts deterministically", async () => {
  const { gateway } = setupControlPlaneGateway();

  await gateway.upsertConfig({
    resourceType: "automation",
    resourceId: "daily-report",
    config: {
      enabled: true,
    },
  });

  const rejected = await gateway.upsertConfig({
    resourceType: "automation",
    resourceId: "daily-report",
    expectedVersion: 0,
    config: {
      enabled: false,
    },
  });

  assert.deepEqual(rejected, {
    status: "rejected",
    resourceType: "automation",
    resourceId: "daily-report",
    version: 1,
    previousVersion: 1,
    reason: "Version conflict",
  });
});

test("control-plane get returns typed found and not_found responses", async () => {
  const { gateway } = setupControlPlaneGateway({
    initialRecords: [
      {
        resourceType: "channel",
        resourceId: "telegram.main",
        version: 2,
        config: {
          enabled: true,
        },
        updatedAtMs: Date.UTC(2026, 1, 22, 9, 0, 0),
      },
    ],
  });

  const found = await gateway.getConfig({
    resourceType: "channel",
    resourceId: "telegram.main",
  });
  assert.deepEqual(found, {
    status: "found",
    resourceType: "channel",
    resourceId: "telegram.main",
    version: 2,
    config: {
      enabled: true,
    },
  });

  const missing = await gateway.getConfig({
    resourceType: "channel",
    resourceId: "slack.main",
  });
  assert.deepEqual(missing, {
    status: "not_found",
    resourceType: "channel",
    resourceId: "slack.main",
    version: 0,
  });
});

test("control-plane list is deterministic with cursor pagination", async () => {
  const { gateway } = setupControlPlaneGateway();

  await gateway.upsertConfig({
    resourceType: "policy",
    resourceId: "budget",
    config: { maxUsd: 20 },
  });
  await gateway.upsertConfig({
    resourceType: "policy",
    resourceId: "safety",
    config: { approvalRequired: true },
  });
  await gateway.upsertConfig({
    resourceType: "policy",
    resourceId: "routing",
    config: { defaultLane: "worker" },
  });

  const first = await gateway.listConfigs({
    resourceType: "policy",
    limit: 2,
  });
  assert.deepEqual(first, {
    status: "ok",
    resourceType: "policy",
    items: [
      {
        resourceId: "budget",
        version: 1,
      },
      {
        resourceId: "routing",
        version: 1,
      },
    ],
    totalCount: 3,
    nextCursor: "2",
  });

  const second = await gateway.listConfigs({
    resourceType: "policy",
    cursor: "2",
    limit: 2,
    includeValues: true,
  });
  assert.deepEqual(second, {
    status: "ok",
    resourceType: "policy",
    items: [
      {
        resourceId: "safety",
        version: 1,
        config: { approvalRequired: true },
      },
    ],
    totalCount: 3,
  });
});

test("control-plane readConfigRecord returns deterministic snapshots and rejects invalid keys", async () => {
  const { gateway } = setupControlPlaneGateway();

  await gateway.upsertConfig({
    resourceType: "profile",
    resourceId: "default",
    config: {
      modelLane: "worker",
    },
  });

  const found = gateway.readConfigRecord("profile", "default");
  assert.deepEqual(found, {
    resourceType: "profile",
    resourceId: "default",
    version: 1,
    config: {
      modelLane: "worker",
    },
    updatedAtMs: Date.UTC(2026, 1, 22, 12, 0, 0),
  });
  assert.equal(gateway.readConfigRecord("profile", "missing"), undefined);

  assert.throws(
    () =>
      gateway.readConfigRecord(
        /** @type {"profile"} */ ("invalid"),
        "default",
      ),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR",
  );
});

test("control-plane gateway rejects invalid request shapes and cursor format", async () => {
  const { gateway } = setupControlPlaneGateway();

  await assert.rejects(
    async () =>
      gateway.upsertConfig({
        resourceType: "profile",
        resourceId: "",
        config: {},
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  await assert.rejects(
    async () =>
      gateway.listConfigs({
        resourceType: "profile",
        cursor: "not-a-number",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
