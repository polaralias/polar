import {
  booleanField,
  RuntimeExecutionError,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "@polar/domain";
import { createJsonSchemaResponseFormat } from "./structured-output.mjs";

const ROUTER_DECISIONS = Object.freeze([
  "respond",
  "delegate",
  "tool",
  "workflow",
  "clarify",
]);

const ROUTER_REFERENCE_TYPES = Object.freeze([
  "focus_anchor",
  "pending",
  "latest",
  "temporal_attention",
  "unclear",
]);

const AUTOMATION_PLANNER_DECISIONS = Object.freeze([
  "propose",
  "clarify",
  "skip",
]);

const AUTOMATION_RUN_SCOPE_NAMES = Object.freeze([
  "session",
  "user",
  "workspace",
  "profile",
]);

const AUTOMATION_SCHEDULE_KINDS = Object.freeze([
  "interval",
  "daily",
  "weekly",
  "event",
]);

const routerProposalBaseSchema = createStrictObjectSchema({
  schemaId: "prompt.router.proposal.v1",
  fields: {
    decision: enumField(ROUTER_DECISIONS),
    target: jsonField({ required: false }),
    confidence: numberField({ min: 0, max: 1 }),
    rationale: stringField({ minLength: 1 }),
    references: jsonField({ required: false }),
    scores: jsonField({ required: false }),
  },
});

const routerProposalReferencesSchema = createStrictObjectSchema({
  schemaId: "prompt.router.proposal.v1.references",
  fields: {
    refersTo: enumField(ROUTER_REFERENCE_TYPES),
    refersToReason: stringField({ minLength: 1 }),
  },
});

const routerProposalScoresSchema = createStrictObjectSchema({
  schemaId: "prompt.router.proposal.v1.scores",
  fields: {
    respond: numberField({ min: 0, max: 1, required: false }),
    delegate: numberField({ min: 0, max: 1, required: false }),
    tool: numberField({ min: 0, max: 1, required: false }),
    workflow: numberField({ min: 0, max: 1, required: false }),
    clarify: numberField({ min: 0, max: 1, required: false }),
  },
});

const routerDelegateTargetSchema = createStrictObjectSchema({
  schemaId: "prompt.router.proposal.v1.target.delegate",
  fields: {
    agentId: stringField({ minLength: 1 }),
  },
});

const routerToolTargetSchema = createStrictObjectSchema({
  schemaId: "prompt.router.proposal.v1.target.tool",
  fields: {
    extensionId: stringField({ minLength: 1 }),
    capabilityId: stringField({ minLength: 1 }),
    args: jsonField({ required: false }),
  },
});

const routerWorkflowTargetSchema = createStrictObjectSchema({
  schemaId: "prompt.router.proposal.v1.target.workflow",
  fields: {
    templateId: stringField({ minLength: 1 }),
    args: jsonField({ required: false }),
  },
});

const automationPlannerBaseSchema = createStrictObjectSchema({
  schemaId: "prompt.automation_planner.proposal.v1",
  fields: {
    decision: enumField(AUTOMATION_PLANNER_DECISIONS),
    confidence: numberField({ min: 0, max: 1 }),
    summary: stringField({ minLength: 1 }),
    schedule: jsonField({ required: false }),
    runScope: jsonField({ required: false }),
    limits: jsonField({ required: false }),
    riskHints: jsonField({ required: false }),
    clarificationQuestion: stringField({ minLength: 1, required: false }),
  },
});

const automationPlannerScheduleSchema = createStrictObjectSchema({
  schemaId: "prompt.automation_planner.proposal.v1.schedule",
  fields: {
    kind: enumField(AUTOMATION_SCHEDULE_KINDS),
    expression: stringField({ minLength: 1 }),
  },
});

const automationPlannerRunScopeSchema = createStrictObjectSchema({
  schemaId: "prompt.automation_planner.proposal.v1.run_scope",
  fields: {
    scope: enumField(AUTOMATION_RUN_SCOPE_NAMES, { required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    userId: stringField({ minLength: 1, required: false }),
    workspaceId: stringField({ minLength: 1, required: false }),
    profileId: stringField({ minLength: 1, required: false }),
  },
});

const automationPlannerQuietHoursSchema = createStrictObjectSchema({
  schemaId: "prompt.automation_planner.proposal.v1.limits.quiet_hours",
  fields: {
    startHour: numberField({ required: false }),
    endHour: numberField({ required: false }),
    timezone: stringField({ minLength: 0, required: false }),
  },
});

const automationPlannerLimitsSchema = createStrictObjectSchema({
  schemaId: "prompt.automation_planner.proposal.v1.limits",
  fields: {
    maxNotificationsPerDay: numberField({ required: false }),
    quietHours: jsonField({ required: false }),
    inbox: jsonField({ required: false }),
  },
});

const automationPlannerRiskHintsSchema = createStrictObjectSchema({
  schemaId: "prompt.automation_planner.proposal.v1.risk_hints",
  fields: {
    mayWrite: booleanField({ required: false }),
    requiresApproval: booleanField({ required: false }),
  },
});

const failureExplainerSchema = createStrictObjectSchema({
  schemaId: "prompt.failure_explainer.proposal.v1",
  fields: {
    summary: stringField({ minLength: 1 }),
    suggestedNextStep: stringField({ minLength: 1, required: false }),
    canRetry: booleanField(),
    detailLevel: enumField(["safe", "detailed"]),
    detailedDiagnostic: stringField({ minLength: 1, required: false }),
  },
});

const focusThreadResolverBaseSchema = createStrictObjectSchema({
  schemaId: "prompt.focus_thread_resolver.proposal.v1",
  fields: {
    confidence: numberField({ min: 0, max: 1 }),
    refersTo: enumField(ROUTER_REFERENCE_TYPES),
    candidates: jsonField(),
    needsClarification: booleanField(),
    clarificationQuestion: stringField({ minLength: 1, required: false }),
  },
});

const focusThreadResolverCandidateSchema = createStrictObjectSchema({
  schemaId: "prompt.focus_thread_resolver.proposal.v1.candidate",
  fields: {
    anchorId: stringField({ minLength: 1 }),
    threadKey: stringField({ minLength: 1 }),
    score: numberField(),
    reason: stringField({ minLength: 1 }),
  },
});

function createSchemaFailure(errors) {
  return Object.freeze({
    ok: false,
    errors: Object.freeze(errors),
  });
}

function validateRouterTarget(decision, target) {
  if (decision === "delegate") {
    return routerDelegateTargetSchema.validate(target);
  }
  if (decision === "tool") {
    return routerToolTargetSchema.validate(target);
  }
  if (decision === "workflow") {
    return routerWorkflowTargetSchema.validate(target);
  }
  return { ok: true, value: undefined };
}

function validateAutomationPlannerField(schema, value, errors) {
  const validation = schema.validate(value);
  if (!validation.ok) {
    errors.push(...(validation.errors || []));
    return null;
  }
  return validation.value;
}

const routerProposalSchema = Object.freeze({
  schemaId: routerProposalBaseSchema.schemaId,
  validate(value) {
    const baseValidation = routerProposalBaseSchema.validate(value);
    if (!baseValidation.ok) {
      return baseValidation;
    }

    const proposal = baseValidation.value;
    const normalized = {
      decision: proposal.decision,
      confidence: proposal.confidence,
      rationale: proposal.rationale,
    };
    const errors = [];
    const hasTarget = Object.prototype.hasOwnProperty.call(proposal, "target");

    if (Object.prototype.hasOwnProperty.call(proposal, "references")) {
      const referencesValidation = routerProposalReferencesSchema.validate(proposal.references);
      if (!referencesValidation.ok) {
        errors.push(...(referencesValidation.errors || []));
      } else {
        normalized.references = referencesValidation.value;
      }
    }

    if (Object.prototype.hasOwnProperty.call(proposal, "scores")) {
      const scoresValidation = routerProposalScoresSchema.validate(proposal.scores);
      if (!scoresValidation.ok) {
        errors.push(...(scoresValidation.errors || []));
      } else {
        normalized.scores = scoresValidation.value;
      }
    }

    if (proposal.decision === "respond" || proposal.decision === "clarify") {
      if (hasTarget) {
        errors.push(`${routerProposalBaseSchema.schemaId}.target must be omitted when decision is "${proposal.decision}"`);
      }
    } else if (!hasTarget) {
      errors.push(`${routerProposalBaseSchema.schemaId}.target is required when decision is "${proposal.decision}"`);
    } else {
      const targetValidation = validateRouterTarget(proposal.decision, proposal.target);
      if (!targetValidation.ok) {
        errors.push(...(targetValidation.errors || []));
      } else if (targetValidation.value !== undefined) {
        normalized.target = targetValidation.value;
      }
    }

    if (errors.length > 0) {
      return createSchemaFailure(errors);
    }

    return Object.freeze({
      ok: true,
      value: Object.freeze(normalized),
    });
  },
});

const routerNativeJsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["decision", "confidence", "rationale"],
  properties: {
    decision: {
      type: "string",
      enum: [...ROUTER_DECISIONS],
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    rationale: {
      type: "string",
      minLength: 1,
    },
    target: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["agentId"],
          properties: {
            agentId: { type: "string", minLength: 1 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["extensionId", "capabilityId"],
          properties: {
            extensionId: { type: "string", minLength: 1 },
            capabilityId: { type: "string", minLength: 1 },
            args: {},
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["templateId"],
          properties: {
            templateId: { type: "string", minLength: 1 },
            args: {},
          },
        },
      ],
    },
    references: {
      type: "object",
      additionalProperties: false,
      required: ["refersTo", "refersToReason"],
      properties: {
        refersTo: {
          type: "string",
          enum: [...ROUTER_REFERENCE_TYPES],
        },
        refersToReason: {
          type: "string",
          minLength: 1,
        },
      },
    },
    scores: {
      type: "object",
      additionalProperties: false,
      properties: {
        respond: { type: "number", minimum: 0, maximum: 1 },
        delegate: { type: "number", minimum: 0, maximum: 1 },
        tool: { type: "number", minimum: 0, maximum: 1 },
        workflow: { type: "number", minimum: 0, maximum: 1 },
        clarify: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  },
  allOf: [
    {
      if: {
        properties: { decision: { const: "delegate" } },
        required: ["decision"],
      },
      then: {
        required: ["target"],
        properties: {
          target: {
            type: "object",
            additionalProperties: false,
            required: ["agentId"],
            properties: {
              agentId: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
    {
      if: {
        properties: { decision: { const: "tool" } },
        required: ["decision"],
      },
      then: {
        required: ["target"],
        properties: {
          target: {
            type: "object",
            additionalProperties: false,
            required: ["extensionId", "capabilityId"],
            properties: {
              extensionId: { type: "string", minLength: 1 },
              capabilityId: { type: "string", minLength: 1 },
              args: {},
            },
          },
        },
      },
    },
    {
      if: {
        properties: { decision: { const: "workflow" } },
        required: ["decision"],
      },
      then: {
        required: ["target"],
        properties: {
          target: {
            type: "object",
            additionalProperties: false,
            required: ["templateId"],
            properties: {
              templateId: { type: "string", minLength: 1 },
              args: {},
            },
          },
        },
      },
    },
    {
      if: {
        properties: {
          decision: {
            type: "string",
            enum: ["respond", "clarify"],
          },
        },
        required: ["decision"],
      },
      then: {
        not: {
          required: ["target"],
        },
      },
    },
  ],
});

const routerResponseFormat = createJsonSchemaResponseFormat(
  "prompt_router_proposal_v1",
  routerNativeJsonSchema,
);

const automationPlannerSchema = Object.freeze({
  schemaId: automationPlannerBaseSchema.schemaId,
  validate(value) {
    const baseValidation = automationPlannerBaseSchema.validate(value);
    if (!baseValidation.ok) {
      return baseValidation;
    }

    const proposal = baseValidation.value;
    const normalized = {
      decision: proposal.decision,
      confidence: proposal.confidence,
      summary: proposal.summary,
    };
    const errors = [];

    if (Object.prototype.hasOwnProperty.call(proposal, "schedule")) {
      const schedule = validateAutomationPlannerField(
        automationPlannerScheduleSchema,
        proposal.schedule,
        errors,
      );
      if (schedule) {
        normalized.schedule = schedule;
      }
    } else if (proposal.decision === "propose") {
      errors.push(
        `${automationPlannerBaseSchema.schemaId}.schedule is required when decision is "propose"`,
      );
    }

    if (Object.prototype.hasOwnProperty.call(proposal, "runScope")) {
      const runScope = validateAutomationPlannerField(
        automationPlannerRunScopeSchema,
        proposal.runScope,
        errors,
      );
      if (runScope) {
        normalized.runScope = runScope;
      }
    } else if (proposal.decision === "propose") {
      errors.push(
        `${automationPlannerBaseSchema.schemaId}.runScope is required when decision is "propose"`,
      );
    }

    if (Object.prototype.hasOwnProperty.call(proposal, "limits")) {
      const limits = validateAutomationPlannerField(
        automationPlannerLimitsSchema,
        proposal.limits,
        errors,
      );
      if (limits) {
        const normalizedLimits = { ...limits };
        if (Object.prototype.hasOwnProperty.call(limits, "quietHours")) {
          const quietHours = validateAutomationPlannerField(
            automationPlannerQuietHoursSchema,
            limits.quietHours,
            errors,
          );
          if (quietHours) {
            normalizedLimits.quietHours = quietHours;
          }
        }
        normalized.limits = Object.freeze(normalizedLimits);
      }
    } else if (proposal.decision === "propose") {
      errors.push(
        `${automationPlannerBaseSchema.schemaId}.limits is required when decision is "propose"`,
      );
    }

    if (Object.prototype.hasOwnProperty.call(proposal, "riskHints")) {
      const riskHints = validateAutomationPlannerField(
        automationPlannerRiskHintsSchema,
        proposal.riskHints,
        errors,
      );
      if (riskHints) {
        normalized.riskHints = riskHints;
      }
    } else if (proposal.decision === "propose") {
      errors.push(
        `${automationPlannerBaseSchema.schemaId}.riskHints is required when decision is "propose"`,
      );
    }

    if (proposal.decision === "clarify") {
      if (
        !Object.prototype.hasOwnProperty.call(proposal, "clarificationQuestion") ||
        typeof proposal.clarificationQuestion !== "string" ||
        proposal.clarificationQuestion.length === 0
      ) {
        errors.push(
          `${automationPlannerBaseSchema.schemaId}.clarificationQuestion is required when decision is "clarify"`,
        );
      } else {
        normalized.clarificationQuestion = proposal.clarificationQuestion;
      }
    } else if (Object.prototype.hasOwnProperty.call(proposal, "clarificationQuestion")) {
      normalized.clarificationQuestion = proposal.clarificationQuestion;
    }

    if (errors.length > 0) {
      return createSchemaFailure(errors);
    }

    return Object.freeze({
      ok: true,
      value: Object.freeze(normalized),
    });
  },
});

const automationPlannerNativeJsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["decision", "confidence", "summary"],
  properties: {
    decision: {
      type: "string",
      enum: [...AUTOMATION_PLANNER_DECISIONS],
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    summary: {
      type: "string",
      minLength: 1,
    },
    schedule: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "expression"],
      properties: {
        kind: {
          type: "string",
          enum: [...AUTOMATION_SCHEDULE_KINDS],
        },
        expression: { type: "string", minLength: 1 },
      },
    },
    runScope: {
      type: "object",
      additionalProperties: false,
      properties: {
        scope: {
          type: "string",
          enum: [...AUTOMATION_RUN_SCOPE_NAMES],
        },
        sessionId: { type: "string", minLength: 1 },
        userId: { type: "string", minLength: 1 },
        workspaceId: { type: "string", minLength: 1 },
        profileId: { type: "string", minLength: 1 },
      },
    },
    limits: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxNotificationsPerDay: { type: "number" },
        quietHours: {
          type: "object",
          additionalProperties: false,
          properties: {
            startHour: { type: "number" },
            endHour: { type: "number" },
            timezone: { type: "string", minLength: 1 },
          },
        },
        inbox: {},
      },
    },
    riskHints: {
      type: "object",
      additionalProperties: false,
      properties: {
        mayWrite: { type: "boolean" },
        requiresApproval: { type: "boolean" },
      },
    },
    clarificationQuestion: {
      type: "string",
      minLength: 1,
    },
  },
});

const automationPlannerResponseFormat = createJsonSchemaResponseFormat(
  "prompt_automation_planner_proposal_v1",
  automationPlannerNativeJsonSchema,
);

const workflowPlannerRiskHintsSchema = createStrictObjectSchema({
  schemaId: "prompt.workflow_planner.proposal.v1.risk_hints",
  fields: {
    mayWrite: booleanField({ required: false }),
    requiresApproval: booleanField({ required: false }),
    mayRequireApproval: booleanField({ required: false }),
    mayBeDestructive: booleanField({ required: false }),
  },
});

const workflowPlannerNativeJsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["goal", "confidence", "riskHints", "steps"],
  properties: {
    goal: { type: "string", minLength: 1 },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    riskHints: {
      type: "object",
      additionalProperties: false,
      properties: {
        mayWrite: { type: "boolean" },
        requiresApproval: { type: "boolean" },
        mayRequireApproval: { type: "boolean" },
        mayBeDestructive: { type: "boolean" },
      },
    },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "reason", "extensionId", "capabilityId", "args"],
        properties: {
          id: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
          extensionId: { type: "string", minLength: 1 },
          capabilityId: { type: "string", minLength: 1 },
          args: {
            type: "object",
            additionalProperties: true,
          },
          dependsOnStep: { type: "string", minLength: 1 },
        },
      },
    },
  },
});

