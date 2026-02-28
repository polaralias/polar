import test from "node:test";
import assert from "node:assert/strict";

import {
  createSkillCapabilityAdapter,
  createExtensionAdapterRegistry,
  parseSkillManifest,
  verifySkillProvenance,
} from "../packages/polar-adapter-extensions/src/index.mjs";
import {
  createExtensionGateway,
  createMcpConnectorGateway,
  createSkillInstallerGateway,
  createSkillRegistry,
} from "../packages/polar-runtime-core/src/index.mjs";
import { computeCapabilityScope } from "../packages/polar-runtime-core/src/capability-scope.mjs";

function createSkillInstallHarness({ providerGateway } = {}) {
  const middlewarePipeline = {
    async run(context, next) {
      return next(context.input);
    },
  };

  const extensionRegistry = createExtensionAdapterRegistry();
  const extensionGateway = createExtensionGateway({
    middlewarePipeline,
    extensionRegistry,
  });
  const skillRegistry = createSkillRegistry();

  const installerGateway = createSkillInstallerGateway({
    middlewarePipeline,
    extensionGateway,
    extensionRegistry,
    skillRegistry,
    providerGateway: providerGateway ?? {
      async generate() {
        throw new Error("providerGateway.generate should not be called in install() path");
      },
    },
    skillAdapter: {
      parseSkillManifest,
      verifySkillProvenance,
      createSkillCapabilityAdapter,
    },
    policy: {
      trustedSourcePrefixes: ["https://safe.local/"],
      autoEnableTrusted: true,
    },
  });

  const mcpConnectorGateway = createMcpConnectorGateway({
    middlewarePipeline,
    extensionGateway,
    extensionRegistry,
    skillRegistry,
    mcpAdapter: {
      async probeConnection() {
        return { healthy: true, status: "ok" };
      },
      async importToolCatalog() {
        return {
          extensionId: "mcp.docs",
          serverId: "docs",
          catalogHash: "catalog-hash-1",
          permissions: [],
          capabilities: [
            {
              capabilityId: "mcp.docs.search",
              toolId: "search_docs",
              // Intentionally missing risk metadata to verify enforcement
            },
          ],
        };
      },
      createCapabilityAdapter() {
        return {
          async executeCapability() {
            return { ok: true };
          },
        };
      },
    },
  });

  return {
    installerGateway,
    mcpConnectorGateway,
    extensionGateway,
    skillRegistry,
  };
}

function createMissingMetadataSkillManifest() {
  return `---
name: docs-helper
description: Assist with docs
---
## Capabilities
- \`docs.search\` : Search docs content
`;
}

