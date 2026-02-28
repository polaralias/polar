import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import { createExtensionAdapterRegistry } from "../packages/polar-adapter-extensions/src/index.mjs";
import {
  createApprovalStore,
  createContractRegistry,
  createExtensionGateway,
  createMiddlewarePipeline,
  registerExtensionContracts,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupExtensionGateway({
  middleware = [],
  policy,
  adapters = [],
  initialStates,
  approvalStore,
} = {}) {
  const registry = createContractRegistry();
  registerExtensionContracts(registry);

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const extensionRegistry = createExtensionAdapterRegistry();
  for (const [extensionId, adapter] of adapters) {
    extensionRegistry.register(extensionId, adapter);
  }

  const gateway = createExtensionGateway({
    middlewarePipeline,
    extensionRegistry,
    policy,
    initialStates,
    approvalStore,
  });

  return {
    gateway,
    auditEvents,
  };
}

test("registerExtensionContracts registers lifecycle and execute contracts once", () => {
  const registry = createContractRegistry();
  registerExtensionContracts(registry);
  registerExtensionContracts(registry);

  assert.deepEqual(registry.list(), [
    "extension.lifecycle.apply@1",
    "extension.operation.execute@1",
  ]);
});

test("extension lifecycle applies install + enable through middleware", async () => {
  const middlewareEvents = [];
  const { gateway, auditEvents } = setupExtensionGateway({
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

  const installed = await gateway.applyLifecycle({
    traceId: "trace-ext-1",
    extensionId: "skill.docs",
    extensionType: "skill",
    operation: "install",
    trustLevel: "reviewed",
    requestedPermissions: ["net.http", "fs.read", "fs.read"],
  });

  const enabled = await gateway.applyLifecycle({
    traceId: "trace-ext-2",
    extensionId: "skill.docs",
    extensionType: "skill",
    operation: "enable",
  });

  assert.deepEqual(installed, {
    status: "applied",
    extensionId: "skill.docs",
    extensionType: "skill",
    operation: "install",
    trustLevel: "reviewed",
    lifecycleState: "installed",
    permissionDelta: {
      added: ["fs.read", "net.http"],
      removed: [],
      retained: [],
    },
  });

  assert.deepEqual(enabled, {
    status: "applied",
    extensionId: "skill.docs",
    extensionType: "skill",
    operation: "enable",
    trustLevel: "reviewed",
    lifecycleState: "enabled",
    permissionDelta: {
      added: [],
      removed: [],
      retained: ["fs.read", "net.http"],
    },
  });

  assert.deepEqual(middlewareEvents, [
    "before:extension.lifecycle.apply",
    "after:applied",
    "before:extension.lifecycle.apply",
    "after:applied",
  ]);
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "extension.lifecycle.apply" &&
        event.traceId === "trace-ext-1",
    ),
  );
  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "extension.lifecycle.apply" &&
        event.traceId === "trace-ext-2",
    ),
  );
});

test("blocked extension trust cannot be enabled", async () => {
  const { gateway } = setupExtensionGateway();
  await gateway.applyLifecycle({
    extensionId: "plugin.reviewer",
    extensionType: "plugin",
    operation: "install",
    trustLevel: "blocked",
    requestedPermissions: ["net.http"],
  });

  const result = await gateway.applyLifecycle({
    extensionId: "plugin.reviewer",
    extensionType: "plugin",
    operation: "enable",
  });

  assert.deepEqual(result, {
    status: "rejected",
    extensionId: "plugin.reviewer",
    extensionType: "plugin",
    operation: "enable",
    trustLevel: "blocked",
    lifecycleState: "blocked",
    permissionDelta: {
      added: [],
      removed: [],
      retained: ["net.http"],
    },
    reason: "Blocked extensions cannot be enabled",
  });
});