const workflowPlannerResponseFormat = createJsonSchemaResponseFormat(
  "prompt_workflow_planner_proposal_v1",
  workflowPlannerNativeJsonSchema,
);

const failureExplainerResponseFormat = createJsonSchemaResponseFormat(
  "prompt_failure_explainer_proposal_v1",
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["summary", "canRetry", "detailLevel"],
    properties: {
      summary: { type: "string", minLength: 1 },
      suggestedNextStep: { type: "string", minLength: 1 },
      canRetry: { type: "boolean" },
      detailLevel: {
        type: "string",
        enum: ["safe", "detailed"],
      },
      detailedDiagnostic: { type: "string", minLength: 1 },
    },
  }),
);

const focusThreadResolverSchema = Object.freeze({
  schemaId: focusThreadResolverBaseSchema.schemaId,
  validate(value) {
    const baseValidation = focusThreadResolverBaseSchema.validate(value);
    if (!baseValidation.ok) {
      return baseValidation;
    }

    const proposal = baseValidation.value;
    const errors = [];
    const normalized = {
      confidence: proposal.confidence,
      refersTo: proposal.refersTo,
      needsClarification: proposal.needsClarification,
    };

    const candidates = Array.isArray(proposal.candidates) ? proposal.candidates : null;
    if (!candidates) {
      errors.push(`${focusThreadResolverBaseSchema.schemaId}.candidates must be an array`);
    } else {
      const normalizedCandidates = [];
      for (let index = 0; index < candidates.length; index += 1) {
        const candidateValidation = focusThreadResolverCandidateSchema.validate(
          candidates[index],
        );
        if (!candidateValidation.ok) {
          errors.push(
            ...(candidateValidation.errors || []).map(
              (error) => `candidates[${index}]: ${error}`,
            ),
          );
          continue;
        }
        normalizedCandidates.push(candidateValidation.value);
      }
      normalized.candidates = Object.freeze(normalizedCandidates);
    }

    if (proposal.needsClarification) {
      if (
        !Object.prototype.hasOwnProperty.call(proposal, "clarificationQuestion") ||
        typeof proposal.clarificationQuestion !== "string" ||
        proposal.clarificationQuestion.length === 0
      ) {
        errors.push(
          `${focusThreadResolverBaseSchema.schemaId}.clarificationQuestion is required when needsClarification is true`,
        );
      } else {
        normalized.clarificationQuestion = proposal.clarificationQuestion;
      }
    } else if (Object.prototype.hasOwnProperty.call(proposal, "clarificationQuestion")) {
      normalized.clarificationQuestion = proposal.clarificationQuestion;
    }

    if (errors.length > 0) {
      return createSchemaFailure(errors);
    }

    return Object.freeze({
      ok: true,
      value: Object.freeze(normalized),
    });
  },
});

