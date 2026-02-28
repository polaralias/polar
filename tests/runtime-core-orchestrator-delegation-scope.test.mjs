import test from "node:test";
import assert from "node:assert/strict";
import { validateForwardSkills, validateModelOverride } from "../packages/polar-runtime-core/src/capability-scope.mjs";

test("capability-scope validates forward_skills against global allowlist", () => {
    const multiAgentConfig = { globalAllowedSkills: ["email_mcp", "search_web"] };
    const sessionProfile = { profileConfig: {} };

    const result = validateForwardSkills({
        forwardSkills: ["email_mcp", "exfiltrate_keys"],
        sessionProfile,
        multiAgentConfig
    });

    assert.deepEqual(result.allowedSkills, ["email_mcp"]);
    assert.deepEqual(result.rejectedSkills, ["exfiltrate_keys"]);
    assert.equal(result.isBlocked, false); // "email_mcp" is allowed, so not blocked
});

test("capability-scope blocks delegation if all requested skills are unauthorized", () => {
    const multiAgentConfig = { globalAllowedSkills: ["search_web"], allowEmptySkillsDelegation: false };
    const result = validateForwardSkills({
        forwardSkills: ["exfiltrate_keys"],
        multiAgentConfig
    });

    assert.equal(result.allowedSkills.length, 0);
    assert.equal(result.isBlocked, true);
});

test("capability-scope allows unblocked delegation if allowEmptySkillsDelegation is true", () => {
    const multiAgentConfig = { globalAllowedSkills: ["search_web"], allowEmptySkillsDelegation: true };
    const result = validateForwardSkills({
        forwardSkills: ["exfiltrate_keys"],
        multiAgentConfig
    });

    assert.equal(result.isBlocked, false);
});

test("capability-scope validates model override", () => {
    const multiAgentConfig = { allowlistedModels: ["gpt-4.1-mini", "claude-sonnet-4-6"] };
    const basePolicy = { providerId: "openai", modelId: "gpt-4.1-mini" };

    const result = validateModelOverride({
        modelOverride: "o1-preview", // not in allowlist
        multiAgentConfig,
        basePolicy
    });

    assert.equal(result.modelId, "gpt-4.1-mini"); // clamped back to base
    assert.ok(result.rejectedReason.includes("not in the server allowlist"));
});

test("capability-scope resolves provider from model name", () => {
    const multiAgentConfig = { allowlistedModels: ["claude-sonnet-4-6"] };
    const result = validateModelOverride({
        modelOverride: "claude-sonnet-4-6",
        multiAgentConfig
    });

    assert.equal(result.providerId, "anthropic");
    assert.equal(result.modelId, "claude-sonnet-4-6");
});
