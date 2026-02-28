import { RuntimeExecutionError } from '../../polar-domain/src/index.mjs';

/**
 * @param {{
 *   budgetGateway: {
 *     checkBudget: (request: Record<string, unknown>) => Promise<Record<string, unknown>>
 *   }
 * }} config
 * @returns {import("./middleware-pipeline.mjs").RuntimeMiddleware}
 */
export function createBudgetMiddleware({ budgetGateway }) {
    return {
        id: "budget-enforcement",
        async before(context) {
            // Only apply to provider operations
            if (!context.actionId.startsWith("provider.")) {
                return;
            }

            const estimatedCost = /** @type {number|undefined} */ (context.input.estimatedCostUsd) ?? 0;

            // Check global budget
            const globalCheck = await budgetGateway.checkBudget({
                executionType: context.executionType,
                traceId: context.traceId,
                scope: "global",
                estimatedRunCostUsd: estimatedCost,
            });
            if (globalCheck.isBlocked) {
                throw new RuntimeExecutionError(`Global budget exceeded. Remaining: $${globalCheck.remainingBudgetUsd}, Requested: $${estimatedCost}`);
            }

            // Check workspace budget if present
            const workspaceId = /** @type {string|undefined} */ (context.input.workspaceId);
            if (workspaceId) {
                const workspaceCheck = await budgetGateway.checkBudget({
                    executionType: context.executionType,
                    traceId: context.traceId,
                    scope: "workspace",
                    targetId: workspaceId,
                    estimatedRunCostUsd: estimatedCost,
                });

                if (workspaceCheck.isBlocked) {
                    throw new RuntimeExecutionError(`Workspace budget exceeded for ${workspaceId}. Remaining: $${workspaceCheck.remainingBudgetUsd}, Requested: $${estimatedCost}`);
                }
            }
        },
        async after(context) {
            // Only apply to provider operations
            if (!context.actionId.startsWith("provider.")) {
                return;
            }

            // Prefer actual cost from provider if available, otherwise fallback to estimated
            const actualCost = /** @type {number|undefined} */ (context.output.costUsd) ??
                               /** @type {number|undefined} */ (context.input.estimatedCostUsd) ?? 0;

            if (actualCost <= 0) return;

            // Wrap recordUsage in try/catch so a recording failure doesn't crash
            // the middleware pipeline for an otherwise successful request (BUG-024 fix)
            try {
                // Record global usage
                await budgetGateway.recordUsage({
                    scope: "global",
                    costUsd: actualCost,
                });

                // Record workspace usage if present
                const workspaceId = /** @type {string|undefined} */ (context.input.workspaceId);
                if (workspaceId) {
                    await budgetGateway.recordUsage({
                        scope: "workspace",
                        targetId: workspaceId,
                        costUsd: actualCost,
                    });
                }
            } catch (err) {
                console.warn(`[budget-enforcement] Failed to record usage: ${err.message}`);
            }
        }
    };
}
