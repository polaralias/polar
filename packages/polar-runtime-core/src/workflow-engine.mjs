import { RuntimeExecutionError } from '@polar/domain';
import { WORKFLOW_TEMPLATES } from './workflow-templates.mjs';

/**
 * Parses <polar_action> blocks.
 */
export function parseModelProposal(responseText) {
    const match = responseText.match(/<polar_action>([\s\S]*?)<\/polar_action>/);
    if (!match) return null;

    try {
        const payload = JSON.parse(match[1].trim());
        const templateId = payload.template || payload.capabilityId; // fallback for older prompts
        const args = payload.args || {};

        if (!WORKFLOW_TEMPLATES[templateId]) {
            return { error: `Unknown template: ${templateId}` };
        }

        return { templateId, args };
    } catch (e) {
        return { error: "Invalid JSON in <polar_action>" };
    }
}

/**
 * Expands a semantic template into raw steps deterministically.
 */
export function expandTemplate(templateId, args) {
    const template = WORKFLOW_TEMPLATES[templateId];
    if (!template) {
        throw new RuntimeExecutionError(`Cannot expand unknown template ${templateId}`);
    }

    // Strict schema validation
    const missing = template.schema.required.filter(key => !(key in args));
    if (missing.length > 0) {
        throw new RuntimeExecutionError(`Template ${templateId} missing required arguments: ${missing.join(", ")}`);
    }

    return template.steps(args);
}

/**
 * Validates step list against computed capability scope.
 * Each step must have its extensionId in capabilityScope.allowed,
 * and its capabilityId must be explicitly listed (or covered by '*').
 * This pre-check mirrors the real enforcement in extension-gateway.
 *
 * @param {Object[]} steps
 * @param {{ capabilityScope?: { allowed?: Record<string, string[]> } }} policyContext
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateSteps(steps, policyContext = {}) {
    const errors = [];
    const allowed = policyContext.capabilityScope?.allowed;

    // If no scope provided, skip validation (backwards-compat / tests)
    if (!allowed) {
        return { ok: true, errors };
    }

    for (const step of steps) {
        const allowedCaps = allowed[step.extensionId];
        if (!allowedCaps) {
            errors.push(`Extension "${step.extensionId}" is not allowed by capability scope`);
            continue;
        }
        // '*' means all capabilities on that extension are allowed
        if (!allowedCaps.includes('*') && !allowedCaps.includes(step.capabilityId)) {
            errors.push(`Capability "${step.capabilityId}" on extension "${step.extensionId}" is not allowed by capability scope`);
        }
    }

    return { ok: errors.length === 0, errors };
}

/**
 * @param {unknown} capability
 * @returns {string[]}
 */
function extractRequiredArgKeys(capability) {
    if (!capability || typeof capability !== "object") {
        return [];
    }
    const record = /** @type {Record<string, unknown>} */ (capability);
    const candidates = [
        record.requiredArgs,
        record.required,
        record?.argsSchema?.required,
        record?.inputSchema?.required,
    ];
    for (const value of candidates) {
        if (!Array.isArray(value)) {
            continue;
        }
        const keys = value
            .filter((key) => typeof key === "string" && key.length > 0)
            .map((key) => key.trim());
        if (keys.length > 0) {
            return keys;
        }
    }
    return [];
}

/**
 * Validates planner-proposed steps against install state/capability existence and
 * lightweight args requirements before workflow execution.
 * @param {Array<{ extensionId: string, capabilityId: string, args?: Record<string, unknown>, reason?: string, id?: string, dependsOnStep?: string }>} steps
 * @param {{ extensionStates?: unknown[] }} context
 * @returns {{ acceptedSteps: Array<{ extensionId: string, capabilityId: string, args: Record<string, unknown> }>, rejectedSteps: Array<{ index: number, extensionId: string, capabilityId: string, reason: string }>, hasRejected: boolean }}
 */
export function validateDynamicWorkflowSteps(steps, context = {}) {
    const stateByExtension = new Map();
    for (const state of context.extensionStates || []) {
        if (!state || typeof state !== "object") {
            continue;
        }
        const record = /** @type {Record<string, unknown>} */ (state);
        if (typeof record.extensionId !== "string" || record.extensionId.length === 0) {
            continue;
        }
        stateByExtension.set(record.extensionId, record);
    }

    const acceptedSteps = [];
    const rejectedSteps = [];
    for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        const extensionState = stateByExtension.get(step.extensionId);
        if (step.extensionId !== "system") {
            if (!extensionState) {
                rejectedSteps.push({ index, extensionId: step.extensionId, capabilityId: step.capabilityId, reason: "extension_not_installed" });
                continue;
            }
            const lifecycleState = typeof extensionState.lifecycleState === "string" ? extensionState.lifecycleState : "installed";
            if (lifecycleState !== "enabled" && lifecycleState !== "installed") {
                rejectedSteps.push({ index, extensionId: step.extensionId, capabilityId: step.capabilityId, reason: "extension_not_enabled" });
                continue;
            }
        }

        const capabilities = Array.isArray(extensionState?.capabilities) ? extensionState.capabilities : [];
        const capabilityMetadata = capabilities.find((candidate) => candidate && typeof candidate === "object" && candidate.capabilityId === step.capabilityId);
        if (step.extensionId !== "system" && !capabilityMetadata) {
            rejectedSteps.push({ index, extensionId: step.extensionId, capabilityId: step.capabilityId, reason: "capability_not_found" });
            continue;
        }

        const args = step.args && typeof step.args === "object" ? step.args : {};
        const requiredArgKeys = extractRequiredArgKeys(capabilityMetadata);
        const missingArgs = requiredArgKeys.filter((key) => !(key in args));
        if (missingArgs.length > 0) {
            rejectedSteps.push({
                index,
                extensionId: step.extensionId,
                capabilityId: step.capabilityId,
                reason: `missing_required_args:${missingArgs.join(",")}`,
            });
            continue;
        }

        acceptedSteps.push({
            extensionId: step.extensionId,
            capabilityId: step.capabilityId,
            args,
        });
    }

    return {
        acceptedSteps,
        rejectedSteps,
        hasRejected: rejectedSteps.length > 0,
    };
}
