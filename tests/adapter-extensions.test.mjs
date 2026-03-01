import test from "node:test";
import assert from "node:assert/strict";

import {
  createMcpConnectionAdapter,
  createExtensionAdapterRegistry,
  mapMcpToolCatalog,
  mapPluginDescriptor,
  createPermissionDeltaReport,
  createPluginCapabilityAdapter,
  createSkillCapabilityAdapter,
  parseSkillManifest,
  verifyPluginAuthBindings,
  verifyMcpConnectionHealth,
  verifySkillProvenance,
} from "../packages/polar-adapter-extensions/src/index.mjs";

test("extension adapter registry validates adapters and lists ids deterministically", () => {
  const registry = createExtensionAdapterRegistry();
  registry.register("skill.docs", {
    async executeCapability() {
      return {};
    },
  });
  registry.register("mcp.git", {
    async executeCapability() {
      return {};
    },
  });

  assert.equal(typeof registry.get("skill.docs").executeCapability, "function");
  assert.deepEqual(registry.list(), ["mcp.git", "skill.docs"]);
});

test("extension adapter registry rejects duplicate ids and invalid adapters", () => {
  const registry = createExtensionAdapterRegistry();
  registry.register("plugin.search", {
    async executeCapability() {
      return {};
    },
  });

  assert.throws(
    () => registry.register("plugin.search", { executeCapability() { } }),
    /already registered/,
  );
  assert.throws(
    () => registry.register("plugin.bad", {}),
    /must expose executeCapability/,
  );
});

test("extension adapter registry upsert replaces adapter deterministically", async () => {
  const registry = createExtensionAdapterRegistry();
  registry.register("skill.docs", {
    async executeCapability() {
      return { version: 1 };
    },
  });
  registry.upsert("skill.docs", {
    async executeCapability() {
      return { version: 2 };
    },
  });

  const result = await registry.get("skill.docs").executeCapability({});
  assert.deepEqual(result, { version: 2 });
});

test("createPermissionDeltaReport returns deterministic added/removed/retained sets", () => {
  const delta = createPermissionDeltaReport(
    ["net.http", "fs.read", "fs.read", "mcp.search"],
    ["mcp.search", "skill.exec", "fs.read", "skill.exec"],
  );

  assert.deepEqual(delta, {
    added: ["skill.exec"],
    removed: ["net.http"],
    retained: ["fs.read", "mcp.search"],
  });
});

test("createPermissionDeltaReport validates invalid permission inputs", () => {
  assert.throws(
    () => createPermissionDeltaReport(["ok"], ["", "x"]),
    /must be a non-empty string/,
  );
  assert.throws(
    () => createPermissionDeltaReport(/** @type {unknown} */("bad"), ["x"]),
    /must be an array/,
  );
});

test("parseSkillManifest reads frontmatter, capabilities, and permissions", () => {
  const manifest = parseSkillManifest(`---
name: docs-helper
description: Assist with documentation lookups
permissions:
  - fs.read
---

## Capabilities
- \`docs.search\`: Search docs corpus
- docs.summarize: Summarize selected docs

## Permissions
- \`net.http\`
`);

  assert.deepEqual(manifest, {
    extensionId: "skill.docs-helper",
    extensionType: "skill",
    name: "docs-helper",
    description: "Assist with documentation lookups",
    manifestHash: manifest.manifestHash,
    permissions: ["fs.read", "net.http"],
    capabilities: [
      {
        capabilityId: "docs.search",
        description: "Search docs corpus",
        riskLevel: "unknown",
        sideEffects: "unknown",
        dataEgress: "unknown",
      },
      {
        capabilityId: "docs.summarize",
        description: "Summarize selected docs",
        riskLevel: "unknown",
        sideEffects: "unknown",
        dataEgress: "unknown",
      },
    ],
  });
  assert.equal(typeof manifest.manifestHash, "string");
  assert.equal(manifest.manifestHash.length, 64);
});

test("verifySkillProvenance enforces hash/pin checks and recommends trust", () => {
  const manifestText = `---
name: docs-helper
description: help
---
body`;
  const parsed = parseSkillManifest(manifestText);

  const provenance = verifySkillProvenance({
    sourceUri: "https://github.com/openai/skills/tree/main/skills/docs-helper",
    manifestContent: manifestText,
    expectedHash: parsed.manifestHash,
    pinnedRevision: "f00ba4",
    trustedSourcePrefixes: ["https://github.com/openai/skills/"],
  });

  assert.deepEqual(provenance, {
    sourceUri: "https://github.com/openai/skills/tree/main/skills/docs-helper",
    sourceType: "remote",
    pinnedRevision: "f00ba4",
    manifestHash: parsed.manifestHash,
    hashMatched: true,
    trustLevelRecommendation: "trusted",
  });
});

