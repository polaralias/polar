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

// ─── Open-loop / change-of-mind / repair helpers ─────

const YES_SET = new Set([
  'yes', 'y', 'ye', 'yh', 'ya', 'yep', 'yup', 'yeah', 'yea', 'sure',
  'ok', 'okay', 'go on', 'do it', 'please', 'go ahead', 'continue',
  'proceed', 'absolutely', 'definitely', 'of course', 'right', 'alright',
  'fine', 'cool', 'sounds good', 'lets go', 'let\'s go', 'aye', 'indeed'
]);

/** Short-affirmative prefixes for tiny messages (≤4 chars). */
const YES_PREFIXES = ['ye', 'ya', 'yu'];

/**
 * Returns true if `normalized` is a short affirmative.
 * Exact match against YES_SET, or prefix match when message is tiny (≤ 4 chars).
 * @param {string} normalized - lowercased, trim'd, punctuation-stripped text
 * @returns {boolean}
 */
function isShortAffirmative(normalized) {
  if (YES_SET.has(normalized)) return true;
  if (normalized.length <= 4 && YES_PREFIXES.some(p => normalized.startsWith(p))) return true;
  return false;
}

const NO_SET = new Set([
  'no', 'n', 'nah', 'nope', 'leave it', 'skip', 'pass', 'never mind',
  'dont', 'don\'t', 'cancel', 'stop', 'forget it', 'no thanks',
  'no thank you', 'not now', 'not really'
]);

/** Matches "actually yes/yeah/sure/ye/ya" style reversals. */
const AFFIRM_AFTER_REJECT = /^(actually|wait|hmm|oh)\s*(ye[ahps]*|ya|yh|yup|sure|ok|okay|go on|go ahead|do it|please|fine)/i;

/** Matches "explain more / go on / tell me more" short follow-ups. */
const EXPLAIN_MORE = /^(explain\s*more|go\s*on|tell\s*me\s*more|more\??|elaborate|keep\s*going|continue|carry\s*on)$/i;

/** Low-information messages that might attach to any open loop. */
const LOW_INFO = /^(more|that|yeah|ye|ok|okay|sure|yep|yh|ya|go on|\?|please|right|fine|cool)$/i;

/** Short error-inquiry words: must be exact match to prevent false positives on normal questions. */
const ERROR_INQUIRY_SHORT = /^(why|huh|wtf|wth)$/i;
/** Multi-word error inquiry phrases: leading-anchored, allow trailing prepositions ("for", "about"). */
const ERROR_INQUIRY_LONG = /^(what\s*happened|what\s*went\s*wrong|what the|explain the (error|crash|failure)|what was that|what\s*error|show me the error|what was the workflow|what did you (try|do|run)|what failed|what crashed|what broke)/i;

/**
 * Maximum age (ms) for a lastError to be considered "recent" for auto-attachment.
 * 5 minutes.
 */
const LAST_ERROR_TTL_MS = 5 * 60 * 1000;
/** Greeting (hi/hey) only attaches to task if task was active within 2 mins. */
const GREETING_RECENCY_MS = 2 * 60 * 1000;
/** Reversals ("actually yeah") only work if rejection was within 5 mins. */
const REJECTED_OFFER_TTL_MS = 5 * 60 * 1000;
/** Offers on failed threads only stay active for 5 mins. */
const OFFER_RECENCY_MS = 5 * 60 * 1000;

const GREETING_SET = new Set(['hello', 'hi', 'hey']);

/**
 * Detects whether assistant text contains an offer.
 * Returns { isOffer, offerType, offerText } — purely heuristic.
 * @param {string} text
 * @returns {{ isOffer: boolean, offerType?: string, offerText?: string }}
 */
export function detectOfferInText(text) {
  if (!text || typeof text !== 'string') return { isOffer: false };
  const lower = text.toLowerCase();

  // Patterns: "want me to …?", "shall I …?", "should I …?", "would you like me to …?"
  const offerPatterns = [
    /want me to\s+(.{3,60})\??/i,
    /shall i\s+(.{3,60})\??/i,
    /should i\s+(.{3,60})\??/i,
    /would you like me to\s+(.{3,60})\??/i,
    /i can\s+(.{3,60})(?:\s+if you (?:want|like))/i,
  ];

  for (const pattern of offerPatterns) {
    const m = lower.match(pattern);
    if (m) {
      const target = m[1].replace(/[?.!]+$/, '').trim();
      let offerType = 'general';
      if (/explain|elaborate|detail|more about/i.test(target)) offerType = 'explain';
      else if (/troubleshoot|diagnos|debug|fix|investigate/i.test(target)) offerType = 'troubleshoot';
      else if (/search|look up|find/i.test(target)) offerType = 'search';
      return { isOffer: true, offerType, offerText: target };
    }
  }

  return { isOffer: false };
}

