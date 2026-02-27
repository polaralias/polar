import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
    createContractRegistry,
    createMiddlewarePipeline,
    createBudgetGateway,
    createBudgetMiddleware,
    createProviderGateway,
    registerBudgetContracts,
    registerProviderOperationContracts,
    createSqliteBudgetStateStore,
} from "../packages/polar-runtime-core/src/index.mjs";

function setupBudgetEnforcement({ now = () => 1000 } = {}) {
    const db = new Database(":memory:");
    const contractRegistry = createContractRegistry();
    registerBudgetContracts(contractRegistry);
    registerProviderOperationContracts(contractRegistry);

    const budgetStateStore = createSqliteBudgetStateStore({ db, now });

    // Need a pipeline for budgetGateway itself
    const budgetPipeline = createMiddlewarePipeline({
        contractRegistry,
        middleware: [],
    });

    const budgetGateway = createBudgetGateway({
        middlewarePipeline: budgetPipeline,
        budgetStateStore,
    });

    const budgetMiddleware = createBudgetMiddleware({ budgetGateway });

    const providerPipeline = createMiddlewarePipeline({
        contractRegistry,
        middleware: [budgetMiddleware],
    });

    const providerGateway = createProviderGateway({
        middlewarePipeline: providerPipeline,
        providers: {
            primary: Object.freeze({
                async generate(input) {
                    return { providerId: "primary", model: input.model, text: "success" };
                },
                async stream(input) {
                    return { providerId: "primary", model: input.model, chunks: ["success"] };
                },
                async embed(input) {
                    return { providerId: "primary", model: input.model, vector: [0.1, 0.2] };
                },
            }),
        },
        now,
    });

    return {
        budgetGateway,
        providerGateway,
        budgetStateStore,
        db,
    };
}

test("budget middleware blocks request when global budget is exceeded", async () => {
    const { budgetGateway, providerGateway, budgetStateStore } = setupBudgetEnforcement();

    // 1. Set global budget to $1.00
    await budgetGateway.upsertPolicy({
        scope: "global",
        maxLimitUsd: 1.00,
        enforceBlocking: true,
    });

    // 2. Record $0.90 usage
    await budgetStateStore.recordUsage({ scope: "global", costUsd: 0.90 });

    // 3. Try a request estimated at $0.05 -> should pass
    const ok = await providerGateway.generate({
        providerId: "primary",
        model: "m1",
        prompt: "h1",
        estimatedCostUsd: 0.05,
    });
    assert.equal(ok.text, "success");

    // 4. Record the used cost (manual in this test setup)
    await budgetStateStore.recordUsage({ scope: "global", costUsd: 0.05 });

    // 5. Try a request estimated at $0.10 -> should fail (0.95 + 0.10 > 1.00)
    await assert.rejects(
        () => providerGateway.generate({
            providerId: "primary",
            model: "m1",
            prompt: "h2",
            estimatedCostUsd: 0.10,
        }),
        /Global budget exceeded/
    );
});

test("budget middleware blocks request when workspace budget is exceeded", async () => {
    const { budgetGateway, providerGateway, budgetStateStore } = setupBudgetEnforcement();

    await budgetGateway.upsertPolicy({
        scope: "workspace",
        targetId: "ws-1",
        maxLimitUsd: 0.50,
        enforceBlocking: true,
    });

    await budgetStateStore.recordUsage({ scope: "workspace", targetId: "ws-1", costUsd: 0.45 });

    // Pass within limit
    await providerGateway.generate({
        providerId: "primary",
        model: "m1",
        prompt: "h1",
        workspaceId: "ws-1",
        estimatedCostUsd: 0.04,
    });
    await budgetStateStore.recordUsage({ scope: "workspace", targetId: "ws-1", costUsd: 0.04 });

    // Fail over limit
    await assert.rejects(
        () => providerGateway.generate({
            providerId: "primary",
            model: "m1",
            prompt: "h2",
            workspaceId: "ws-1",
            estimatedCostUsd: 0.02,
        }),
        /Workspace budget exceeded for ws-1/
    );
});

test("budget middleware respects reset interval", async () => {
    let nowValue = 1000;
    const { budgetGateway, providerGateway, budgetStateStore } = setupBudgetEnforcement({
        now: () => nowValue
    });

    await budgetGateway.upsertPolicy({
        scope: "global",
        maxLimitUsd: 1.00,
        resetIntervalMs: 1000,
        enforceBlocking: true,
    });

    await budgetStateStore.recordUsage({ scope: "global", costUsd: 0.95 });

    // Blocked
    await assert.rejects(
        () => providerGateway.generate({
            providerId: "primary",
            model: "m1",
            prompt: "h1",
            estimatedCostUsd: 0.10,
        }),
        /Global budget exceeded/
    );

    // Advance time
    nowValue += 1100;

    // Should pass now (reset)
    const ok = await providerGateway.generate({
        providerId: "primary",
        model: "m1",
        prompt: "h2",
        estimatedCostUsd: 0.10,
    });
    assert.equal(ok.text, "success");
});

test("budget middleware bypasses if enforceBlocking is false", async () => {
    const { budgetGateway, providerGateway, budgetStateStore } = setupBudgetEnforcement();

    await budgetGateway.upsertPolicy({
        scope: "global",
        maxLimitUsd: 1.00,
        enforceBlocking: false,
    });

    await budgetStateStore.recordUsage({ scope: "global", costUsd: 2.00 });

    // Should pass even if over budget
    const ok = await providerGateway.generate({
        providerId: "primary",
        model: "m1",
        prompt: "h1",
        estimatedCostUsd: 1.00,
    });
    assert.equal(ok.text, "success");
});