test("verifySkillProvenance rejects missing pin for remote and hash mismatch", () => {
  const manifestText = `---
name: docs-helper
description: help
---
body`;

  assert.throws(
    () =>
      verifySkillProvenance({
        sourceUri: "https://example.com/skill",
        manifestContent: manifestText,
      }),
    /pinnedRevision/,
  );

  assert.throws(
    () =>
      verifySkillProvenance({
        sourceUri: "C:/skills/docs-helper/SKILL.md",
        manifestContent: manifestText,
        expectedHash: "deadbeef",
      }),
    /does not match/,
  );
});

test("createSkillCapabilityAdapter executes known capabilities and rejects unknown ones", async () => {
  const manifest = parseSkillManifest(`---
name: docs-helper
description: Assist with docs
---

## Capabilities
- docs.search
`);

  const adapter = createSkillCapabilityAdapter({
    skillManifest: manifest,
    capabilityHandlers: {
      "docs.search": async (request) => ({
        query: request.input?.q ?? "",
      }),
    },
  });

  const output = await adapter.executeCapability({
    capabilityId: "docs.search",
    input: { q: "polar" },
  });
  assert.deepEqual(output, { query: "polar" });

  await assert.rejects(
    async () =>
      adapter.executeCapability({
        capabilityId: "docs.unknown",
      }),
    /Unknown skill capability/,
  );
});

test("mapPluginDescriptor normalizes operations into deterministic plugin capabilities", () => {
  const manifest = mapPluginDescriptor({
    pluginDescriptor: {
      id: "Web Search",
      description_for_model: "Search web pages",
      auth: {
        type: "service_http",
      },
      permissions: ["net.http"],
      capabilities: [
        {
          operationId: "search.query",
          method: "post",
          path: "/search",
          permissions: ["search.query"],
        },
        {
          id: "search.fetch",
          route: "/fetch",
        },
      ],
    },
  });

  assert.deepEqual(manifest, {
    extensionId: "plugin.web-search",
    extensionType: "plugin",
    pluginId: "web-search",
    name: "Web Search",
    description: "Search web pages",
    descriptorHash: manifest.descriptorHash,
    permissions: [
      "net.http",
      "plugin.operation.search.fetch",
      "plugin.operation.search.query",
      "search.query",
    ],
    requiredAuthSchemes: ["service_http"],
    capabilities: [
      {
        capabilityId: "plugin.web-search.search.fetch",
        operationId: "search.fetch",
        method: "POST",
        path: "/fetch",
        authScheme: "service_http",
        permissions: ["plugin.operation.search.fetch"],
      },
      {
        capabilityId: "plugin.web-search.search.query",
        operationId: "search.query",
        method: "POST",
        path: "/search",
        authScheme: "service_http",
        permissions: ["plugin.operation.search.query", "search.query"],
      },
    ],
  });
  assert.equal(typeof manifest.descriptorHash, "string");
  assert.equal(manifest.descriptorHash.length, 64);
});

test("verifyPluginAuthBindings reports missing required schemes deterministically", () => {
  const manifest = mapPluginDescriptor({
    pluginDescriptor: {
      id: "Search Plugin",
      auth: {
        type: "oauth",
      },
      capabilities: [
        {
          operationId: "search.query",
        },
      ],
    },
  });

  assert.deepEqual(
    verifyPluginAuthBindings({
      pluginManifest: manifest,
      authBindings: {},
    }),
    {
      ok: false,
      status: "missing",
      requiredSchemes: ["oauth"],
      providedSchemes: [],
      missingSchemes: ["oauth"],
    },
  );

  assert.deepEqual(
    verifyPluginAuthBindings({
      pluginManifest: manifest,
      authBindings: {
        oauth: {
          secretRef: "vault://plugins/search/oauth-token",
        },
      },
    }),
    {
      ok: true,
      status: "bound",
      requiredSchemes: ["oauth"],
      providedSchemes: ["oauth"],
      missingSchemes: [],
    },
  );
});