/**
 * Push an offer to a thread's recentOffers ring buffer (max 3).
 * Mutates the thread object.
 * @param {Object} thread
 * @param {{ offerType: string, target?: string, askedAtMessageId: string, timestampMs: number }} offer
 */
export function pushRecentOffer(thread, offer) {
  if (!Array.isArray(thread.recentOffers)) thread.recentOffers = [];
  thread.recentOffers.push({ ...offer, outcome: 'pending' });
  if (thread.recentOffers.length > 3) {
    thread.recentOffers = thread.recentOffers.slice(-3);
  }
}

/**
 * Set openOffer on a thread and push to recentOffers.
 * @param {Object} thread
 * @param {{ offerType: string, target?: string, askedAtMessageId: string }} offer
 * @param {number} timestampMs
 */
export function setOpenOffer(thread, offer, timestampMs) {
  thread.openOffer = { ...offer };
  pushRecentOffer(thread, { ...offer, timestampMs });
}

/**
 * Gathers all open loops across all active threads.
 * @param {{ threads: Object[], activeThreadId: string|null }} sessionState
 * @returns {{ threadId: string, loopType: string, detail: Object }[]}
 */
function gatherOpenLoops(sessionState) {
  const loops = [];
  for (const t of sessionState.threads) {
    // Include 'failed' threads for lastError loop detection
    if (t.status === 'done') continue;
    if (t.pendingQuestion) loops.push({ threadId: t.id, loopType: 'pending_question', detail: t.pendingQuestion });
    if (t.inFlight) loops.push({ threadId: t.id, loopType: 'in_flight', detail: t.inFlight });
    if (t.openOffer) loops.push({ threadId: t.id, loopType: 'open_offer', detail: t.openOffer });
    if (t.awaitingApproval) loops.push({ threadId: t.id, loopType: 'awaiting_approval', detail: t.awaitingApproval });
    if (t.lastError) loops.push({ threadId: t.id, loopType: 'last_error', detail: t.lastError });
  }
  return loops;
}

/**
 * Compute whether repair is needed and build the repair_question response.
 * Returns null when repair is not needed.
 * @param {{ threads: Object[], activeThreadId: string|null }} sessionState
 * @param {{ type: string, text?: string }} classification
 * @param {string} rawText
 * @returns {null|{ type: 'repair_question', question: string, correlationId: string, options: Object[] }}
 */
export function computeRepairDecision(sessionState, classification, rawText) {
  // Consider ALL open loop types, not just offers
  const allLoops = gatherOpenLoops(sessionState);

  // Deduplicate by threadId (keep highest-priority loop per thread)
  const loopPriority = { 'last_error': 4, 'in_flight': 3, 'awaiting_approval': 2, 'pending_question': 1, 'open_offer': 0 };
  const byThread = new Map();
  for (const loop of allLoops) {
    const existing = byThread.get(loop.threadId);
    if (!existing || (loopPriority[loop.loopType] || 0) > (loopPriority[existing.loopType] || 0)) {
      byThread.set(loop.threadId, loop);
    }
  }
  const uniqueLoops = [...byThread.values()];

  // Repair only when two or more candidate threads have open loops
  if (uniqueLoops.length < 2) return null;

  // And the message is low-info / ambiguous
  const normalized = (rawText || '').toLowerCase().trim().replace(/[?!.]+$/, '');
  if (!LOW_INFO.test(normalized) && !EXPLAIN_MORE.test(normalized)) return null;

  // Rank by recency (most recent first)
  const threadsById = new Map(sessionState.threads.map(t => [t.id, t]));
  uniqueLoops.sort((a, b) => {
    const ta = threadsById.get(a.threadId)?.lastActivityTs || 0;
    const tb = threadsById.get(b.threadId)?.lastActivityTs || 0;
    return tb - ta;
  });

  // Pick top two candidates
  const candidates = uniqueLoops.slice(0, 2);
  const correlationId = crypto.randomUUID();

  // Build label from loop type and thread summary
  function labelFor(loop) {
    const thread = threadsById.get(loop.threadId);
    if (loop.loopType === 'open_offer') return thread?.openOffer?.target || thread?.summary || 'Option';
    if (loop.loopType === 'last_error') return `Error: ${loop.detail?.capabilityId || thread?.summary || 'recent crash'}`;
    if (loop.loopType === 'in_flight') return `Running: ${loop.detail?.workflowId?.slice(0, 8) || thread?.summary || 'task'}`;
    if (loop.loopType === 'pending_question') return `Question: ${loop.detail?.text || thread?.summary || 'pending'}`;
    if (loop.loopType === 'awaiting_approval') return `Workflow: ${loop.detail?.workflowId?.slice(0, 8) || thread?.summary || 'proposed'}`;
    return thread?.summary || 'Option';
  }

  return {
    type: 'repair_question',
    question: `I'm not sure which topic you mean. Could you pick one?`,
    correlationId,
    options: [
      {
        id: 'A',
        label: labelFor(candidates[0]),
        threadId: candidates[0].threadId,
        action: 'attach_to_thread'
      },
      {
        id: 'B',
        label: labelFor(candidates[1]),
        threadId: candidates[1].threadId,
        action: 'attach_to_thread'
      }
    ]
  };
}

