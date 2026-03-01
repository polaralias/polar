import {
    BUDGET_ACTIONS,
    BUDGET_CHECK_STATUSES,
    BUDGET_POLICY_SCOPES,
    BUDGET_POLICY_STATUSES,
    ContractValidationError,
    PolarTypedError,
    RuntimeExecutionError,
    booleanField,
    createBudgetContracts,
    createStrictObjectSchema,
    enumField,
    numberField,
    stringField,
} from "@polar/domain";

const upsertPolicyRequestSchema = createStrictObjectSchema({
    schemaId: "budget.gateway.policy.upsert.request",
    fields: {
        executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
            required: false,
        }),
        traceId: stringField({ minLength: 1, required: false }),
        scope: enumField(BUDGET_POLICY_SCOPES),
        targetId: stringField({ minLength: 1, required: false }),
        maxLimitUsd: numberField({ min: 0 }),
        resetIntervalMs: numberField({ min: 1, required: false }),
        enforceBlocking: booleanField({ required: false }),
    },
});

const getPolicyRequestSchema = createStrictObjectSchema({
    schemaId: "budget.gateway.policy.get.request",
    fields: {
        executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
            required: false,
        }),
        traceId: stringField({ minLength: 1, required: false }),
        scope: enumField(BUDGET_POLICY_SCOPES),
        targetId: stringField({ minLength: 1, required: false }),
    },
});

const checkBudgetRequestSchema = createStrictObjectSchema({
    schemaId: "budget.gateway.check.request",
    fields: {
        executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
            required: false,
        }),
        traceId: stringField({ minLength: 1, required: false }),
        scope: enumField(BUDGET_POLICY_SCOPES),
        targetId: stringField({ minLength: 1, required: false }),
        estimatedRunCostUsd: numberField({ min: 0 }),
    },
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
    return (
        typeof value === "object" &&
        value !== null &&
        Object.getPrototypeOf(value) === Object.prototype
    );
}

