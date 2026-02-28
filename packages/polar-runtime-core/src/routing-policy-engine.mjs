import crypto from 'crypto';
import {
  ContractValidationError,
  HANDOFF_PROFILE_RESOLUTION_SCOPES,
  HANDOFF_ROUTING_MODES,
  RuntimeExecutionError,
  createStrictObjectSchema,
  enumField,
  jsonField,
  stringArrayField,
  stringField,
} from "../../polar-domain/src/index.mjs";

const routingRequestSchema = createStrictObjectSchema({
  schemaId: "agent.handoff.routing.request",
  fields: {
    preferredMode: enumField(HANDOFF_ROUTING_MODES, { required: false }),
    sourceAgentId: stringField({ minLength: 1 }),
    targetAgentId: stringField({ minLength: 1, required: false }),
    targetAgentIds: stringArrayField({ minItems: 1, required: false }),
    reason: stringField({ minLength: 1 }),
    payload: jsonField(),
    resolvedProfileId: stringField({ minLength: 1, required: false }),
    resolvedProfileScope: enumField(HANDOFF_PROFILE_RESOLUTION_SCOPES, {
      required: false,
    }),
    resolvedProfileConfig: jsonField({ required: false }),
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
 * @param {string} fieldName
 * @returns {"direct"|"delegate"|"fanout-fanin"|undefined}
 */
function normalizeOptionalRoutingMode(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !HANDOFF_ROUTING_MODES.includes(value)) {
    throw new ContractValidationError(`Invalid ${fieldName}`, {
      fieldName,
      reason: "must be a valid handoff routing mode",
      expected: HANDOFF_ROUTING_MODES,
      value,
    });
  }

  return value;
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {readonly ("direct"|"delegate"|"fanout-fanin")[]|undefined}
 */
function normalizeOptionalRoutingModeArray(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new ContractValidationError(`Invalid ${fieldName}`, {
      fieldName,
      reason: "must be a non-empty array of handoff routing modes",
      expected: HANDOFF_ROUTING_MODES,
      value,
    });
  }

  const normalized = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = normalizeOptionalRoutingMode(
      value[index],
      `${fieldName}[${index}]`,
    );
    if (item !== undefined && !seen.has(item)) {
      seen.add(item);
      normalized.push(item);
    }
  }

  if (normalized.length === 0) {
    throw new ContractValidationError(`Invalid ${fieldName}`, {
      fieldName,
      reason: "must contain at least one unique handoff routing mode",
      expected: HANDOFF_ROUTING_MODES,
    });
  }

  return Object.freeze(normalized);
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @param {number} min
 * @returns {number|undefined}
 */
function normalizeOptionalIntegerMin(value, fieldName, min) {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min
  ) {
    throw new ContractValidationError(`Invalid ${fieldName}`, {
      fieldName,
      reason: `must be an integer >= ${min}`,
      min,
      value,
    });
  }

  return value;
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {readonly string[]|undefined}
 */
function normalizeOptionalStringArray(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new ContractValidationError(`Invalid ${fieldName}`, {
      fieldName,
      reason: "must be an array of non-empty strings",
      value,
    });
  }

  const normalized = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "string" || item.length === 0) {
      throw new ContractValidationError(`Invalid ${fieldName}[${index}]`, {
        fieldName,
        index,
        reason: "must be a non-empty string",
      });
    }
    if (!seen.has(item)) {
      seen.add(item);
      normalized.push(item);
    }
  }

  return Object.freeze(normalized);
}

/**
 * @param {Record<string, unknown>} request
 * @returns {{
 *   allowedHandoffModes?: readonly ("direct"|"delegate"|"fanout-fanin")[],
 *   defaultHandoffMode?: "direct"|"delegate"|"fanout-fanin",
 *   maxFanoutAgents?: number,
 *   allowedHandoffTargets?: readonly string[],
 * }}
 */