/**
 * Apply a repair selection deterministically.
 * @param {{ threads: Object[], activeThreadId: string|null }} sessionState
 * @param {'A'|'B'} selection
 * @param {string} correlationId
 * @param {{ type: 'repair_question', options: Object[] }} repairContext
 * @param {number} [now]
 * @returns {{ threads: Object[], activeThreadId: string|null }}
 */
export function handleRepairSelection(sessionState, selection, correlationId, repairContext, now) {
  const ts = now || Date.now();
  if (!repairContext || repairContext.correlationId !== correlationId) {
    return sessionState; // stale/invalid selection — no-op
  }

  if (selection !== 'A' && selection !== 'B') {
    return sessionState; // only A/B are valid
  }

  const option = repairContext.options.find(o => o.id === selection);
  if (!option) return sessionState;

  const nextState = {
    threads: sessionState.threads.map(t => ({ ...t })),
    activeThreadId: sessionState.activeThreadId
  };

  if (option.action === 'create_new_thread') {
    const newThread = {
      id: crypto.randomUUID(),
      intent: 'unknown',
      slots: {},
      status: 'in_progress',
      summary: option.label,
      lastActivityTs: ts,
      createdAt: ts
    };
    nextState.threads.push(newThread);
    nextState.activeThreadId = newThread.id;
  } else {
    // attach_to_thread
    const thread = nextState.threads.find(t => t.id === option.threadId);
    if (thread) {
      thread.status = 'in_progress';
      if (thread.openOffer) {
        // Accept the offer on that thread
        const recent = (thread.recentOffers || []).find(
          r => r.askedAtMessageId === thread.openOffer.askedAtMessageId
        );
        if (recent) recent.outcome = 'accepted';
        delete thread.openOffer;
      }
      thread.lastActivityTs = ts;
      nextState.activeThreadId = thread.id;
    }
  }

  return nextState;
}

/**
 * Classifies a user message for routing to appropriate thread operations.
 * @param {Object} args
 * @param {string} args.text The raw user message
 * @param {Object} args.sessionState The current threads in the session
 * @returns {{ type: 'override'|'answer_to_pending'|'status_nudge'|'new_request'|'filler', targetThreadId?: string, intent?: string, slotKey?: string, slotValue?: string }}
 */
