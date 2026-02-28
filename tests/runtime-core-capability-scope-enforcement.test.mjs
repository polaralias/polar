import test from "node:test";
import assert from "node:assert/strict";
import { computeCapabilityScope } from "../packages/polar-runtime-core/src/capability-scope.mjs";
import { createExtensionGateway } from "../packages/polar-runtime-core/src/extension-gateway.mjs";

test("capability-scope is non-empty by default and rejects unknown forwarded skills", () => {
    const scope = computeCapabilityScope({
        sessionProfile: { profileConfig: { allowedSkills: ["search_web"] } }
    });

    assert.ok(scope.allowed["system"].includes("lookup_weather"));
    assert.equal(scope.allowed["search_web"], undefined);
    assert.deepEqual(scope.rejectedSkills, ["search_web"]);
});

test("capability-scope includes only enabled installed extensions that are allowlisted", () => {
    const scope = computeCapabilityScope({
        sessionProfile: { profileConfig: { allowedSkills: ["web"] } },
        installedExtensions: [
            {
                extensionId: "web",
                lifecycleState: "enabled",
                capabilities: [
                    { capabilityId: "search_web" },
                    { capabilityId: "open_url" }
                ]
            },
            {
                extensionId: "email",
                lifecycleState: "disabled",
                capabilities: [{ capabilityId: "draft_email" }]
            }
        ]
    });

    assert.deepEqual(scope.allowed.web, ["search_web", "open_url"]);
    assert.equal(scope.allowed.email, undefined);
    assert.deepEqual(scope.rejectedSkills, []);
});

test("capability-scope projects enabled installed skills for orchestrator/sub-agent execution", () => {
    const scope = computeCapabilityScope({
        sessionProfile: { profileConfig: { allowedSkills: ["skill.docs-helper"] } },
        installedExtensions: [
            {
                extensionId: "skill.docs-helper",
                lifecycleState: "enabled",
                capabilities: [
                    { capabilityId: "docs.search" },
                    { capabilityId: "docs.summarize" }
                ]
            }
        ]
    });

    assert.deepEqual(scope.allowed["skill.docs-helper"], ["docs.search", "docs.summarize"]);
    assert.deepEqual(scope.rejectedSkills, []);
});

test("capability-scope prefers registry authority projection when provided", () => {
    const scope = computeCapabilityScope({
        sessionProfile: { profileConfig: { allowedSkills: ["skill.docs-helper"] } },
        installedExtensions: [
            {
                extensionId: "skill.docs-helper",
                lifecycleState: "enabled",
                capabilities: [{ capabilityId: "docs.search" }]
            }
        ],
        authorityStates: [
            {
                extensionId: "skill.docs-helper",
                lifecycleState: "enabled",
                capabilities: [
                    { capabilityId: "docs.search" },
                    { capabilityId: "docs.summarize" }
                ]
            }
        ]
    });

    assert.deepEqual(scope.allowed["skill.docs-helper"], ["docs.search", "docs.summarize"]);
    assert.deepEqual(scope.rejectedSkills, []);
});

test("capability-scope denies allowlisted skills that are not enabled in authority states", () => {
    const scope = computeCapabilityScope({
        sessionProfile: { profileConfig: { allowedSkills: ["skill.docs-helper"] } },
        installedExtensions: [
            {
                extensionId: "skill.docs-helper",
                lifecycleState: "enabled",
                capabilities: [{ capabilityId: "docs.search" }]
            }
        ],
        authorityStates: [
            {
                extensionId: "skill.docs-helper",
                lifecycleState: "pending_install",
                capabilities: [{ capabilityId: "docs.search" }]
            }
        ]
    });

    assert.equal(scope.allowed["skill.docs-helper"], undefined);
    assert.deepEqual(scope.rejectedSkills, ["skill.docs-helper"]);
});

test("extension-gateway blocks tool outside capabilityScope", async () => {
    let adapterCalls = 0;
    const gateway = createExtensionGateway({
        middlewarePipeline: { run: (ctx, next) => next(ctx.input) },
        extensionRegistry: {
            get: () => ({
                executeCapability: () => {
                    adapterCalls += 1;
                    return { status: "completed" };
                }
            })
        },
        initialStates: [{ extensionId: "web", extensionType: "mcp", trustLevel: "trusted", lifecycleState: "enabled", permissions: [] }]
    });

    // Valid call
    const okResult = await gateway.execute({
        extensionId: "web",
        extensionType: "mcp",
        capabilityId: "search_web",
        sessionId: "s1",
        userId: "u1",
        capabilityScope: { allowed: { "web": ["search_web"] } },
        input: {}
    });
    assert.equal(okResult.status, "completed");
    assert.equal(adapterCalls, 1);

    // Blocked call (wrong capability)
    const blockedCapResult = await gateway.execute({
        extensionId: "web",
        extensionType: "mcp",
        capabilityId: "delete_internet",
        sessionId: "s1",
        userId: "u1",
        capabilityScope: { allowed: { "web": ["search_web"] } },
        input: {}
    });
    assert.equal(blockedCapResult.status, "failed");
    assert.equal(blockedCapResult.error.code, "POLAR_EXTENSION_POLICY_DENIED");
    assert.equal(adapterCalls, 1);

    // Blocked call (wrong extension)
    const blockedExtResult = await gateway.execute({
        extensionId: "email",
        extensionType: "mcp",
        capabilityId: "draft_email",
        sessionId: "s1",
        userId: "u1",
        capabilityScope: { allowed: { "web": ["search_web"] } },
        input: {}
    });
    assert.equal(blockedExtResult.status, "failed");
    assert.equal(adapterCalls, 1);

    // Blocked call (empty capability scope)
    const blockedEmptyScope = await gateway.execute({
        extensionId: "web",
        extensionType: "mcp",
        capabilityId: "search_web",
        sessionId: "s1",
        userId: "u1",
        capabilityScope: {},
        input: {}
    });
    assert.equal(blockedEmptyScope.status, "failed");
    assert.equal(blockedEmptyScope.error.code, "POLAR_EXTENSION_POLICY_DENIED");
    assert.equal(adapterCalls, 1);
});