function parseResolvedProfileRoutingConstraints(request) {
  if (!isPlainObject(request.resolvedProfileConfig)) {
    return Object.freeze({});
  }

  const profileConfig = request.resolvedProfileConfig;
  const allowedHandoffModes = normalizeOptionalRoutingModeArray(
    profileConfig.allowedHandoffModes,
    "resolvedProfileConfig.allowedHandoffModes",
  );
  const defaultHandoffMode = normalizeOptionalRoutingMode(
    profileConfig.defaultHandoffMode,
    "resolvedProfileConfig.defaultHandoffMode",
  );
  const maxFanoutAgents = normalizeOptionalIntegerMin(
    profileConfig.maxFanoutAgents,
    "resolvedProfileConfig.maxFanoutAgents",
    2,
  );

  const allowedHandoffTargets = normalizeOptionalStringArray(
    profileConfig.allowedHandoffTargets,
    "resolvedProfileConfig.allowedHandoffTargets",
  );

  if (
    defaultHandoffMode !== undefined &&
    allowedHandoffModes !== undefined &&
    !allowedHandoffModes.includes(defaultHandoffMode)
  ) {
    throw new ContractValidationError(
      "resolvedProfileConfig.defaultHandoffMode must be included in resolvedProfileConfig.allowedHandoffModes when both are provided",
      {
        defaultHandoffMode,
        allowedHandoffModes,
      },
    );
  }

  return Object.freeze({
    allowedHandoffModes,
    defaultHandoffMode,
    maxFanoutAgents,
    allowedHandoffTargets,
  });
}

/**
 * @param {Record<string, unknown>} request
 * @param {"direct"|"delegate"|"fanout-fanin"} mode
 * @returns {Record<string, unknown>}
 */
function createModeRouteCandidate(request, mode) {
  if (mode === "direct") {
    return Object.freeze({ mode });
  }

  const targetAgentId = /** @type {string|undefined} */ (request.targetAgentId);
  const targetAgentIds = /** @type {readonly string[]|undefined} */ (request.targetAgentIds);

  if (mode === "delegate") {
    return Object.freeze({
      mode,
      targetAgentId:
        targetAgentId ??
        (Array.isArray(targetAgentIds) && targetAgentIds.length > 0
          ? targetAgentIds[0]
          : undefined),
    });
  }

  return Object.freeze({
    mode,
    targetAgentIds: targetAgentIds ?? [],
  });
}

/**
 * @param {Record<string, unknown>} request
 * @param {readonly ("direct"|"delegate"|"fanout-fanin")[]} candidateModes
 * @returns {Record<string, unknown>|undefined}
 */
function selectFirstValidAllowedRoute(request, candidateModes) {
  for (let index = 0; index < candidateModes.length; index += 1) {
    const mode = candidateModes[index];
    try {
      return validateRoute(createModeRouteCandidate(request, mode));
    } catch (error) {
      if (!(error instanceof ContractValidationError)) {
        throw error;
      }
    }
  }

  return undefined;
}

/**
 * @param {Record<string, unknown>} route
 * @param {Record<string, unknown>} request
 * @param {readonly ("direct"|"delegate"|"fanout-fanin")[]|undefined} allowedHandoffModes
 * @param {"direct"|"delegate"|"fanout-fanin"|undefined} defaultHandoffMode
 * @returns {Record<string, unknown>}
 */
function applyAllowedHandoffModesConstraint(
  route,
  request,
  allowedHandoffModes,
  defaultHandoffMode,
) {
  if (allowedHandoffModes === undefined) {
    return route;
  }

  const preferredMode = /** @type {"direct"|"delegate"|"fanout-fanin"|undefined} */ (
    request.preferredMode
  );
  if (
    preferredMode !== undefined &&
    !allowedHandoffModes.includes(preferredMode)
  ) {
    throw new ContractValidationError(
      "Requested preferred handoff mode is not allowed by resolved profile",
      {
        preferredMode,
        allowedHandoffModes,
      },
    );
  }

  if (allowedHandoffModes.includes(route.mode)) {
    return route;
  }

  const candidateModes = [];
  if (defaultHandoffMode !== undefined) {
    candidateModes.push(defaultHandoffMode);
  }
  for (let index = 0; index < allowedHandoffModes.length; index += 1) {
    const mode = allowedHandoffModes[index];
    if (!candidateModes.includes(mode)) {
      candidateModes.push(mode);
    }
  }

  const fallbackRoute = selectFirstValidAllowedRoute(request, candidateModes);
  if (fallbackRoute !== undefined) {
    return fallbackRoute;
  }

  throw new ContractValidationError(
    "Resolved profile handoff mode policy disallows all feasible routes for this request",
    {
      allowedHandoffModes,
      requestedMode: route.mode,
      sourceAgentId: request.sourceAgentId,
      targetAgentId: request.targetAgentId,
      targetAgentIds: request.targetAgentIds ?? [],
    },
  );
}

