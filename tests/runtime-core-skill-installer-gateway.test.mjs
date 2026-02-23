import test from "node:test";
import assert from "node:assert/strict";

import { ContractValidationError } from "../packages/polar-domain/src/index.mjs";
import {
  createSkillCapabilityAdapter,
  createExtensionAdapterRegistry,
  parseSkillManifest,
  verifySkillProvenance,
} from "../packages/polar-adapter-extensions/src/index.mjs";
import {
  createContractRegistry,
  createExtensionGateway,
  createMiddlewarePipeline,
  createSkillInstallerGateway,
  registerExtensionContracts,
  registerSkillInstallerContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupSkillInstaller({
  skillPolicy = {},
  extensionPolicy,
  middleware = [],
} = {}) {
  const contractRegistry = createContractRegistry();
  registerExtensionContracts(contractRegistry);
  registerSkillInstallerContract(contractRegistry);

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

  const installerGateway = createSkillInstallerGateway({
    middlewarePipeline,
    extensionGateway,
    extensionRegistry,
    skillAdapter: {
      parseSkillManifest,
      verifySkillProvenance,
      createSkillCapabilityAdapter,
    },
    policy: skillPolicy,
  });

  return {
    installerGateway,
    extensionGateway,
    extensionRegistry,
    auditEvents,
  };
}

function createSkillManifest({ permissions = [], capabilities = [] } = {}) {
  const permissionBlock =
    permissions.length === 0
      ? ""
      : `permissions:\n${permissions.map((permission) => `  - ${permission}`).join("\n")}\n`;
  const capabilityBlock =
    capabilities.length === 0
      ? ""
      : `\n## Capabilities\n${capabilities
        .map((capability) => `- ${capability}`)
        .join("\n")}\n`;

  return `---
name: docs-helper
description: Assist with documentation tasks
${permissionBlock}---
${capabilityBlock}
## Permissions
- fs.read
`;
}

test("registerSkillInstallerContract registers installer contract once", () => {
  const contractRegistry = createContractRegistry();
  registerSkillInstallerContract(contractRegistry);
  registerSkillInstallerContract(contractRegistry);

  assert.deepEqual(contractRegistry.list(), ["skill.install.from-manifest@1"]);
});

test("skill installer rejects permission-delta install without approval ticket", async () => {
  const { installerGateway } = setupSkillInstaller({
    skillPolicy: {
      trustedSourcePrefixes: ["https://github.com/openai/skills/"],
      approvalRequiredPermissions: ["net.http"],
    },
  });

  const manifest = createSkillManifest({
    permissions: ["net.http"],
    capabilities: ["docs.search"],
  });
  const parsed = parseSkillManifest(manifest);

  const result = await installerGateway.install({
    sourceUri: "https://github.com/openai/skills/tree/main/skills/docs-helper",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    pinnedRevision: "abc123",
  });

  assert.deepEqual(result, {
    status: "rejected",
    extensionId: "skill.docs-helper",
    operation: "install",
    trustLevel: "trusted",
    lifecycleStatus: "rejected",
    lifecycleState: "installed",
    permissionDelta: {
      added: ["fs.read", "net.http"],
      removed: [],
      retained: [],
    },
    capabilityIds: ["docs.search"],
    manifestHash: parsed.manifestHash,
    provenance: {
      sourceUri: "https://github.com/openai/skills/tree/main/skills/docs-helper",
      sourceType: "remote",
      pinnedRevision: "abc123",
      manifestHash: parsed.manifestHash,
      hashMatched: true,
      trustLevelRecommendation: "trusted",
    },
    reason: "Skill install requires approval ticket for permission delta",
  });
});

test("skill installer installs, auto-enables trusted skill, and executes capability", async () => {
  const { installerGateway, extensionGateway, auditEvents } = setupSkillInstaller({
    skillPolicy: {
      trustedSourcePrefixes: ["https://github.com/openai/skills/"],
      approvalRequiredPermissions: ["net.http"],
      autoEnableTrusted: true,
    },
  });

  const manifest = createSkillManifest({
    permissions: ["net.http"],
    capabilities: ["docs.search", "docs.summarize"],
  });
  const parsed = parseSkillManifest(manifest);

  const installed = await installerGateway.install({
    traceId: "trace-skill-install-1",
    sourceUri: "https://github.com/openai/skills/tree/main/skills/docs-helper",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    pinnedRevision: "abc123",
    approvalTicket: "APP-101",
  });

  assert.deepEqual(installed, {
    status: "applied",
    extensionId: "skill.docs-helper",
    operation: "install",
    trustLevel: "trusted",
    lifecycleStatus: "applied",
    lifecycleState: "enabled",
    permissionDelta: {
      added: ["fs.read", "net.http"],
      removed: [],
      retained: [],
    },
    capabilityIds: ["docs.search", "docs.summarize"],
    manifestHash: parsed.manifestHash,
    provenance: {
      sourceUri: "https://github.com/openai/skills/tree/main/skills/docs-helper",
      sourceType: "remote",
      pinnedRevision: "abc123",
      manifestHash: parsed.manifestHash,
      hashMatched: true,
      trustLevelRecommendation: "trusted",
    },
  });

  const executed = await extensionGateway.execute({
    extensionId: "skill.docs-helper",
    extensionType: "skill",
    capabilityId: "docs.search",
    sessionId: "s1",
    userId: "u1",
    capabilityScope: {
      allowedTools: ["search"],
    },
    input: {
      q: "polar",
    },
  });

  assert.deepEqual(executed, {
    status: "completed",
    extensionId: "skill.docs-helper",
    extensionType: "skill",
    capabilityId: "docs.search",
    trustLevel: "trusted",
    output: {
      extensionId: "skill.docs-helper",
      capabilityId: "docs.search",
      manifestHash: parsed.manifestHash,
      status: "completed",
      message: "Skill capability \"docs.search\" executed with default adapter",
    },
  });

  assert.ok(
    auditEvents.some(
      (event) =>
        event.actionId === "skill.install.from-manifest" &&
        event.traceId === "trace-skill-install-1",
    ),
  );
  assert.ok(
    auditEvents.some((event) => event.actionId === "extension.lifecycle.apply"),
  );
});

test("skill installer upgrade requires approval on newly added high-risk permission", async () => {
  const { installerGateway } = setupSkillInstaller({
    skillPolicy: {
      trustedSourcePrefixes: ["https://github.com/openai/skills/"],
      approvalRequiredPermissions: ["net.http"],
      autoEnableTrusted: false,
    },
  });

  const initialManifest = createSkillManifest({
    permissions: [],
    capabilities: ["docs.search"],
  });
  const parsedInitial = parseSkillManifest(initialManifest);

  const initialInstall = await installerGateway.install({
    sourceUri: "https://github.com/openai/skills/tree/main/skills/docs-helper",
    skillManifest: initialManifest,
    expectedHash: parsedInitial.manifestHash,
    pinnedRevision: "abc123",
    enableAfterInstall: true,
  });
  assert.equal(initialInstall.status, "applied");

  const upgradedManifest = createSkillManifest({
    permissions: ["net.http"],
    capabilities: ["docs.search"],
  });
  const parsedUpgraded = parseSkillManifest(upgradedManifest);

  const upgradeRejected = await installerGateway.install({
    sourceUri: "https://github.com/openai/skills/tree/main/skills/docs-helper",
    skillManifest: upgradedManifest,
    expectedHash: parsedUpgraded.manifestHash,
    pinnedRevision: "def456",
  });

  assert.deepEqual(upgradeRejected, {
    status: "rejected",
    extensionId: "skill.docs-helper",
    operation: "upgrade",
    trustLevel: "trusted",
    lifecycleStatus: "rejected",
    lifecycleState: "enabled",
    permissionDelta: {
      added: ["net.http"],
      removed: [],
      retained: ["fs.read"],
    },
    capabilityIds: ["docs.search"],
    manifestHash: parsedUpgraded.manifestHash,
    provenance: {
      sourceUri: "https://github.com/openai/skills/tree/main/skills/docs-helper",
      sourceType: "remote",
      pinnedRevision: "def456",
      manifestHash: parsedUpgraded.manifestHash,
      hashMatched: true,
      trustLevelRecommendation: "trusted",
    },
    reason: "Skill install requires approval ticket for permission delta",
  });

  const upgradeApplied = await installerGateway.install({
    sourceUri: "https://github.com/openai/skills/tree/main/skills/docs-helper",
    skillManifest: upgradedManifest,
    expectedHash: parsedUpgraded.manifestHash,
    pinnedRevision: "def456",
    approvalTicket: "APP-202",
  });

  assert.equal(upgradeApplied.status, "applied");
  assert.equal(upgradeApplied.operation, "upgrade");
});

test("skill installer treats removed extensions as fresh install on reinstall", async () => {
  const { installerGateway, extensionGateway } = setupSkillInstaller();

  const manifest = createSkillManifest({
    permissions: [],
    capabilities: ["docs.search"],
  });
  const parsed = parseSkillManifest(manifest);

  const firstInstall = await installerGateway.install({
    sourceUri: "C:/skills/docs-helper/SKILL.md",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    enableAfterInstall: true,
  });
  assert.equal(firstInstall.status, "applied");

  const removed = await extensionGateway.applyLifecycle({
    extensionId: "skill.docs-helper",
    extensionType: "skill",
    operation: "remove",
  });
  assert.equal(removed.status, "applied");
  assert.equal(removed.lifecycleState, "removed");

  const reinstalled = await installerGateway.install({
    sourceUri: "C:/skills/docs-helper/SKILL.md",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    enableAfterInstall: true,
  });

  assert.equal(reinstalled.status, "applied");
  assert.equal(reinstalled.operation, "install");
  assert.equal(reinstalled.lifecycleState, "enabled");
});

test("skill installer rejects request-level approval policy overrides", async () => {
  const { installerGateway } = setupSkillInstaller({
    skillPolicy: {
      approvalRequiredPermissions: ["net.http"],
    },
  });

  const manifest = createSkillManifest({
    permissions: ["net.http"],
    capabilities: ["docs.search"],
  });
  const parsed = parseSkillManifest(manifest);

  await assert.rejects(
    async () =>
      installerGateway.install({
        sourceUri: "C:/skills/docs-helper/SKILL.md",
        skillManifest: manifest,
        expectedHash: parsed.manifestHash,
        approvalRequiredPermissions: [],
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("skill installer rejects blocked provenance and invalid manifests deterministically", async () => {
  const { installerGateway } = setupSkillInstaller({
    skillPolicy: {
      blockedSourcePrefixes: ["https://malicious.example/"],
    },
  });

  const manifest = createSkillManifest({
    permissions: [],
    capabilities: ["docs.search"],
  });
  const parsed = parseSkillManifest(manifest);

  const blocked = await installerGateway.install({
    sourceUri: "https://malicious.example/skills/docs-helper",
    skillManifest: manifest,
    expectedHash: parsed.manifestHash,
    pinnedRevision: "abc123",
  });

  assert.equal(blocked.status, "rejected");
  assert.equal(blocked.reason, "Skill provenance verification failed");
  assert.equal(blocked.trustLevel, "blocked");

  await assert.rejects(
    async () =>
      installerGateway.install({
        sourceUri: "C:/skills/docs-helper/SKILL.md",
        skillManifest: "invalid",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