test("extension lifecycle rejects extension type mutation for an existing extension id", async () => {
  const { gateway } = setupExtensionGateway();

  await gateway.applyLifecycle({
    extensionId: "shared.id",
    extensionType: "skill",
    operation: "install",
    trustLevel: "reviewed",
    requestedPermissions: ["fs.read"],
  });

  const result = await gateway.applyLifecycle({
    extensionId: "shared.id",
    extensionType: "mcp",
    operation: "upgrade",
    trustLevel: "reviewed",
    requestedPermissions: ["git.read"],
  });

  assert.deepEqual(result, {
    status: "rejected",
    extensionId: "shared.id",
    extensionType: "mcp",
    operation: "upgrade",
    trustLevel: "reviewed",
    lifecycleState: "installed",
    permissionDelta: {
      added: [],
      removed: [],
      retained: ["fs.read"],
    },
    reason: "Extension type does not match installed state",
  });

  assert.deepEqual(gateway.getState("shared.id"), {
    extensionId: "shared.id",
    extensionType: "skill",
    trustLevel: "reviewed",
    lifecycleState: "installed",
    permissions: ["fs.read"],
  });
});

test("extension execute succeeds after install+enable and forwards scoped request", async () => {
  const capabilityCalls = [];
  const { gateway } = setupExtensionGateway({
    adapters: [
      [
        "mcp.git",
        {
          async executeCapability(request) {
            capabilityCalls.push(request);
            return {
              ok: true,
              command: request.capabilityId,
            };
          },
        },
      ],
    ],
  });

  await gateway.applyLifecycle({
    extensionId: "mcp.git",
    extensionType: "mcp",
    operation: "install",
    trustLevel: "trusted",
    requestedPermissions: ["git.read", "git.write"],
  });
  await gateway.applyLifecycle({
    extensionId: "mcp.git",
    extensionType: "mcp",
    operation: "enable",
  });

  const result = await gateway.execute({
    traceId: "trace-ext-exec-1",
    extensionId: "mcp.git",
    extensionType: "mcp",
    capabilityId: "repo.status",
    sessionId: "session-1",
    userId: "user-1",
    capabilityScope: {
      allowed: {
        "mcp.git": ["repo.status"],
      },
    },
    input: {
      repo: "polar",
    },
  });

  assert.deepEqual(result, {
    status: "completed",
    extensionId: "mcp.git",
    extensionType: "mcp",
    capabilityId: "repo.status",
    trustLevel: "trusted",
    output: {
      ok: true,
      command: "repo.status",
    },
  });
  assert.deepEqual(capabilityCalls, [
    {
      extensionId: "mcp.git",
      extensionType: "mcp",
      capabilityId: "repo.status",
      sessionId: "session-1",
      userId: "user-1",
      capabilityScope: {
        allowed: {
          "mcp.git": ["repo.status"],
        },
      },
      input: {
        repo: "polar",
      },
      trustLevel: "trusted",
    },
  ]);
});

test("extension execute rejects trust level overrides that differ from persisted state", async () => {
  const { gateway } = setupExtensionGateway({
    adapters: [
      [
        "skill.docs",
        {
          async executeCapability() {
            return { ok: true };
          },
        },
      ],
    ],
  });

  await gateway.applyLifecycle({
    extensionId: "skill.docs",
    extensionType: "skill",
    operation: "install",
    trustLevel: "reviewed",
    requestedPermissions: ["fs.read"],
  });
  await gateway.applyLifecycle({
    extensionId: "skill.docs",
    extensionType: "skill",
    operation: "enable",
  });

  const result = await gateway.execute({
    extensionId: "skill.docs",
    extensionType: "skill",
    capabilityId: "docs.search",
    sessionId: "session-override",
    userId: "user-override",
    trustLevel: "trusted",
    capabilityScope: {
      allowed: {
        "skill.docs": ["docs.search"],
      },
    },
    input: {},
  });

  assert.deepEqual(result, {
    status: "failed",
    extensionId: "skill.docs",
    extensionType: "skill",
    capabilityId: "docs.search",
    trustLevel: "reviewed",
    error: {
      code: "POLAR_EXTENSION_TRUST_LEVEL_MISMATCH",
      message: "Requested trust level does not match installed state",
      expected: "reviewed",
      received: "trusted",
    },
  });
});

