import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createExtensionAdapterRegistry,
  createMcpConnectionAdapter,
  mapMcpToolCatalog,
} from "../packages/polar-adapter-extensions/src/index.mjs";
import {
  createContractRegistry,
  createExtensionGateway,
  createMcpConnectorGateway,
  createMiddlewarePipeline,
  registerExtensionContracts,
  registerMcpConnectorContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupMcpConnector({
  mcpAdapter,
  connectorPolicy = {},
  extensionPolicy,
  middleware = [],
} = {}) {
  const contractRegistry = createContractRegistry();
  registerExtensionContracts(contractRegistry);
  registerMcpConnectorContract(contractRegistry);

  const auditEvents = [];
  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware,
    auditSink(event) {
      auditEvents.push(event);
    },
  });

  const extensionRegistry = createExtensionAdapterRegistry();
  const extensionGateway = createExtensionGateway({
    middlewarePipeline,
    extensionRegistry,
    policy: extensionPolicy,
  });

  const connectorGateway = createMcpConnectorGateway({
    middlewarePipeline,
    extensionGateway,
    extensionRegistry,
    mcpAdapter,
    policy: connectorPolicy,
  });

  return {
    connectorGateway,
    extensionGateway,
    auditEvents,
  };
}

function createGitMcpAdapter({ tools, health, invokeTool }) {
  return createMcpConnectionAdapter({
    serverId: "git-server",
    async probeConnection() {
      return health ?? { healthy: true, status: "ok", latencyMs: 14 };
    },
    async listTools() {
      return tools;
    },
    async invokeTool(request) {
      if (invokeTool) {
        return invokeTool(request);
      }

      return {
        ok: true,
        toolId: request.toolId,
      };
    },
  });
}

test("registerMcpConnectorContract registers connector contract once", () => {
  const registry = createContractRegistry();
  registerMcpConnectorContract(registry);
  registerMcpConnectorContract(registry);

  assert.deepEqual(registry.list(), ["mcp.connector.sync@1"]);
});

test("mcp connector rejects unhealthy connection probes deterministically", async () => {
  const mcpAdapter = createGitMcpAdapter({
    tools: [{ toolId: "repo.status", permissions: ["git.read"] }],
    health: {
      healthy: false,
      status: "unreachable",
      reason: "timeout",
    },
  });
  const { connectorGateway } = setupMcpConnector({
    mcpAdapter,
  });

  const result = await connectorGateway.sync({
    sourceUri: "C:/mcp/git-server",
    serverId: "git-server",
  });

  assert.deepEqual(result, {
    status: "rejected",
    extensionId: "mcp.git-server",
    operation: "install",
    trustLevel: "reviewed",
    lifecycleStatus: "rejected",
    lifecycleState: "installed",
    permissionDelta: {
      added: [],
      removed: [],
      retained: [],
    },
    capabilityIds: [],
    catalogHash: "unavailable",
    health: {
      healthy: false,
      status: "unreachable",
      reason: "timeout",
    },
    reason: "MCP connection health probe failed",
  });
});

test("mcp connector honors middleware-patched expected tool ids", async () => {
  const tools = [
    {
      toolId: "repo.status",
      permissions: ["git.read"],
    },
  ];
  const mcpAdapter = createGitMcpAdapter({ tools });
  const expectedManifest = mapMcpToolCatalog({
    serverId: "git-server",
    tools,
  });

  const { connectorGateway } = setupMcpConnector({
    mcpAdapter,
    middleware: [
      {
        id: "inject-expected-tool-ids",
        before(context) {
          if (context.actionId !== "mcp.connector.sync") {
            return undefined;
          }

          return {
            input: {
              ...context.input,
              expectedToolIds: ["repo.missing"],
            },
          };
        },
      },
    ],
  });

  const result = await connectorGateway.sync({
    sourceUri: "C:/mcp/git-server",
    serverId: "git-server",
  });

  assert.deepEqual(result, {
    status: "rejected",
    extensionId: "mcp.git-server",
    operation: "install",
    trustLevel: "reviewed",
    lifecycleStatus: "rejected",
    lifecycleState: "installed",
    permissionDelta: {
      added: ["git.read", "mcp.tool.repo.status"],
      removed: [],
      retained: [],
    },
    capabilityIds: ["mcp.git-server.repo.status"],
    catalogHash: expectedManifest.catalogHash,
    health: {
      healthy: true,
      status: "ok",
      latencyMs: 14,
    },
    reason: "MCP expected tool ids mismatch",
  });
});

