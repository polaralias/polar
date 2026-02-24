import {
    booleanField,
    createStrictObjectSchema,
    enumField,
    numberField,
    stringField,
} from "./runtime-contracts.mjs";

export const BUDGET_POLICY_SCOPES = Object.freeze([
    "global",
    "workspace",
    "session",
    "user",
    "automation",
]);

export const BUDGET_ACTIONS = Object.freeze({
    upsertPolicy: Object.freeze({
        actionId: "runtime.budget.policy.upsert",
        version: 1,
    }),
    getPolicy: Object.freeze({
        actionId: "runtime.budget.policy.get",
        version: 1,
    }),
    checkBudget: Object.freeze({
        actionId: "runtime.budget.check",
        version: 1,
    }),
});

export const BUDGET_POLICY_STATUSES = Object.freeze(["ok", "not_found", "conflict"]);
export const BUDGET_CHECK_STATUSES = Object.freeze(["approved", "exceeded", "not_found"]);

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createBudgetContracts(options = {}) {
    const { trustClass = "native", riskClass = "moderate" } = options;

    return Object.freeze([
        Object.freeze({
            actionId: BUDGET_ACTIONS.upsertPolicy.actionId,
            version: BUDGET_ACTIONS.upsertPolicy.version,
            inputSchema: createStrictObjectSchema({
                schemaId: "runtime.budget.policy.upsert.input",
                fields: {
                    scope: enumField(BUDGET_POLICY_SCOPES),
                    targetId: stringField({ minLength: 1, required: false }),
                    maxLimitUsd: numberField({ min: 0 }),
                    resetIntervalMs: numberField({ min: 1, required: false }),
                    enforceBlocking: booleanField({ required: false }),
                },
            }),
            outputSchema: createStrictObjectSchema({
                schemaId: "runtime.budget.policy.upsert.output",
                fields: {
                    status: enumField(BUDGET_POLICY_STATUSES),
                    policyId: stringField({ minLength: 1 }),
                    scope: enumField(BUDGET_POLICY_SCOPES),
                    targetId: stringField({ minLength: 1, required: false }),
                    maxLimitUsd: numberField({ min: 0 }),
                    resetIntervalMs: numberField({ min: 1, required: false }),
                    enforceBlocking: booleanField({ required: false }),
                },
            }),
            riskClass,
            trustClass,
            timeoutMs: 10_000,
            retryPolicy: {
                maxAttempts: 1,
            },
        }),
        Object.freeze({
            actionId: BUDGET_ACTIONS.getPolicy.actionId,
            version: BUDGET_ACTIONS.getPolicy.version,
            inputSchema: createStrictObjectSchema({
                schemaId: "runtime.budget.policy.get.input",
                fields: {
                    scope: enumField(BUDGET_POLICY_SCOPES),
                    targetId: stringField({ minLength: 1, required: false }),
                },
            }),
            outputSchema: createStrictObjectSchema({
                schemaId: "runtime.budget.policy.get.output",
                fields: {
                    status: enumField(BUDGET_POLICY_STATUSES),
                    policyId: stringField({ minLength: 1, required: false }),
                    scope: enumField(BUDGET_POLICY_SCOPES),
                    targetId: stringField({ minLength: 1, required: false }),
                    maxLimitUsd: numberField({ min: 0, required: false }),
                    resetIntervalMs: numberField({ min: 1, required: false }),
                    enforceBlocking: booleanField({ required: false }),
                },
            }),
            riskClass,
            trustClass,
            timeoutMs: 10_000,
            retryPolicy: {
                maxAttempts: 1,
            },
        }),
        Object.freeze({
            actionId: BUDGET_ACTIONS.checkBudget.actionId,
            version: BUDGET_ACTIONS.checkBudget.version,
            inputSchema: createStrictObjectSchema({
                schemaId: "runtime.budget.check.input",
                fields: {
                    scope: enumField(BUDGET_POLICY_SCOPES),
                    targetId: stringField({ minLength: 1, required: false }),
                    estimatedRunCostUsd: numberField({ min: 0 }),
                },
            }),
            outputSchema: createStrictObjectSchema({
                schemaId: "runtime.budget.check.output",
                fields: {
                    status: enumField(BUDGET_CHECK_STATUSES),
                    remainingBudgetUsd: numberField({ min: 0, required: false }),
                    estimatedRunCostUsd: numberField({ min: 0 }),
                    isBlocked: booleanField({ required: false }),
                },
            }),
            riskClass,
            trustClass,
            timeoutMs: 10_000,
            retryPolicy: {
                maxAttempts: 1,
            },
        }),
    ]);
}