test("skill install blocks when per-capability risk metadata is missing", async () => {
  const { installerGateway, skillRegistry } = createSkillInstallHarness();

  const manifest = createMissingMetadataSkillManifest();
  const parsed = parseSkillManifest(manifest);
  const result = await installerGateway.install({
    sourceUri: "https://safe.local/skills/docs-helper/SKILL.md",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    pinnedRevision: "rev-1",
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "Skill metadata required");
  assert.ok(Array.isArray(result.missingMetadata));
  assert.deepEqual(result.missingMetadata[0], {
    capabilityId: "docs.search",
    missingFields: ["riskLevel", "sideEffects"],
  });
  assert.equal(skillRegistry.isBlocked("skill.docs-helper"), true);
});

test("metadata override flow requires explanation and then allows install", async () => {
  const { installerGateway, extensionGateway, skillRegistry } = createSkillInstallHarness();

  const manifest = createMissingMetadataSkillManifest();
  const parsed = parseSkillManifest(manifest);

  const firstAttempt = await installerGateway.install({
    sourceUri: "https://safe.local/skills/docs-helper/SKILL.md",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    pinnedRevision: "rev-1",
  });
  assert.equal(firstAttempt.status, "rejected");
  assert.equal(firstAttempt.reason, "Skill metadata required");

  assert.throws(
    () =>
      skillRegistry.submitOverride({
        extensionId: "skill.docs-helper",
        capabilityId: "docs.search",
        metadata: {
          riskLevel: "read",
          sideEffects: "none",
          explanation: "bad",
        },
      }),
    /Metadata override requires an explanation/,
  );

  skillRegistry.submitOverride({
    extensionId: "skill.docs-helper",
    capabilityId: "docs.search",
    metadata: {
      riskLevel: "read",
      sideEffects: "none",
      explanation: "Docs search is read-only and has no side effects.",
    },
  });

  const secondAttempt = await installerGateway.install({
    sourceUri: "https://safe.local/skills/docs-helper/SKILL.md",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    pinnedRevision: "rev-1",
  });

  assert.equal(secondAttempt.status, "applied");
  assert.equal(secondAttempt.lifecycleState, "enabled");

  const state = extensionGateway.getState("skill.docs-helper");
  const capability = state.capabilities.find((c) => c.capabilityId === "docs.search");
  assert.equal(capability.riskLevel, "read");
  assert.equal(capability.sideEffects, "none");
  assert.equal(capability.metadataSource, "operator");
});

test("mcp sync blocks install when capability risk metadata is missing", async () => {
  const { mcpConnectorGateway } = createSkillInstallHarness();

  const result = await mcpConnectorGateway.sync({
    sourceUri: "https://safe.local/mcp/docs",
    serverId: "docs",
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "MCP metadata required");
  assert.ok(Array.isArray(result.missingMetadata));
  assert.deepEqual(result.missingMetadata[0], {
    capabilityId: "mcp.docs.search",
    missingFields: ["riskLevel", "sideEffects"],
  });
});

test("installed enabled skill is projected into capabilityScope for orchestrator/sub-agents", async () => {
  const { installerGateway, extensionGateway, skillRegistry } = createSkillInstallHarness();

  const manifest = createMissingMetadataSkillManifest();
  const parsed = parseSkillManifest(manifest);

  const firstAttempt = await installerGateway.install({
    sourceUri: "https://safe.local/skills/docs-helper/SKILL.md",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    pinnedRevision: "rev-2",
  });
  assert.equal(firstAttempt.status, "rejected");

  skillRegistry.submitOverride({
    extensionId: "skill.docs-helper",
    capabilityId: "docs.search",
    metadata: {
      riskLevel: "read",
      sideEffects: "none",
      explanation: "Docs search reads indexed content without external effects.",
    },
  });

  const installed = await installerGateway.install({
    sourceUri: "https://safe.local/skills/docs-helper/SKILL.md",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    pinnedRevision: "rev-2",
  });
  assert.equal(installed.status, "applied");
  assert.equal(installed.lifecycleState, "enabled");

  const scope = computeCapabilityScope({
    sessionProfile: { profileConfig: { allowedSkills: ["skill.docs-helper"] } },
    installedExtensions: extensionGateway.listStates(),
  });

  assert.deepEqual(scope.allowed["skill.docs-helper"], ["docs.search"]);
  assert.deepEqual(scope.rejectedSkills, []);
});

test("runtime install/execute path never regenerates manifests via provider gateway", async () => {
  const providerCalls = [];
  const { installerGateway, extensionGateway, skillRegistry } = createSkillInstallHarness({
    providerGateway: {
      async generate(request) {
        providerCalls.push(request);
        return { text: "{}" };
      },
    },
  });

  const manifest = createMissingMetadataSkillManifest();
  const parsed = parseSkillManifest(manifest);

  const firstAttempt = await installerGateway.install({
    sourceUri: "https://safe.local/skills/docs-helper/SKILL.md",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    pinnedRevision: "rev-runtime-check",
  });
  assert.equal(firstAttempt.status, "rejected");

  skillRegistry.submitOverride({
    extensionId: "skill.docs-helper",
    capabilityId: "docs.search",
    metadata: {
      riskLevel: "read",
      sideEffects: "none",
      explanation: "Read-only docs search with no external effects.",
    },
  });

  const installed = await installerGateway.install({
    sourceUri: "https://safe.local/skills/docs-helper/SKILL.md",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    pinnedRevision: "rev-runtime-check",
  });
  assert.equal(installed.status, "applied");

  const scope = computeCapabilityScope({
    sessionProfile: { profileConfig: { allowedSkills: ["skill.docs-helper"] } },
    installedExtensions: extensionGateway.listStates(),
  });

  const executed = await extensionGateway.execute({
    extensionId: "skill.docs-helper",
    extensionType: "skill",
    capabilityId: "docs.search",
    sessionId: "s-runtime-check",
    userId: "u-runtime-check",
    capabilityScope: scope,
    input: { query: "policy" },
  });

  assert.equal(executed.status, "completed");
  assert.equal(providerCalls.length, 0);
});