test("mcp connector sync installs and auto-enables trusted source with wrapped execution", async () => {
  const tools = [
    {
      toolId: "repo.status",
      permissions: ["git.read"],
    },
  ];
  const mcpAdapter = createGitMcpAdapter({ tools });
  const expectedManifest = mapMcpToolCatalog({
    serverId: "git-server",
    tools,
  });

  const { connectorGateway, extensionGateway, auditEvents } = setupMcpConnector({
    mcpAdapter,
    connectorPolicy: {
      trustedSourcePrefixes: ["https://mcp.example/"],
      autoEnableTrusted: true,
    },
  });

  const syncResult = await connectorGateway.sync({
    traceId: "trace-mcp-1",
    sourceUri: "https://mcp.example/git-server",
    serverId: "git-server",
    expectedCatalogHash: expectedManifest.catalogHash,
    expectedToolIds: ["repo.status"],
  });

  assert.deepEqual(syncResult, {
    status: "applied",
    extensionId: "mcp.git-server",
    operation: "install",
    trustLevel: "trusted",
    lifecycleStatus: "applied",
    lifecycleState: "enabled",
    permissionDelta: {
      added: ["git.read", "mcp.tool.repo.status"],
      removed: [],
      retained: [],
    },
    capabilityIds: ["mcp.git-server.repo.status"],
    catalogHash: expectedManifest.catalogHash,
    health: {
      healthy: true,
      status: "ok",
      latencyMs: 14,
    },
  });

  const executed = await extensionGateway.execute({
    extensionId: "mcp.git-server",
    extensionType: "mcp",
    capabilityId: "mcp.git-server.repo.status",
    sessionId: "s1",
    userId: "u1",
    capabilityScope: {
      allowed: {
        "mcp.git-server": ["mcp.git-server.repo.status"],
      },
    },
    input: {
      repo: "polar",
    },
  });

  assert.deepEqual(executed, {
    status: "completed",
    extensionId: "mcp.git-server",
    extensionType: "mcp",
    capabilityId: "mcp.git-server.repo.status",
    trustLevel: "trusted",
    output: {
      extensionId: "mcp.git-server",
      serverId: "git-server",
      toolId: "repo.status",
      capabilityId: "mcp.git-server.repo.status",
      catalogHash: expectedManifest.catalogHash,
      result: {
        ok: true,
        toolId: "repo.status",
      },
    },
  });

  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "mcp.connector.sync" &&
        event.traceId === "trace-mcp-1",
    ),
  );
  assert.ok(
    auditEvents.some((event) => event.actionId === "extension.lifecycle.apply"),
  );
});

test("mcp connector enforces approval ticket on high-risk permission delta during upgrade", async () => {
  let tools = [
    {
      toolId: "repo.status",
      permissions: ["git.read"],
    },
  ];

  const mcpAdapter = createMcpConnectionAdapter({
    serverId: "git-server",
    async probeConnection() {
      return { healthy: true, status: "ok", latencyMs: 14 };
    },
    async listTools() {
      return tools;
    },
    async invokeTool(request) {
      return { toolId: request.toolId };
    },
  });

  const { connectorGateway } = setupMcpConnector({
    mcpAdapter,
    connectorPolicy: {
      trustedSourcePrefixes: ["https://mcp.example/"],
      approvalRequiredPermissions: ["git.write"],
      autoEnableTrusted: true,
    },
  });

  const firstSync = await connectorGateway.sync({
    sourceUri: "https://mcp.example/git-server",
    serverId: "git-server",
  });
  assert.equal(firstSync.status, "applied");

  tools = [
    {
      toolId: "repo.status",
      permissions: ["git.read", "git.write"],
    },
  ];

  const upgradeRejected = await connectorGateway.sync({
    sourceUri: "https://mcp.example/git-server",
    serverId: "git-server",
  });

  assert.deepEqual(upgradeRejected, {
    status: "rejected",
    extensionId: "mcp.git-server",
    operation: "upgrade",
    trustLevel: "trusted",
    lifecycleStatus: "rejected",
    lifecycleState: "enabled",
    permissionDelta: {
      added: ["git.write"],
      removed: [],
      retained: ["git.read", "mcp.tool.repo.status"],
    },
    capabilityIds: ["mcp.git-server.repo.status"],
    catalogHash: upgradeRejected.catalogHash,
    health: {
      healthy: true,
      status: "ok",
      latencyMs: 14,
    },
    reason: "MCP sync requires approval ticket for permission delta",
  });

  const upgradeApplied = await connectorGateway.sync({
    sourceUri: "https://mcp.example/git-server",
    serverId: "git-server",
    approvalTicket: "APP-MCP-1",
  });

  assert.equal(upgradeApplied.status, "applied");
  assert.equal(upgradeApplied.operation, "upgrade");
});

test("mcp connector treats removed extensions as fresh install on resync", async () => {
  const mcpAdapter = createGitMcpAdapter({
    tools: [{ toolId: "repo.status", permissions: ["git.read"] }],
  });
  const { connectorGateway, extensionGateway } = setupMcpConnector({ mcpAdapter });

  const first = await connectorGateway.sync({
    sourceUri: "C:/mcp/git-server",
    serverId: "git-server",
    enableAfterSync: true,
  });
  assert.equal(first.status, "applied");

  const removed = await extensionGateway.applyLifecycle({
    extensionId: "mcp.git-server",
    extensionType: "mcp",
    operation: "remove",
  });
  assert.equal(removed.status, "applied");
  assert.equal(removed.lifecycleState, "removed");

  const second = await connectorGateway.sync({
    sourceUri: "C:/mcp/git-server",
    serverId: "git-server",
    enableAfterSync: true,
  });

  assert.equal(second.status, "applied");
  assert.equal(second.operation, "install");
  assert.equal(second.lifecycleState, "enabled");
});

test("mcp connector rejects request-level approval policy overrides", async () => {
  const mcpAdapter = createGitMcpAdapter({
    tools: [{ toolId: "repo.status", permissions: ["git.write"] }],
  });
  const { connectorGateway } = setupMcpConnector({
    mcpAdapter,
    connectorPolicy: {
      approvalRequiredPermissions: ["git.write"],
    },
  });

  await assert.rejects(
    async () =>
      connectorGateway.sync({
        sourceUri: "C:/mcp/git-server",
        serverId: "git-server",
        approvalRequiredPermissions: [],
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("mcp connector rejects invalid request shape deterministically", async () => {
  const mcpAdapter = createGitMcpAdapter({
    tools: [{ toolId: "repo.status", permissions: ["git.read"] }],
  });
  const { connectorGateway } = setupMcpConnector({ mcpAdapter });

  await assert.rejects(
    async () =>
      connectorGateway.sync({
        sourceUri: "",
        serverId: "git-server",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