export function classifyUserMessage({ text = "", sessionState = { threads: [], activeThreadId: null }, now = Date.now() }) {
  const normalized = text.toLowerCase().trim().replace(/[?!.]+$/, "");

  // Override verbs — if present in a reversal phrase, route to override not accept.
  // We use the user's explicit list: "stop/ignore/instead/cancel/scrap".
  const REVERSAL_BLOCKING_VERBS = ['stop', 'ignore', 'cancel', 'instead', 'forget', 'scrap', 'drop'];

  // 1) Override / steering beats everything
  // Reversal ("actually yeah") is NARROW: only when recent rejected offer + no override verbs
  if (AFFIRM_AFTER_REJECT.test(normalized)) {
    const hasOverrideVerb = REVERSAL_BLOCKING_VERBS.some(v => normalized.includes(v));
    if (!hasOverrideVerb) {
      // Only accept reversal if there's a recently rejected offer (not just an open offer)
      const activeThread = sessionState.threads.find(t => t.id === sessionState.activeThreadId);
      const recentRejected = activeThread?.recentOffers?.slice().reverse().find(r =>
        r.outcome === 'rejected' && (now - (r.timestampMs || 0)) < REJECTED_OFFER_TTL_MS
      );
      if (recentRejected) {
        return {
          type: 'accept_offer',
          targetThreadId: activeThread.id,
          offerDetail: recentRejected
        };
      }
      // Check all threads for a recent rejected offer
      for (const t of [...sessionState.threads].reverse()) {
        const rej = t.recentOffers?.slice().reverse().find(r =>
          r.outcome === 'rejected' && (now - (r.timestampMs || 0)) < REJECTED_OFFER_TTL_MS
        );
        if (rej) {
          return {
            type: 'accept_offer',
            targetThreadId: t.id,
            offerDetail: rej
          };
        }
      }
    }
  }

  const overrideKeywords = ["actually", "ignore", "stop", "cancel", "instead", "forget", "wait", "scrap that", "scrap it"];
  if (overrideKeywords.some(o => normalized.startsWith(o))) {
    return {
      type: "override",
      targetThreadId: sessionState.activeThreadId
    };
  }

  // 2) Status/progress nudge
  // Greetings (hi/hey/hello) only count as nudge if there's a RECENT active task
  const isGreeting = GREETING_SET.has(normalized);
  const nudgeOnlyKeywords = ["any luck", "update", "status", "anyone there", "any news", "?"];
  const isNudgePhrase = nudgeOnlyKeywords.includes(normalized) ||
    (normalized.length === 0 && text.trim() === "?") ||
    nudgeOnlyKeywords.some(n => normalized.startsWith(n + " "));

  if (isNudgePhrase || isGreeting) {
    const target = [...sessionState.threads].reverse().find(t => {
      if (!['in_progress', 'blocked', 'workflow_proposed'].includes(t.status)) return false;
      // For greetings, require recent activity; for explicit nudges, always attach
      if (isGreeting && !isNudgePhrase) {
        return (now - (t.lastActivityTs || 0)) < GREETING_RECENCY_MS;
      }
      return true;
    });
    if (target) {
      return {
        type: "status_nudge",
        targetThreadId: target.id
      };
    }
  }

  // 3) Open offer handling: accept / reject / explain-more
  // Gather open offers — include failed threads if recent (user may want to continue after crash)
  const threadsWithOffers = sessionState.threads.filter(t => {
    if (!t.openOffer) return false;
    if (t.status === 'done') return false;
    // Failed threads are included if recent
    if (t.status === 'failed') {
      return (now - (t.lastActivityTs || 0)) < OFFER_RECENCY_MS;
    }
    return true;
  });

  // 3a) Short affirmative → accept offer (exact match or prefix for tiny messages)
  if (isShortAffirmative(normalized) && threadsWithOffers.length > 0) {
    if (threadsWithOffers.length === 1) {
      return {
        type: 'accept_offer',
        targetThreadId: threadsWithOffers[0].id,
        offerDetail: threadsWithOffers[0].openOffer
      };
    }
    // Multiple offers: will fall through to repair check below
  }

  // 3b) Short negative → reject offer
  if (NO_SET.has(normalized) && threadsWithOffers.length > 0) {
    // Reject the offer on the active thread, or the most recent one
    const activeWithOffer = threadsWithOffers.find(t => t.id === sessionState.activeThreadId);
    const target = activeWithOffer || threadsWithOffers[threadsWithOffers.length - 1];
    return {
      type: 'reject_offer',
      targetThreadId: target.id,
      offerDetail: target.openOffer
    };
  }

  // 3c) "Explain more" / "Go on" — accept if single offer, repair if multiple
  if (EXPLAIN_MORE.test(normalized) && threadsWithOffers.length > 0) {
    if (threadsWithOffers.length === 1) {
      return {
        type: 'accept_offer',
        targetThreadId: threadsWithOffers[0].id,
        offerDetail: threadsWithOffers[0].openOffer
      };
    }
    // Multiple: fall through to repair
  }

  // 3d) Error inquiry: "what happened?" / "why?" / "huh?" — attach to lastError if recent
  // Note: "?" normalizes to "" after punctuation strip, so check raw text as fallback
  const isErrorInquiry = ERROR_INQUIRY_SHORT.test(normalized) || ERROR_INQUIRY_LONG.test(normalized) || (text.trim() === '?');
  if (isErrorInquiry) {
    // Find the most recent thread with a lastError within TTL
    const errorThread = [...sessionState.threads].reverse().find(t => {
      if (!t.lastError) return false;
      return (now - (t.lastError.timestampMs || 0)) < LAST_ERROR_TTL_MS;
    });
    if (errorThread) {
      return {
        type: 'error_inquiry',
        targetThreadId: errorThread.id,
        errorDetail: errorThread.lastError
      };
    }
  }

  // 4) Answer to pending question
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

  // 5) Filler (e.g. "thanks", "cool") - non-mutating
  const fillerKeywords = ["thanks", "thank you", "cool", "got it", "nice", "great", "well done"];
  if (fillerKeywords.includes(normalized)) {
    return { type: "filler" };
  }

  // 6) New request
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
    case 'location': {
      // Tighter location fit: reject questions, long messages, and command-like text
      if (text.includes('?')) return false; // questions are not locations
      const tokens = normalized.split(/\s+/);
      if (tokens.length > 6) return false; // too verbose for a location
      if (/^(what|why|how|who|when|where|which|can|could|would|should|do|did|is|are|was|were)\b/.test(normalized)) return false; // question starters
      if (/^(actually|ignore|stop|update|status|any luck)/.test(normalized)) return false; // commands
      if (text.length < 2) return false;
      return true;
    }
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
export function applyUserTurn({ sessionState = { threads: [], activeThreadId: null }, classification: classificationArg, rawText, now }) {
  const ts = typeof now === 'function' ? now() : (now || Date.now());

  const nextState = {
    threads: sessionState.threads.map(t => ({
      ...t,
      recentOffers: t.recentOffers ? t.recentOffers.map(r => ({ ...r })) : undefined,
      openOffer: t.openOffer ? { ...t.openOffer } : undefined,
      inFlight: t.inFlight ? { ...t.inFlight } : undefined,
      awaitingApproval: t.awaitingApproval ? { ...t.awaitingApproval } : undefined,
      pendingQuestion: t.pendingQuestion ? { ...t.pendingQuestion } : undefined,
      lastError: t.lastError ? { ...t.lastError } : undefined,
    })),
    activeThreadId: sessionState.activeThreadId
  };

  const classification = classificationArg || classifyUserMessage({ text: rawText, sessionState, now: ts });

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
  else if (classification.type === "accept_offer" && classification.targetThreadId) {
    const thread = nextState.threads.find(t => t.id === classification.targetThreadId);
    if (thread) {
      thread.status = "in_progress";
      // Mark the offer as accepted in recentOffers
      if (thread.openOffer) {
        const recent = (thread.recentOffers || []).find(
          r => r.askedAtMessageId === thread.openOffer.askedAtMessageId && r.outcome !== 'accepted'
        );
        if (recent) recent.outcome = 'accepted';
        delete thread.openOffer;
      } else if (classification.offerDetail?.askedAtMessageId) {
        // Reversal: re-accepting a previously rejected offer
        const recent = (thread.recentOffers || []).find(
          r => r.askedAtMessageId === classification.offerDetail.askedAtMessageId
        );
        if (recent) recent.outcome = 'accepted';
      }
      thread.lastActivityTs = ts;
      nextState.activeThreadId = thread.id;
    }
  }
  else if (classification.type === "reject_offer" && classification.targetThreadId) {
    const thread = nextState.threads.find(t => t.id === classification.targetThreadId);
    if (thread) {
      // Mark offer as rejected but keep in recentOffers for change-of-mind
      if (thread.openOffer) {
        const recent = (thread.recentOffers || []).find(
          r => r.askedAtMessageId === thread.openOffer.askedAtMessageId && r.outcome === 'pending'
        );
        if (recent) recent.outcome = 'rejected';
        delete thread.openOffer;
      }
      thread.lastActivityTs = ts;
      nextState.activeThreadId = thread.id;
    }
  }
  else if (classification.type === "error_inquiry" && classification.targetThreadId) {
    const thread = nextState.threads.find(t => t.id === classification.targetThreadId);
    if (thread) {
      thread.status = "in_progress";
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
  // Only use inline reply when we have a concrete anchor message to reply to.
  // Multiple active threads alone is NOT sufficient — it causes reply-to on every message.

  const targetId = classification.targetThreadId || sessionState.activeThreadId;
  const targetThread = sessionState.threads?.find(t => t.id === targetId);

  // Find a concrete anchorMessageId from the target thread
  const anchorMessageId = targetThread?.pendingQuestion?.channelMessageId
    || targetThread?.pendingQuestion?.askedAtMessageId
    || targetThread?.lastError?.channelMessageId
    || targetThread?.lastError?.messageId
    || null;

  // Rules for inline reply (require a concrete anchor):
  // 1. Override / steering — only if we have a message to anchor to
  // 2. Topic switch to a thread with a pending question or error
  // 3. Error inquiry — reply to the error message
  const isOverride = classification.type === 'override';
  const isTargetingNonActive = classification.targetThreadId
    && classification.targetThreadId !== sessionState.activeThreadId;
  const isErrorInquiry = classification.type === 'error_inquiry';

  if (anchorMessageId && (isOverride || isTargetingNonActive || isErrorInquiry)) {
    return { useInlineReply: true, anchorMessageId };
  }

  return { useInlineReply: false };
}