/**
 * @param {Record<string, unknown>} route
 * @param {number|undefined} maxFanoutAgents
 * @returns {Record<string, unknown>}
 */
function applyMaxFanoutConstraint(route, maxFanoutAgents) {
  if (
    maxFanoutAgents === undefined ||
    route.mode !== "fanout-fanin" ||
    !Array.isArray(route.targetAgentIds) ||
    route.targetAgentIds.length <= maxFanoutAgents
  ) {
    return route;
  }

  return Object.freeze({
    mode: route.mode,
    targetAgentIds: Object.freeze(route.targetAgentIds.slice(0, maxFanoutAgents)),
  });
}

/**
 * @param {Record<string, unknown>} route
 * @param {readonly string[]|undefined} allowedHandoffTargets
 * @returns {Record<string, unknown>}
 */
function applyAllowedHandoffTargetsConstraint(route, allowedHandoffTargets) {
  if (allowedHandoffTargets === undefined || route.mode === "direct") {
    return route;
  }

  const allowedSet = new Set(allowedHandoffTargets);

  if (route.mode === "delegate") {
    if (typeof route.targetAgentId === "string" && !allowedSet.has(route.targetAgentId)) {
      throw new ContractValidationError("Target agent is not in allowedHandoffTargets", {
        targetAgentId: route.targetAgentId,
        allowedHandoffTargets,
      });
    }
    return route;
  }

  if (route.mode === "fanout-fanin" && Array.isArray(route.targetAgentIds)) {
    const invalidTargets = route.targetAgentIds.filter(id => !allowedSet.has(id));
    if (invalidTargets.length > 0) {
      throw new ContractValidationError("One or more target agents are not in allowedHandoffTargets", {
        invalidTargets,
        allowedHandoffTargets,
      });
    }
  }

  return route;
}

/**
 * @param {Record<string, unknown>} route
 * @returns {Record<string, unknown>}
 */
function validateRoute(route) {
  const mode = /** @type {"direct"|"delegate"|"fanout-fanin"|undefined} */ (route.mode);
  if (!mode || !HANDOFF_ROUTING_MODES.includes(mode)) {
    throw new ContractValidationError("Invalid handoff route mode", {
      mode: route.mode,
      expected: HANDOFF_ROUTING_MODES,
    });
  }

  const targetAgentId = /** @type {string|undefined} */ (route.targetAgentId);
  const targetAgentIds = /** @type {readonly string[]|undefined} */ (route.targetAgentIds);

  if (mode === "direct") {
    return Object.freeze({
      mode,
    });
  }

  if (mode === "delegate") {
    if (typeof targetAgentId === "string" && targetAgentId.length > 0) {
      return Object.freeze({
        mode,
        targetAgentId,
      });
    }

    if (Array.isArray(targetAgentIds) && targetAgentIds.length === 1) {
      return Object.freeze({
        mode,
        targetAgentId: targetAgentIds[0],
      });
    }

    throw new ContractValidationError(
      "Delegate route requires one target agent",
      {
        mode,
        targetAgentId,
        targetAgentIds: targetAgentIds ?? [],
      },
    );
  }

  if (!Array.isArray(targetAgentIds) || targetAgentIds.length < 2) {
    throw new ContractValidationError(
      "Fanout-fanin route requires at least two target agents",
      {
        mode,
        targetAgentIds: targetAgentIds ?? [],
      },
    );
  }

  return Object.freeze({
    mode,
    targetAgentIds: Object.freeze([...targetAgentIds]),
  });
}

/**
 * @param {Record<string, unknown>} request
 * @returns {Record<string, unknown>}
 */
