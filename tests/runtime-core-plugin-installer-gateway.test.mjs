import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createExtensionAdapterRegistry,
  createPluginCapabilityAdapter as createPluginCapabilityAdapterImpl,
  mapPluginDescriptor,
  verifyPluginAuthBindings,
} from "../packages/polar-adapter-extensions/src/index.mjs";
import {
  createContractRegistry,
  createExtensionGateway,
  createMiddlewarePipeline,
  createPluginInstallerGateway,
  registerExtensionContracts,
  registerPluginInstallerContract,
} from "../packages/polar-runtime-core/src/index.mjs";

/**
 * @param {{
 *   invokeOperation?: (request: Record<string, unknown>) => Promise<unknown>|unknown
 * }} [options]
 */
function createPluginAdapter(options = {}) {
  return {
    mapPluginDescriptor,
    verifyPluginAuthBindings,
    createPluginCapabilityAdapter(config) {
      return createPluginCapabilityAdapterImpl({
        ...config,
        async invokeOperation(request) {
          if (options.invokeOperation) {
            return await options.invokeOperation(request);
          }

          return {
            ok: true,
            operationId: request.operationId,
            path: request.path,
          };
        },
      });
    },
  };
}

function setupPluginInstaller({
  pluginPolicy = {},
  extensionPolicy,
  middleware = [],
  invokeOperation,
} = {}) {
  const contractRegistry = createContractRegistry();
  registerExtensionContracts(contractRegistry);
  registerPluginInstallerContract(contractRegistry);

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

  const pluginInstallerGateway = createPluginInstallerGateway({
    middlewarePipeline,
    extensionGateway,
    extensionRegistry,
    pluginAdapter: createPluginAdapter({ invokeOperation }),
    policy: pluginPolicy,
  });

  return {
    pluginInstallerGateway,
    extensionGateway,
    extensionRegistry,
    auditEvents,
  };
}

function createPluginDescriptor({
  authType = "none",
  permissions = [],
  capabilities = [],
} = {}) {
  const resolvedCapabilities =
    capabilities.length > 0
      ? capabilities
      : [
          {
            operationId: "search.query",
            method: "POST",
            path: "/search",
          },
        ];

  return {
    id: "Search Plugin",
    description_for_model: "Search web content",
    auth: {
      type: authType,
    },
    permissions,
    capabilities: resolvedCapabilities,
  };
}

test("registerPluginInstallerContract registers plugin installer contract once", () => {
  const contractRegistry = createContractRegistry();
  registerPluginInstallerContract(contractRegistry);
  registerPluginInstallerContract(contractRegistry);

  assert.deepEqual(contractRegistry.list(), ["plugin.install.from-descriptor@1"]);
});

test("plugin installer rejects install when required auth bindings are missing", async () => {
  const { pluginInstallerGateway } = setupPluginInstaller();

  const descriptor = createPluginDescriptor({
    authType: "service_http",
    permissions: ["net.http"],
  });
  const parsed = mapPluginDescriptor({
    pluginDescriptor: descriptor,
  });

  const result = await pluginInstallerGateway.install({
    sourceUri: "C:/plugins/search/ai-plugin.json",
    pluginDescriptor: descriptor,
  });

  assert.deepEqual(result, {
    status: "rejected",
    extensionId: "plugin.search-plugin",
    operation: "install",
    trustLevel: "reviewed",
    lifecycleStatus: "rejected",
    lifecycleState: "installed",
    permissionDelta: {
      added: ["net.http", "plugin.operation.search.query"],
      removed: [],
      retained: [],
    },
    capabilityIds: ["plugin.search-plugin.search.query"],
    descriptorHash: parsed.descriptorHash,
    authBinding: {
      ok: false,
      status: "missing",
      requiredSchemes: ["service_http"],
      providedSchemes: [],
      missingSchemes: ["service_http"],
    },
    reason: "Plugin auth bindings are missing required schemes",
  });
});

