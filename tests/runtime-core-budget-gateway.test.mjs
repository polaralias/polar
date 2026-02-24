import test from "node:test";
import assert from "node:assert/strict";
import {
    ContractValidationError,
    BUDGET_ACTIONS,
    RuntimeExecutionError,
} from "../packages/polar-domain/src/index.mjs";
import {
    createContractRegistry,
    createMiddlewarePipeline,
    createBudgetGateway,
    registerBudgetContracts,
} from "../packages/polar-runtime-core/src/index.mjs";

test("budget contracts can be registered", () => {
    const registry = createContractRegistry();
    registerBudgetContracts(registry);

    assert.ok(registry.has(BUDGET_ACTIONS.upsertPolicy.actionId, 1));
    assert.ok(registry.has(BUDGET_ACTIONS.getPolicy.actionId, 1));
    assert.ok(registry.has(BUDGET_ACTIONS.checkBudget.actionId, 1));
});

test("budget gateway throws if budgetStateStore is not an object", () => {
    const registry = createContractRegistry();
    const middlewarePipeline = createMiddlewarePipeline({
        contractRegistry: registry,
        middleware: [],
    });

    assert.throws(
        () => {
            // @ts-ignore
            createBudgetGateway({ middlewarePipeline, budgetStateStore: "invalid" });
        },
        RuntimeExecutionError,
        /budgetStateStore must be an object/,
    );
});

test("budget gateway checks budget bypassing when not configured", async () => {
    const registry = createContractRegistry();
    registerBudgetContracts(registry);
    const middlewarePipeline = createMiddlewarePipeline({
        contractRegistry: registry,
        middleware: [],
    });
    const gateway = createBudgetGateway({ middlewarePipeline });

    const result = await gateway.checkBudget({
        scope: "global",
        estimatedRunCostUsd: 15.5,
    });

    assert.deepEqual(result, {
        status: "not_found",
        estimatedRunCostUsd: 15.5,
        isBlocked: false,
    });
});

test("budget gateway interacts with budgetStateStore", async () => {
    const registry = createContractRegistry();
    registerBudgetContracts(registry);
    const middlewarePipeline = createMiddlewarePipeline({
        contractRegistry: registry,
        middleware: [],
    });

    const mockStore = {
        async upsertPolicy(request) {
            return {
                status: "ok",
                policyId: "policy-123",
            };
        },
        async getPolicy(request) {
            if (request.targetId === "missing") {
                return { status: "not_found" };
            }
            return {
                status: "ok",
                policyId: "policy-123",
                maxLimitUsd: 100,
                enforceBlocking: true,
            };
        },
        async checkBudget(request) {
            if (request.estimatedRunCostUsd > 100) {
                return {
                    status: "ok",
                    remainingBudgetUsd: 10,
                    enforceBlocking: true,
                };
            }
            return {
                status: "ok",
                remainingBudgetUsd: 100,
                enforceBlocking: true,
            };
        },
    };

    const gateway = createBudgetGateway({
        middlewarePipeline,
        budgetStateStore: mockStore,
    });

    const upsertRes = await gateway.upsertPolicy({
        scope: "global",
        maxLimitUsd: 200,
        enforceBlocking: true,
    });

    assert.equal(upsertRes.status, "ok");
    assert.equal(upsertRes.policyId, "policy-123");
    assert.equal(upsertRes.maxLimitUsd, 200);
    assert.equal(upsertRes.enforceBlocking, true);

    const getRes = await gateway.getPolicy({
        scope: "automation",
        targetId: "auto-1",
    });
    assert.equal(getRes.status, "ok");
    assert.equal(getRes.policyId, "policy-123");
    assert.equal(getRes.maxLimitUsd, 100);

    const missRes = await gateway.getPolicy({
        scope: "automation",
        targetId: "missing",
    });
    assert.equal(missRes.status, "not_found");

    const checkApproved = await gateway.checkBudget({
        scope: "global",
        estimatedRunCostUsd: 50,
    });
    assert.equal(checkApproved.status, "approved");
    assert.equal(checkApproved.isBlocked, false);
    assert.equal(checkApproved.remainingBudgetUsd, 100);

    const checkBlocked = await gateway.checkBudget({
        scope: "global",
        estimatedRunCostUsd: 150,
    });
    assert.equal(checkBlocked.status, "exceeded");
    assert.equal(checkBlocked.isBlocked, true);
    assert.equal(checkBlocked.remainingBudgetUsd, 10);
});