function decideDefaultRoute(request) {
  const targetAgentId = /** @type {string|undefined} */ (request.targetAgentId);
  const targetAgentIds = /** @type {readonly string[]|undefined} */ (request.targetAgentIds);
  const preferredMode = /** @type {"direct"|"delegate"|"fanout-fanin"|undefined} */ (
    request.preferredMode
  );

  if (preferredMode === "direct") {
    return Object.freeze({ mode: "direct" });
  }

  if (preferredMode === "delegate") {
    return Object.freeze({
      mode: "delegate",
      targetAgentId:
        targetAgentId ??
        (Array.isArray(targetAgentIds) && targetAgentIds.length > 0
          ? targetAgentIds[0]
          : undefined),
    });
  }

  if (preferredMode === "fanout-fanin") {
    return Object.freeze({
      mode: "fanout-fanin",
      targetAgentIds: targetAgentIds ?? [],
    });
  }

  if (Array.isArray(targetAgentIds) && targetAgentIds.length > 1) {
    return Object.freeze({
      mode: "fanout-fanin",
      targetAgentIds,
    });
  }

  if (typeof targetAgentId === "string" && targetAgentId.length > 0) {
    return Object.freeze({
      mode: "delegate",
      targetAgentId,
    });
  }

  if (Array.isArray(targetAgentIds) && targetAgentIds.length === 1) {
    return Object.freeze({
      mode: "delegate",
      targetAgentId: targetAgentIds[0],
    });
  }

  return Object.freeze({ mode: "direct" });
}

/**
 * @param {{ decide?: (request: Record<string, unknown>) => Record<string, unknown>|Promise<Record<string, unknown>> }} [config]
 */
export function createRoutingPolicyEngine(config = {}) {
  const { decide } = config;
  if (decide !== undefined && typeof decide !== "function") {
    throw new RuntimeExecutionError("Routing policy decide must be a function when provided");
  }

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async decide(request) {
      const validation = routingRequestSchema.validate(request);
      if (!validation.ok) {
        throw new ContractValidationError("Invalid handoff routing request", {
          schemaId: routingRequestSchema.schemaId,
          errors: validation.errors ?? [],
        });
      }

      const parsed = /** @type {Record<string, unknown>} */ (validation.value);
      const constraints = parseResolvedProfileRoutingConstraints(parsed);
      const route = decide
        ? await decide(parsed)
        : decideDefaultRoute(parsed);

      if (!isPlainObject(route)) {
        throw new RuntimeExecutionError("Routing policy returned invalid route shape");
      }

      const validatedRoute = validateRoute(route);
      const targetConstrainedRoute = applyAllowedHandoffTargetsConstraint(
        validatedRoute,
        constraints.allowedHandoffTargets,
      );
      const modeConstrainedRoute = applyAllowedHandoffModesConstraint(
        targetConstrainedRoute,
        parsed,
        constraints.allowedHandoffModes,
        constraints.defaultHandoffMode,
      );
      return applyMaxFanoutConstraint(
        modeConstrainedRoute,
        constraints.maxFanoutAgents,
      );
    },
  });
}

/**
 * Classifies a user message for routing to appropriate thread operations.
 * @param {Object} args
 * @param {string} args.text The raw user message
 * @param {Object} args.sessionState The current threads in the session
 * @returns {{ type: 'override'|'answer_to_pending'|'status_nudge'|'new_request'|'filler', targetThreadId?: string, intent?: string, slotKey?: string, slotValue?: string }}
 */
export function classifyUserMessage({ text = "", sessionState = { threads: [], activeThreadId: null } }) {
  const normalized = text.toLowerCase().trim().replace(/[?!.]+$/, "");

  // 1) Override / steering beats everything
  const overrideKeywords = ["actually", "ignore", "stop", "cancel", "instead", "forget", "wait", "scrap that", "scrap it"];
  if (overrideKeywords.some(o => normalized.startsWith(o))) {
    return {
      type: "override",
      targetThreadId: sessionState.activeThreadId
    };
  }

  // 2) Status/progress nudge
  // Architecture says: "attaches to most recent in_progress/blocked thread even if another thread has pending_question"
  const statusNudgeKeywords = ["any luck", "update", "status", "anyone there", "any news", "hello", "hi", "hey", "?"];
  if (statusNudgeKeywords.includes(normalized) ||
    (normalized.length === 0 && text.trim() === "?") ||
    statusNudgeKeywords.some(n => normalized.startsWith(n + " "))) {

    const target = [...sessionState.threads].reverse().find(t =>
      ['in_progress', 'blocked', 'workflow_proposed'].includes(t.status)
    );
    if (target) {
      return {
        type: "status_nudge",
        targetThreadId: target.id
      };
    }
  }

  // 3) Answer to pending question
  const pendingThread = [...sessionState.threads].reverse().find(t =>
    t.status === 'waiting_for_user' && t.pendingQuestion
  );

  if (pendingThread) {
    const { expectedType } = pendingThread.pendingQuestion;
    if (isFittedAnswer(text, expectedType)) {
      return {
        type: "answer_to_pending",
        targetThreadId: pendingThread.id,
        slotKey: pendingThread.pendingQuestion.key,
        slotValue: text
      };
    }
  }

  // 4) Filler (e.g. "ok", "thanks", "cool") - non-mutating
  const fillerKeywords = ["ok", "okay", "thanks", "thank you", "cool", "got it", "nice", "great", "well done"];
  if (fillerKeywords.includes(normalized)) {
    return { type: "filler" };
  }

  // 5) New request
  return { type: "new_request" };
}