test("plugin installer honors middleware-patched auth bindings", async () => {
  const { pluginInstallerGateway } = setupPluginInstaller({
    middleware: [
      {
        id: "inject-auth-bindings",
        before(context) {
          if (context.actionId !== "plugin.install.from-descriptor") {
            return undefined;
          }

          return {
            input: {
              ...context.input,
              authBindings: {
                service_http: {
                  token: "secret-token",
                },
              },
            },
          };
        },
      },
    ],
  });

  const descriptor = createPluginDescriptor({
    authType: "service_http",
    permissions: [],
  });
  const parsed = mapPluginDescriptor({
    pluginDescriptor: descriptor,
  });

  const result = await pluginInstallerGateway.install({
    sourceUri: "C:/plugins/search/ai-plugin.json",
    pluginDescriptor: descriptor,
  });

  assert.deepEqual(result, {
    status: "applied",
    extensionId: "plugin.search-plugin",
    operation: "install",
    trustLevel: "reviewed",
    lifecycleStatus: "applied",
    lifecycleState: "installed",
    permissionDelta: {
      added: ["plugin.operation.search.query"],
      removed: [],
      retained: [],
    },
    capabilityIds: ["plugin.search-plugin.search.query"],
    descriptorHash: parsed.descriptorHash,
    authBinding: {
      ok: true,
      status: "bound",
      requiredSchemes: ["service_http"],
      providedSchemes: ["service_http"],
      missingSchemes: [],
    },
  });
});

test("plugin installer installs trusted plugin, auto-enables, and executes wrapped capability", async () => {
  const { pluginInstallerGateway, extensionGateway, auditEvents } = setupPluginInstaller({
    pluginPolicy: {
      trustedSourcePrefixes: ["https://plugins.example/"],
      approvalRequiredPermissions: ["net.http"],
      autoEnableTrusted: true,
    },
    async invokeOperation(request) {
      return {
        operationId: request.operationId,
        q: request.input?.q ?? "",
      };
    },
  });

  const descriptor = createPluginDescriptor({
    authType: "none",
    permissions: ["net.http"],
  });
  const parsed = mapPluginDescriptor({
    pluginDescriptor: descriptor,
  });

  const installed = await pluginInstallerGateway.install({
    traceId: "trace-plugin-install-1",
    sourceUri: "https://plugins.example/search",
    pluginDescriptor: descriptor,
    expectedDescriptorHash: parsed.descriptorHash,
    approvalTicket: "APP-PLUGIN-1",
  });

  assert.deepEqual(installed, {
    status: "applied",
    extensionId: "plugin.search-plugin",
    operation: "install",
    trustLevel: "trusted",
    lifecycleStatus: "applied",
    lifecycleState: "enabled",
    permissionDelta: {
      added: ["net.http", "plugin.operation.search.query"],
      removed: [],
      retained: [],
    },
    capabilityIds: ["plugin.search-plugin.search.query"],
    descriptorHash: parsed.descriptorHash,
    authBinding: {
      ok: true,
      status: "bound",
      requiredSchemes: [],
      providedSchemes: [],
      missingSchemes: [],
    },
  });

  const executed = await extensionGateway.execute({
    extensionId: "plugin.search-plugin",
    extensionType: "plugin",
    capabilityId: "plugin.search-plugin.search.query",
    sessionId: "s1",
    userId: "u1",
    capabilityScope: {
      allowedDomains: ["example.com"],
    },
    input: {
      q: "polar",
    },
  });

  assert.deepEqual(executed, {
    status: "completed",
    extensionId: "plugin.search-plugin",
    extensionType: "plugin",
    capabilityId: "plugin.search-plugin.search.query",
    trustLevel: "trusted",
    output: {
      extensionId: "plugin.search-plugin",
      pluginId: "search-plugin",
      capabilityId: "plugin.search-plugin.search.query",
      descriptorHash: parsed.descriptorHash,
      operationId: "search.query",
      method: "POST",
      path: "/search",
      result: {
        operationId: "search.query",
        q: "polar",
      },
    },
  });

  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "plugin.install.from-descriptor" &&
        event.traceId === "trace-plugin-install-1",
    ),
  );
  assert.ok(
    auditEvents.some((event) => event.actionId === "extension.lifecycle.apply"),
  );
});

