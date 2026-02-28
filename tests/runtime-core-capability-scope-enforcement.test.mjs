import test from "node:test";
import assert from "node:assert/strict";
import { computeCapabilityScope } from "../packages/polar-runtime-core/src/capability-scope.mjs";
import { createExtensionGateway } from "../packages/polar-runtime-core/src/extension-gateway.mjs";

test("capability-scope computes structured scope correctly", () => {
    const scope = computeCapabilityScope({
        sessionProfile: { profileConfig: { allowedSkills: ["search_web"] } }
    });

    assert.ok(scope.allowed["system"].includes("lookup_weather"));
    assert.ok(scope.allowed["web"].includes("search_web"));
    assert.equal(scope.allowed["email"], undefined);
});

test("extension-gateway blocks tool outside capabilityScope", async () => {
    const gateway = createExtensionGateway({
        middlewarePipeline: { run: (ctx, next) => next(ctx.input) },
        extensionRegistry: { get: () => ({ executeCapability: () => ({ status: "completed" }) }) },
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
});
