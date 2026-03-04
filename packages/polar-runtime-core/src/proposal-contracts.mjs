import {
  RuntimeExecutionError,
  createStrictObjectSchema,
  enumField,
  jsonField,
  stringField,
} from "@polar/domain";

const routerProposalSchema = createStrictObjectSchema({
  schemaId: "prompt.router.proposal.v1",
  fields: {
    decision: enumField(["respond", "delegate", "tool", "workflow", "clarify"]),
    target: jsonField({ required: false }),
    confidence: jsonField(),
    rationale: stringField({ minLength: 1 }),
    references: jsonField({ required: false }),
    scores: jsonField({ required: false }),
  },
});

const automationPlannerSchema = createStrictObjectSchema({
  schemaId: "prompt.automation_planner.proposal.v1",
  fields: {
    decision: enumField(["propose", "clarify", "skip"]),
    confidence: jsonField(),
    summary: stringField({ minLength: 1 }),
    schedule: jsonField(),
    runScope: jsonField(),
    limits: jsonField(),
    riskHints: jsonField(),
    clarificationQuestion: stringField({ minLength: 1, required: false }),
  },
});

const failureExplainerSchema = createStrictObjectSchema({
  schemaId: "prompt.failure_explainer.proposal.v1",
  fields: {
    summary: stringField({ minLength: 1 }),
    suggestedNextStep: stringField({ minLength: 1, required: false }),
    canRetry: jsonField(),
    detailLevel: enumField(["safe", "detailed"]),
    detailedDiagnostic: stringField({ minLength: 1, required: false }),
  },
});

const focusThreadResolverSchema = createStrictObjectSchema({
  schemaId: "prompt.focus_thread_resolver.proposal.v1",
  fields: {
    confidence: jsonField(),
    refersTo: enumField(["focus_anchor", "pending", "latest", "temporal_attention", "unclear"]),
    candidates: jsonField(),
    needsClarification: jsonField(),
    clarificationQuestion: stringField({ minLength: 1, required: false }),
  },
});

function normalizeJsonText(rawText) {
  return String(rawText || "").replace(/```json?\s*/g, "").replace(/```/g, "").trim();
}

function createInvalidResult(schemaId, errors) {
  return Object.freeze({
    valid: false,
    schemaId,
    errors: Object.freeze(errors),
    clampReasons: Object.freeze(["schema_invalid"]),
  });
}

function parseJsonProposalText(rawText, schema) {
  try {
    const parsed = JSON.parse(normalizeJsonText(rawText));
    return validateSchemaProposal(parsed, schema);
  } catch (error) {
    return createInvalidResult(schema.schemaId, [
      error instanceof Error ? error.message : "Invalid JSON payload",
    ]);
  }
}

function validateSchemaProposal(value, schema) {
  const validation = schema.validate(value);
  if (!validation.ok) {
    return createInvalidResult(schema.schemaId, validation.errors || []);
  }
  return Object.freeze({
    valid: true,
    schemaId: schema.schemaId,
    value: Object.freeze(validation.value),
    errors: Object.freeze([]),
    clampReasons: Object.freeze([]),
  });
}

function normalizeConfidence(value) {
  const confidence = typeof value === "number" ? value : Number(value);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null;
}

function validateWorkflowPlannerProposal(value) {
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) {
    return createInvalidResult("prompt.workflow_planner.proposal.v1", ["proposal must be an object"]);
  }
  const errors = [];
  const goal = typeof value.goal === "string" && value.goal.trim().length > 0 ? value.goal.trim() : null;
  if (!goal) errors.push("goal is required");
  const confidence = normalizeConfidence(value.confidence);
  if (confidence === null) errors.push("confidence must be numeric");
  const riskHints = value.riskHints;
  if (typeof riskHints !== "object" || riskHints === null) {
    errors.push("riskHints must be an object");
  }
  const steps = Array.isArray(value.steps) ? value.steps : null;
  if (!steps) {
    errors.push("steps must be an array");
  } else if (steps.length === 0) {
    errors.push("steps must contain at least one step");
  }

  const normalizedSteps = [];
  if (steps) {
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (typeof step !== "object" || step === null || Object.getPrototypeOf(step) !== Object.prototype) {
        errors.push(`steps[${index}] must be an object`);
        continue;
      }
      const id = typeof step.id === "string" && step.id.trim().length > 0 ? step.id.trim() : null;
      const reason = typeof step.reason === "string" && step.reason.trim().length > 0 ? step.reason.trim() : null;
      const extensionId = typeof step.extensionId === "string" && step.extensionId.trim().length > 0 ? step.extensionId.trim() : null;
      const capabilityId = typeof step.capabilityId === "string" && step.capabilityId.trim().length > 0 ? step.capabilityId.trim() : null;
      const args = typeof step.args === "object" && step.args !== null ? step.args : null;
      const dependsOnStep = typeof step.dependsOnStep === "string" && step.dependsOnStep.trim().length > 0
        ? step.dependsOnStep.trim()
        : undefined;
      if (!id) errors.push(`steps[${index}].id is required`);
      if (!reason) errors.push(`steps[${index}].reason is required`);
      if (!extensionId) errors.push(`steps[${index}].extensionId is required`);
      if (!capabilityId) errors.push(`steps[${index}].capabilityId is required`);
      if (!args) errors.push(`steps[${index}].args must be an object`);
      if (id && reason && extensionId && capabilityId && args) {
        normalizedSteps.push(Object.freeze({ id, reason, extensionId, capabilityId, args, ...(dependsOnStep ? { dependsOnStep } : {}) }));
      }
    }
  }

  if (errors.length > 0) {
    return createInvalidResult("prompt.workflow_planner.proposal.v1", errors);
  }
  return Object.freeze({
    valid: true,
    schemaId: "prompt.workflow_planner.proposal.v1",
    value: Object.freeze({
      goal,
      confidence,
      riskHints,
      steps: Object.freeze(normalizedSteps),
    }),
    errors: Object.freeze([]),
    clampReasons: Object.freeze([]),
  });
}

function requireValidProposal(validation, fallbackMessage) {
  if (validation.valid) {
    return validation.value;
  }
  throw new RuntimeExecutionError(fallbackMessage, {
    schemaId: validation.schemaId,
    errors: validation.errors,
    clampReasons: validation.clampReasons,
  });
}

export {
  routerProposalSchema,
  automationPlannerSchema,
  failureExplainerSchema,
  focusThreadResolverSchema,
  parseJsonProposalText,
  validateSchemaProposal,
  validateWorkflowPlannerProposal,
  normalizeConfidence,
  requireValidProposal,
};
