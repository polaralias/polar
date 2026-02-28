// packages/polar-runtime-core/src/workflow-engine.mjs

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
        throw new Error(`Cannot expand unknown template ${templateId}`);
    }

    // Strict schema validation
    const missing = template.schema.required.filter(key => !(key in args));
    if (missing.length > 0) {
        throw new Error(`Template ${templateId} missing required arguments: ${missing.join(", ")}`);
    }

    return template.steps(args);
}

/**
 * Validates step list against policy context.
 * Phase 4: Policy backstop via extensionGateway capabilityScope will use this to ensure
 * model hasn't somehow bypassed expansion.
 */
export function validateSteps(steps, policyContext = {}) {
    const errors = [];
    const allowedExtensions = policyContext.allowedExtensionIds || [];
    const scopeRules = policyContext.capabilityScope || {};

    for (const step of steps) {
        if (step.extensionId !== "system" && allowedExtensions.length > 0) {
            if (!allowedExtensions.includes(step.extensionId)) {
                errors.push(`Extension ${step.extensionId} is not fully allowed globally by policy`);
            }
        }
    }

    return { ok: errors.length === 0, errors };
}
