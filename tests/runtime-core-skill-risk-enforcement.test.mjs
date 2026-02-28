import test from "node:test";
import assert from "node:assert/strict";
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
    createSkillRegistry,
    registerExtensionContracts,
    registerSkillInstallerContract,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupRiskTest() {
    const contractRegistry = createContractRegistry();
    registerExtensionContracts(contractRegistry);
    registerSkillInstallerContract(contractRegistry);

    const middlewarePipeline = createMiddlewarePipeline({
        contractRegistry,
        middleware: [],
    });

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
        skillAdapter: {
            parseSkillManifest,
            verifySkillProvenance,
            createSkillCapabilityAdapter,
        },
        policy: {
            autoEnableTrusted: true,
            trustedSourcePrefixes: ["https://safe.local/"],
        },
    });

    return {
        installerGateway,
        skillRegistry,
        extensionGateway
    };
}

test("Skill install is blocked if metadata is unknown", async () => {
    const { installerGateway, skillRegistry } = setupRiskTest();

    // Skill manifest with unknown risk (implicit or explicit)
    const manifest = `---
name: risk-skill
description: A skill with unknown risk
---
## Capabilities
- \`unknown_cap\` : This tool has no metadata brackets
`;
    const parsed = parseSkillManifest(manifest);

    const result = await installerGateway.install({
        sourceUri: "https://safe.local/risk-skill/SKILL.md",
        skillManifest: manifest,
        expectedHash: parsed.manifestHash,
        pinnedRevision: "rev-1",
    });

    assert.strictEqual(result.status, "rejected");
    assert.strictEqual(result.reason, "Skill metadata required");
    assert.ok(Array.isArray(result.missingMetadata));
    assert.strictEqual(result.missingMetadata[0].capabilityId, "unknown_cap");
    assert.deepEqual(result.missingMetadata[0].missingFields, ["riskLevel", "sideEffects"]);

    // Verify registry tracks it
    const blocked = skillRegistry.listBlocked();
    assert.strictEqual(blocked.length, 1);
    assert.strictEqual(blocked[0].extensionId, "skill.risk-skill");
    assert.ok(Array.isArray(blocked[0].missingMetadata));
    assert.strictEqual(blocked[0].missingMetadata[0].capabilityId, "unknown_cap");
});

test("Skill can be installed after submitting metadata overrides", async () => {
    const { installerGateway, skillRegistry, extensionGateway } = setupRiskTest();

    const manifest = `---
name: risk-skill
description: A skill with unknown risk
---
## Capabilities
- \`unknown_cap\` : This tool has no metadata brackets
`;
    const parsed = parseSkillManifest(manifest);

    // 1. Initial attempt fails
    await installerGateway.install({
        sourceUri: "https://safe.local/risk-skill/SKILL.md",
        skillManifest: manifest,
        pinnedRevision: "rev-1",
    });

    assert.strictEqual(skillRegistry.isBlocked("skill.risk-skill"), true);

    // 2. Submit override
    skillRegistry.submitOverride({
        extensionId: "skill.risk-skill",
        capabilityId: "unknown_cap",
        metadata: {
            riskLevel: 'read',
            sideEffects: 'none',
            explanation: 'This is just a log reader'
        }
    });

    // 3. Re-attempt install succeeds
    const result = await installerGateway.install({
        sourceUri: "https://safe.local/risk-skill/SKILL.md",
        skillManifest: manifest,
        pinnedRevision: "rev-1",
    });

    assert.strictEqual(result.status, "applied");
    assert.strictEqual(result.lifecycleState, "enabled");
    assert.strictEqual(skillRegistry.isBlocked("skill.risk-skill"), false);

    // 4. Verify enriched metadata is in gateway state
    const state = extensionGateway.getState("skill.risk-skill");
    const cap = state.capabilities.find(c => c.capabilityId === "unknown_cap");
    assert.strictEqual(cap.riskLevel, 'read');
    assert.strictEqual(cap.sideEffects, 'none');
    assert.strictEqual(cap.metadataSource, 'operator');
});

test("Skill install succeeds if metadata is provided in manifest", async () => {
    const { installerGateway } = setupRiskTest();

    const manifest = `---
name: safe-skill
description: A skill with explicit risk
---
## Capabilities
- \`safe_cap\` : Safe tool [risk: read, effects: none]
`;
    const parsed = parseSkillManifest(manifest);

    const result = await installerGateway.install({
        sourceUri: "https://safe.local/safe-skill/SKILL.md",
        skillManifest: manifest,
        pinnedRevision: "rev-1",
    });

    assert.strictEqual(result.status, "applied");
    assert.strictEqual(result.lifecycleState, "enabled");
});