const focusThreadResolverResponseFormat = createJsonSchemaResponseFormat(
  "prompt_focus_thread_resolver_proposal_v1",
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["confidence", "refersTo", "candidates", "needsClarification"],
    properties: {
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      refersTo: {
        type: "string",
        enum: [...ROUTER_REFERENCE_TYPES],
      },
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["anchorId", "threadKey", "score", "reason"],
          properties: {
            anchorId: { type: "string", minLength: 1 },
            threadKey: { type: "string", minLength: 1 },
            score: { type: "number" },
            reason: { type: "string", minLength: 1 },
          },
        },
      },
      needsClarification: { type: "boolean" },
      clarificationQuestion: { type: "string", minLength: 1 },
    },
  }),
);

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
  const riskHintsValidation = workflowPlannerRiskHintsSchema.validate(value.riskHints);
  if (!riskHintsValidation.ok) {
    errors.push(...(riskHintsValidation.errors || []));
  }
  const riskHints = riskHintsValidation.ok ? riskHintsValidation.value : null;
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
      const args =
        typeof step.args === "object" &&
        step.args !== null &&
        Object.getPrototypeOf(step.args) === Object.prototype
          ? step.args
          : null;
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
      riskHints: riskHints || {},
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
  routerResponseFormat,
  automationPlannerSchema,
  automationPlannerResponseFormat,
  workflowPlannerResponseFormat,
  failureExplainerSchema,
  failureExplainerResponseFormat,
  focusThreadResolverSchema,
  focusThreadResolverResponseFormat,
  parseJsonProposalText,
  validateSchemaProposal,
  validateWorkflowPlannerProposal,
  normalizeConfidence,
  requireValidProposal,
};