test("plugin installer upgrade requires approval for new high-risk permission", async () => {
  const { pluginInstallerGateway } = setupPluginInstaller({
    pluginPolicy: {
      trustedSourcePrefixes: ["https://plugins.example/"],
      approvalRequiredPermissions: ["net.http"],
    },
  });

  const baseDescriptor = createPluginDescriptor({
    authType: "none",
    permissions: [],
  });

  const firstInstall = await pluginInstallerGateway.install({
    sourceUri: "https://plugins.example/search",
    pluginDescriptor: baseDescriptor,
    enableAfterInstall: true,
  });
  assert.equal(firstInstall.status, "applied");

  const upgradedDescriptor = createPluginDescriptor({
    authType: "none",
    permissions: ["net.http"],
  });
  const parsedUpgrade = mapPluginDescriptor({
    pluginDescriptor: upgradedDescriptor,
  });

  const rejectedUpgrade = await pluginInstallerGateway.install({
    sourceUri: "https://plugins.example/search",
    pluginDescriptor: upgradedDescriptor,
    expectedDescriptorHash: parsedUpgrade.descriptorHash,
  });

  assert.deepEqual(rejectedUpgrade, {
    status: "rejected",
    extensionId: "plugin.search-plugin",
    operation: "upgrade",
    trustLevel: "trusted",
    lifecycleStatus: "rejected",
    lifecycleState: "enabled",
    permissionDelta: {
      added: ["net.http"],
      removed: [],
      retained: ["plugin.operation.search.query"],
    },
    capabilityIds: ["plugin.search-plugin.search.query"],
    descriptorHash: parsedUpgrade.descriptorHash,
    authBinding: {
      ok: true,
      status: "bound",
      requiredSchemes: [],
      providedSchemes: [],
      missingSchemes: [],
    },
    reason: "Plugin install requires approval ticket for permission delta",
  });

  const appliedUpgrade = await pluginInstallerGateway.install({
    sourceUri: "https://plugins.example/search",
    pluginDescriptor: upgradedDescriptor,
    expectedDescriptorHash: parsedUpgrade.descriptorHash,
    approvalTicket: "APP-PLUGIN-2",
  });

  assert.equal(appliedUpgrade.status, "applied");
  assert.equal(appliedUpgrade.operation, "upgrade");
});

test("plugin installer treats removed extension as fresh install on reinstall", async () => {
  const { pluginInstallerGateway, extensionGateway } = setupPluginInstaller();

  const descriptor = createPluginDescriptor();

  const installed = await pluginInstallerGateway.install({
    sourceUri: "C:/plugins/search/ai-plugin.json",
    pluginDescriptor: descriptor,
    enableAfterInstall: true,
  });
  assert.equal(installed.status, "applied");

  const removed = await extensionGateway.applyLifecycle({
    extensionId: "plugin.search-plugin",
    extensionType: "plugin",
    operation: "remove",
  });
  assert.equal(removed.status, "applied");
  assert.equal(removed.lifecycleState, "removed");

  const reinstalled = await pluginInstallerGateway.install({
    sourceUri: "C:/plugins/search/ai-plugin.json",
    pluginDescriptor: descriptor,
    enableAfterInstall: true,
  });

  assert.equal(reinstalled.status, "applied");
  assert.equal(reinstalled.operation, "install");
  assert.equal(reinstalled.lifecycleState, "enabled");
});

test("plugin installer rejects request-level approval policy overrides", async () => {
  const { pluginInstallerGateway } = setupPluginInstaller({
    pluginPolicy: {
      approvalRequiredPermissions: ["net.http"],
    },
  });

  const descriptor = createPluginDescriptor({
    permissions: ["net.http"],
  });

  await assert.rejects(
    async () =>
      pluginInstallerGateway.install({
        sourceUri: "C:/plugins/search/ai-plugin.json",
        pluginDescriptor: descriptor,
        approvalRequiredPermissions: [],
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