test("createPluginCapabilityAdapter executes known capability and rejects unknown ones", async () => {
  const pluginManifest = mapPluginDescriptor({
    pluginDescriptor: {
      id: "Search Plugin",
      auth: {
        type: "none",
      },
      capabilities: [
        {
          operationId: "search.query",
          method: "GET",
          path: "/search",
        },
      ],
    },
  });

  const adapter = createPluginCapabilityAdapter({
    pluginManifest,
    async invokeOperation(request) {
      return {
        operationId: request.operationId,
        q: request.input?.q ?? "",
      };
    },
  });

  const result = await adapter.executeCapability({
    capabilityId: "plugin.search-plugin.search.query",
    sessionId: "s1",
    userId: "u1",
    capabilityScope: {},
    input: {
      q: "polar",
    },
  });

  assert.deepEqual(result, {
    extensionId: "plugin.search-plugin",
    pluginId: "search-plugin",
    capabilityId: "plugin.search-plugin.search.query",
    descriptorHash: pluginManifest.descriptorHash,
    operationId: "search.query",
    method: "GET",
    path: "/search",
    result: {
      operationId: "search.query",
      q: "polar",
    },
  });

  await assert.rejects(
    async () =>
      adapter.executeCapability({
        capabilityId: "plugin.search-plugin.unknown",
      }),
    /Unknown plugin capability/,
  );
});

test("mapMcpToolCatalog maps tools to deterministic capability wrappers", () => {
  const manifest = mapMcpToolCatalog({
    serverId: "Git Server",
    tools: [
      {
        toolId: "repo.status",
        description: "Show repository status",
        permissions: ["git.read"],
      },
      {
        id: "repo.diff",
        permissions: ["git.read", "git.diff"],
      },
    ],
  });

  assert.deepEqual(manifest, {
    extensionId: "mcp.git-server",
    extensionType: "mcp",
    serverId: "Git Server",
    catalogHash: manifest.catalogHash,
    permissions: [
      "git.diff",
      "git.read",
      "mcp.tool.repo.diff",
      "mcp.tool.repo.status",
    ],
    capabilities: [
      {
        capabilityId: "mcp.git-server.repo.diff",
        toolId: "repo.diff",
        permissions: ["git.diff", "git.read", "mcp.tool.repo.diff"],
        riskLevel: "unknown",
        sideEffects: "unknown",
        dataEgress: "unknown",
      },
      {
        capabilityId: "mcp.git-server.repo.status",
        toolId: "repo.status",
        permissions: ["git.read", "mcp.tool.repo.status"],
        description: "Show repository status",
        riskLevel: "unknown",
        sideEffects: "unknown",
        dataEgress: "unknown",
      },
    ],
  });
  assert.equal(typeof manifest.catalogHash, "string");
  assert.equal(manifest.catalogHash.length, 64);
});

test("verifyMcpConnectionHealth normalizes health probes deterministically", () => {
  assert.deepEqual(
    verifyMcpConnectionHealth({
      ok: true,
      latencyMs: 12.8,
      details: { region: "us-east" },
    }),
    {
      healthy: true,
      status: "ok",
      latencyMs: 12,
      details: { region: "us-east" },
    },
  );

  assert.deepEqual(
    verifyMcpConnectionHealth({
      status: "degraded",
      reason: "timeout spikes",
    }),
    {
      healthy: false,
      status: "degraded",
      reason: "timeout spikes",
    },
  );
});

test("createMcpConnectionAdapter imports catalog and executes mapped tool capability", async () => {
  const adapter = createMcpConnectionAdapter({
    serverId: "Git Server",
    async probeConnection() {
      return {
        healthy: true,
        status: "ok",
        latencyMs: 20,
      };
    },
    async listTools() {
      return [
        {
          toolId: "repo.status",
          permissions: ["git.read"],
        },
      ];
    },
    async invokeTool(request) {
      return {
        toolId: request.toolId,
        ok: true,
      };
    },
  });

  const health = await adapter.probeConnection({});
  const manifest = await adapter.importToolCatalog({});
  const capabilityAdapter = adapter.createCapabilityAdapter(manifest);
  const output = await capabilityAdapter.executeCapability({
    capabilityId: "mcp.git-server.repo.status",
    sessionId: "s1",
    userId: "u1",
    capabilityScope: {},
    input: {},
  });

  assert.deepEqual(health, {
    healthy: true,
    status: "ok",
    latencyMs: 20,
  });
  assert.deepEqual(output, {
    extensionId: "mcp.git-server",
    serverId: "Git Server",
    toolId: "repo.status",
    capabilityId: "mcp.git-server.repo.status",
    catalogHash: manifest.catalogHash,
    result: {
      toolId: "repo.status",
      ok: true,
    },
  });
});