/**
 * @param {unknown} value
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function validateRequest(value, schemaId) {
    const schema = {
        [upsertPolicyRequestSchema.schemaId]: upsertPolicyRequestSchema,
        [getPolicyRequestSchema.schemaId]: getPolicyRequestSchema,
        [checkBudgetRequestSchema.schemaId]: checkBudgetRequestSchema,
    }[schemaId];

    const validation = schema.validate(value);
    if (!validation.ok) {
        throw new ContractValidationError(`Invalid ${schemaId}`, {
            schemaId,
            errors: validation.errors ?? [],
        });
    }

    return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function toErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerBudgetContracts(contractRegistry) {
    for (const contract of createBudgetContracts()) {
        if (!contractRegistry.has(contract.actionId, contract.version)) {
            contractRegistry.register(contract);
        }
    }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   budgetStateStore?: {
 *     upsertPolicy?: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     getPolicy?: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     checkBudget?: (request: Record<string, unknown>) => Promise<unknown>|unknown
 *   },
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createBudgetGateway({
    middlewarePipeline,
    budgetStateStore,
    defaultExecutionType = "tool",
}) {
    if (
        budgetStateStore !== undefined &&
        (typeof budgetStateStore !== "object" || budgetStateStore === null)
    ) {
        throw new RuntimeExecutionError(
            "budgetStateStore must be an object when provided",
        );
    }

    return Object.freeze({
        /**
         * @param {unknown} request
         * @returns {Promise<Record<string, unknown>>}
         */
        async upsertPolicy(request) {
            const validatedRequest = validateRequest(
                request,
                upsertPolicyRequestSchema.schemaId,
            );

            return middlewarePipeline.run(
                {
                    executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
                            validatedRequest.executionType
                        ) ?? defaultExecutionType,
                    traceId: /** @type {string|undefined} */ (validatedRequest.traceId),
                    actionId: BUDGET_ACTIONS.upsertPolicy.actionId,
                    version: BUDGET_ACTIONS.upsertPolicy.version,
                    input: {
                        scope: validatedRequest.scope,
                        ...(validatedRequest.targetId !== undefined
                            ? { targetId: validatedRequest.targetId }
                            : {}),
                        maxLimitUsd: validatedRequest.maxLimitUsd,
                        ...(validatedRequest.resetIntervalMs !== undefined
                            ? { resetIntervalMs: validatedRequest.resetIntervalMs }
                            : {}),
                        ...(validatedRequest.enforceBlocking !== undefined
                            ? { enforceBlocking: validatedRequest.enforceBlocking }
                            : {}),
                    },
                },
                async (input) => {
                    if (!budgetStateStore?.upsertPolicy) {
                        throw new RuntimeExecutionError(
                            "budgetStateStore.upsertPolicy is not configured",
                        );
                    }

                    try {
                        const providerResponse = /** @type {Record<string, unknown>} */ (
                            await budgetStateStore.upsertPolicy({ ...input })
                        );

                        return {
                            status: providerResponse.status ?? "ok",
                            policyId: providerResponse.policyId,
                            scope: input.scope,
                            ...(input.targetId !== undefined ? { targetId: input.targetId } : {}),
                            maxLimitUsd: input.maxLimitUsd,
                            ...(input.resetIntervalMs !== undefined
                                ? { resetIntervalMs: input.resetIntervalMs }
                                : {}),
                            ...(input.enforceBlocking !== undefined
                                ? { enforceBlocking: input.enforceBlocking }
                                : {}),
                        };
                    } catch (error) {
                        if (error instanceof PolarTypedError) {
                            throw error;
                        }
                        throw new RuntimeExecutionError("Failed to upsert budget policy", {
                            cause: toErrorMessage(error),
                        });
                    }
                },
            );
        },

        /**
         * @param {unknown} request
         * @returns {Promise<Record<string, unknown>>}
         */
        async getPolicy(request) {
            const validatedRequest = validateRequest(
                request,
                getPolicyRequestSchema.schemaId,
            );

            return middlewarePipeline.run(
                {
                    executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
                            validatedRequest.executionType
                        ) ?? defaultExecutionType,
                    traceId: /** @type {string|undefined} */ (validatedRequest.traceId),
                    actionId: BUDGET_ACTIONS.getPolicy.actionId,
                    version: BUDGET_ACTIONS.getPolicy.version,
                    input: {
                        scope: validatedRequest.scope,
                        ...(validatedRequest.targetId !== undefined
                            ? { targetId: validatedRequest.targetId }
                            : {}),
                    },
                },
                async (input) => {
                    if (!budgetStateStore?.getPolicy) {
                        throw new RuntimeExecutionError(
                            "budgetStateStore.getPolicy is not configured",
                        );
                    }

                    try {
                        const providerResponse = /** @type {Record<string, unknown>} */ (
                            await budgetStateStore.getPolicy({ ...input })
                        );

                        if (providerResponse.status === "not_found" || !providerResponse.policyId) {
                            return {
                                status: "not_found",
                                scope: input.scope,
                                ...(input.targetId !== undefined ? { targetId: input.targetId } : {}),
                            };
                        }

                        return {
                            status: "ok",
                            policyId: providerResponse.policyId,
                            scope: input.scope,
                            ...(input.targetId !== undefined ? { targetId: input.targetId } : {}),
                            maxLimitUsd: providerResponse.maxLimitUsd,
                            ...(providerResponse.resetIntervalMs !== undefined
                                ? { resetIntervalMs: providerResponse.resetIntervalMs }
                                : {}),
                            ...(providerResponse.enforceBlocking !== undefined
                                ? { enforceBlocking: providerResponse.enforceBlocking }
                                : {}),
                        };
                    } catch (error) {
                        if (error instanceof PolarTypedError) {
                            throw error;
                        }
                        throw new RuntimeExecutionError("Failed to get budget policy", {
                            cause: toErrorMessage(error),
                        });
                    }
                },
            );
        },

        /**
         * @param {unknown} request
         * @returns {Promise<Record<string, unknown>>}
         */
        async checkBudget(request) {
            const validatedRequest = validateRequest(
                request,
                checkBudgetRequestSchema.schemaId,
            );

            return middlewarePipeline.run(
                {
                    executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
                            validatedRequest.executionType
                        ) ?? defaultExecutionType,
                    traceId: /** @type {string|undefined} */ (validatedRequest.traceId),
                    actionId: BUDGET_ACTIONS.checkBudget.actionId,
                    version: BUDGET_ACTIONS.checkBudget.version,
                    input: {
                        scope: validatedRequest.scope,
                        ...(validatedRequest.targetId !== undefined
                            ? { targetId: validatedRequest.targetId }
                            : {}),
                        estimatedRunCostUsd: validatedRequest.estimatedRunCostUsd,
                    },
                },
                async (input) => {
                    if (!budgetStateStore?.checkBudget) {
                        // Default to bypass if no check configured
                        return {
                            status: "not_found",
                            estimatedRunCostUsd: input.estimatedRunCostUsd,
                            isBlocked: false,
                        };
                    }

                    try {
                        const providerResponse = /** @type {Record<string, unknown>} */ (
                            await budgetStateStore.checkBudget({ ...input })
                        );

                        if (providerResponse.status === "not_found") {
                            return {
                                status: "not_found",
                                estimatedRunCostUsd: input.estimatedRunCostUsd,
                                isBlocked: false,
                            };
                        }

                        const remaining = /** @type {number} */ (
                            providerResponse.remainingBudgetUsd ?? 0
                        );

                        const isBlocked =
                            providerResponse.enforceBlocking === true &&
                            remaining < input.estimatedRunCostUsd;

                        return {
                            status: isBlocked ? "exceeded" : "approved",
                            remainingBudgetUsd: remaining,
                            estimatedRunCostUsd: input.estimatedRunCostUsd,
                            isBlocked,
                        };
                    } catch (error) {
                        if (error instanceof PolarTypedError) {
                            throw error;
                        }
                        throw new RuntimeExecutionError("Failed to check budget", {
                            cause: toErrorMessage(error),
                        });
                    }
                },
            );
        },
        /**
         * Records budget usage. This intentionally bypasses the middleware pipeline
         * because it is a fire-and-forget telemetry operation that must not block
         * the request path. Input is still validated for safety.
         *
         * @param {unknown} request
         * @returns {Promise<void>}
         */
        async recordUsage(request) {
            if (!budgetStateStore?.recordUsage) return;

            // Validate input even though we bypass middleware (BUG-010 mitigation)
            if (!isPlainObject(request)) {
                console.warn("[budget-gateway] recordUsage called with non-object request, skipping");
                return;
            }
            const { scope, costUsd } = /** @type {Record<string, unknown>} */ (request);
            if (typeof scope !== "string" || scope.length === 0) {
                console.warn("[budget-gateway] recordUsage called without a valid scope, skipping");
                return;
            }
            if (typeof costUsd !== "number" || costUsd < 0) {
                console.warn("[budget-gateway] recordUsage called without a valid costUsd, skipping");
                return;
            }

            try {
                await budgetStateStore.recordUsage(request);
            } catch (err) {
                console.warn(`[budget-gateway] Failed to record budget usage: ${err instanceof Error ? err.message : String(err)}`);
            }
        },
    });
}