/**
 * Checks if the text likely fits the expected type for a slot.
 */
function isFittedAnswer(text, expectedType) {
  if (!expectedType) return true;
  const normalized = text.toLowerCase().trim();

  switch (expectedType) {
    case 'yes_no':
      return /^(yes|no|y|n|yep|nope|sure|nah|ok|okay|confirm|cancel)$/.test(normalized);
    case 'location':
      // Heuristic: No commands, at least a couple chars
      return !/^(actually|ignore|stop|update|status|any luck)/.test(normalized) && text.length >= 2;
    case 'date_time':
      return /(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|at|pm|am|clock|next|last|now)/.test(normalized);
    case 'freeform':
      return text.length > 0;
    default:
      return true;
  }
}

/**
 * Mutates session state deterministically based on classification.
 */
export function applyUserTurn({ sessionState = { threads: [], activeThreadId: null }, classification, rawText, now = Date.now }) {
  const nextState = {
    threads: sessionState.threads.map(t => ({ ...t })),
    activeThreadId: sessionState.activeThreadId
  };

  const ts = typeof now === 'function' ? now() : Date.now();

  if (classification.type === "new_request") {
    const newThread = {
      id: crypto.randomUUID(),
      intent: "unknown",
      slots: {},
      status: "in_progress",
      summary: rawText.substring(0, 50) + (rawText.length > 50 ? "..." : ""),
      lastActivityTs: ts,
      createdAt: ts
    };
    nextState.threads.push(newThread);
    nextState.activeThreadId = newThread.id;
  }
  else if (classification.type === "override" && classification.targetThreadId) {
    const thread = nextState.threads.find(t => t.id === classification.targetThreadId);
    if (thread) {
      thread.status = "in_progress";
      delete thread.pendingQuestion;
      thread.lastActivityTs = ts;
      nextState.activeThreadId = thread.id;
    }
  }
  else if (classification.type === "answer_to_pending" && classification.targetThreadId) {
    const thread = nextState.threads.find(t => t.id === classification.targetThreadId);
    if (thread) {
      thread.status = "in_progress";
      if (classification.slotKey) {
        thread.slots[classification.slotKey] = classification.slotValue;
      } else {
        thread.slots["latest_answer"] = classification.slotValue;
      }
      delete thread.pendingQuestion;
      thread.lastActivityTs = ts;
      nextState.activeThreadId = thread.id;
    }
  }
  else if (classification.type === "status_nudge" && classification.targetThreadId) {
    const thread = nextState.threads.find(t => t.id === classification.targetThreadId);
    if (thread) {
      thread.lastActivityTs = ts;
      nextState.activeThreadId = thread.id;
    }
  }

  return nextState;
}

/**
 * Determines whether to use an inline reply style and to what anchor.
 */
export function selectReplyAnchor({ sessionState, classification }) {
  const activeThreads = sessionState.threads.filter(t => !["done", "failed"].includes(t.status));

  // Rules for inline reply:
  // 1. Multiple active threads (ambiguity risk)
  const multipleActive = activeThreads.length > 1;

  // 2. Replying to a non-active thread (topic switch or jumping back)
  const isTargetingNonActive = classification.targetThreadId && classification.targetThreadId !== sessionState.activeThreadId;

  // 3. Repair / Override
  const isRepair = classification.type === "override";

  if (multipleActive || isTargetingNonActive || isRepair) {
    const targetId = classification.targetThreadId || sessionState.activeThreadId;
    const targetThread = sessionState.threads.find(t => t.id === targetId);
    return {
      useInlineReply: true,
      anchorMessageId: targetThread?.pendingQuestion?.askedAtMessageId
    };
  }

  return { useInlineReply: false };
}
