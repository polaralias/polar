import { RuntimeExecutionError } from '../../polar-domain/src/index.mjs';
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