test("extension execute returns deterministic failed payload for adapter errors", async () => {
  const { gateway } = setupExtensionGateway({
    adapters: [
      [
        "skill.docs",
        {
          async executeCapability() {
            throw new Error("capability timeout");
          },
        },
      ],
    ],
  });

  await gateway.applyLifecycle({
    extensionId: "skill.docs",
    extensionType: "skill",
    operation: "install",
    trustLevel: "reviewed",
    requestedPermissions: ["fs.read"],
  });
  await gateway.applyLifecycle({
    extensionId: "skill.docs",
    extensionType: "skill",
    operation: "enable",
  });

  const result = await gateway.execute({
    extensionId: "skill.docs",
    extensionType: "skill",
    capabilityId: "docs.search",
    sessionId: "session-2",
    userId: "user-2",
    capabilityScope: {
      allowed: {
        "skill.docs": ["docs.search"],
      },
    },
    input: {
      q: "contracts",
    },
  });

  assert.deepEqual(result, {
    status: "failed",
    extensionId: "skill.docs",
    extensionType: "skill",
    capabilityId: "docs.search",
    trustLevel: "reviewed",
    error: {
      code: "POLAR_RUNTIME_EXECUTION_ERROR",
      message: "Extension capability execution failed",
      cause: "capability timeout",
    },
  });
});

test("extension execute respects policy denial and rejects invalid request shape", async () => {
  const { gateway } = setupExtensionGateway({
    policy: {
      evaluateExecution() {
        return {
          allowed: false,
          reason: "approval required",
        };
      },
    },
    initialStates: [
      {
        extensionId: "plugin.search",
        extensionType: "plugin",
        trustLevel: "reviewed",
        lifecycleState: "enabled",
        permissions: ["net.http"],
      },
    ],
    adapters: [
      [
        "plugin.search",
        {
          async executeCapability() {
            assert.fail("adapter must not execute on policy denial");
          },
        },
      ],
    ],
  });

  const denied = await gateway.execute({
    extensionId: "plugin.search",
    extensionType: "plugin",
    capabilityId: "search.web",
    sessionId: "session-3",
    userId: "user-3",
    capabilityScope: {
      allowed: {
        "plugin.search": ["search.web"],
      },
    },
    input: {
      q: "polar",
    },
  });

  assert.deepEqual(denied, {
    status: "failed",
    extensionId: "plugin.search",
    extensionType: "plugin",
    capabilityId: "search.web",
    trustLevel: "reviewed",
    error: {
      code: "POLAR_EXTENSION_POLICY_DENIED",
      message: "approval required",
    },
  });

  await assert.rejects(
    async () =>
      gateway.execute({
        extensionId: "plugin.search",
        extensionType: "plugin",
        capabilityId: "",
        sessionId: "session-3",
        userId: "user-3",
        capabilityScope: {},
        input: {},
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("extension execute enforces built-in approval requirement for external/network capabilities", async () => {
  const approvalStore = createApprovalStore();
  const { gateway } = setupExtensionGateway({
    approvalStore,
    initialStates: [
      {
        extensionId: "skill.mail",
        extensionType: "skill",
        trustLevel: "reviewed",
        lifecycleState: "enabled",
        permissions: [],
        capabilities: [
          {
            capabilityId: "send_mail",
            riskLevel: "write",
            sideEffects: "external",
            dataEgress: "network",
          },
        ],
      },
    ],
    adapters: [
      [
        "skill.mail",
        {
          async executeCapability() {
            return { ok: true };
          },
        },
      ],
    ],
  });

  const denied = await gateway.execute({
    extensionId: "skill.mail",
    extensionType: "skill",
    capabilityId: "send_mail",
    sessionId: "session-approval",
    userId: "user-approval",
    capabilityScope: {
      allowed: {
        "skill.mail": ["send_mail"],
      },
    },
    input: {
      to: "a@example.com",
    },
  });

  assert.equal(denied.status, "failed");
  assert.deepEqual(denied.error, {
    code: "POLAR_EXTENSION_POLICY_DENIED",
    message: "External side effects or data egress require explicit approval",
  });

  approvalStore.issueGrant(
    { userId: "user-approval", sessionId: "session-approval" },
    {
      capabilities: [{ extensionId: "skill.mail", capabilityId: "send_mail" }],
    },
    3600,
    "Manual approval",
    { workflowId: "wf-1" },
    "write",
  );

  const allowed = await gateway.execute({
    extensionId: "skill.mail",
    extensionType: "skill",
    capabilityId: "send_mail",
    sessionId: "session-approval",
    userId: "user-approval",
    capabilityScope: {
      allowed: {
        "skill.mail": ["send_mail"],
      },
    },
    input: {
      to: "a@example.com",
    },
  });

  assert.equal(allowed.status, "completed");
});
