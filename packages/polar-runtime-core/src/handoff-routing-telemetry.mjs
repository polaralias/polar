import {
  booleanField,
  ContractValidationError,
  RuntimeExecutionError,
  createStrictObjectSchema,
  enumField,
  numberField,
} from "../../polar-domain/src/index.mjs";

const listTelemetryRequestSchema = createStrictObjectSchema({
  schemaId: "handoff.routing.telemetry.list.request",
  fields: {
    fromSequence: numberField({ min: 1, required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
    mode: enumField(["direct", "delegate", "fanout-fanin"], {
      required: false,
    }),
    routeAdjustedOnly: booleanField({ required: false }),
    profileResolutionStatus: enumField(["resolved", "not_resolved"], {
      required: false,
    }),
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
 * @param {unknown} request
 * @returns {Record<string, unknown>}
 */
function validateListRequest(request) {
  const validation = listTelemetryRequestSchema.validate(request);
  if (!validation.ok) {
    throw new ContractValidationError("Invalid handoff routing telemetry list request", {
      schemaId: listTelemetryRequestSchema.schemaId,
      errors: validation.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {unknown} value
 * @returns {readonly string[]}
 */
function toAdjustmentReasons(value) {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }

  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item === "string" && item.length > 0) {
      normalized.push(item);
    }
  }

  return Object.freeze(normalized);
}

/**
 * @param {Record<string, unknown>} context
 * @param {number} sequence
 * @param {() => number} now
 * @returns {Record<string, unknown>|undefined}
 */
function toTelemetryEvent(context, sequence, now) {
  const diagnostics = isPlainObject(context.input?.routingDiagnostics)
    ? context.input.routingDiagnostics
    : undefined;
  if (!diagnostics) {
    return undefined;
  }

  const profileResolution = isPlainObject(diagnostics.profileResolution)
    ? diagnostics.profileResolution
    : undefined;
  const resolvedMode =
    typeof diagnostics.resolvedMode === "string"
      ? diagnostics.resolvedMode
      : context.input.mode;
  const requestedMode =
    typeof diagnostics.requestedMode === "string"
      ? diagnostics.requestedMode
      : resolvedMode;
  const requestedTargetCount =
    typeof diagnostics.requestedTargetCount === "number" &&
    Number.isInteger(diagnostics.requestedTargetCount) &&
    diagnostics.requestedTargetCount >= 0
      ? diagnostics.requestedTargetCount
      : 0;
  const resolvedTargetCount =
    typeof diagnostics.resolvedTargetCount === "number" &&
    Number.isInteger(diagnostics.resolvedTargetCount) &&
    diagnostics.resolvedTargetCount >= 0
      ? diagnostics.resolvedTargetCount
      : 0;

  const event = {
    sequence,
    timestamp: new Date(now()).toISOString(),
    traceId: context.traceId,
    actionId: context.actionId,
    version: context.version,
    sourceAgentId: context.input.sourceAgentId,
    targetAgentIds: context.input.targetAgentIds ?? [],
    status:
      context.output && typeof context.output.status === "string"
        ? context.output.status
        : context.error
          ? "failed"
          : "unknown",
    requestedMode,
    resolvedMode,
    requestedTargetCount,
    resolvedTargetCount,
    routeAdjusted: diagnostics.routeAdjusted === true,
    adjustmentReasons: toAdjustmentReasons(diagnostics.adjustmentReasons),
    profileResolutionStatus:
      profileResolution &&
      (profileResolution.status === "resolved" ||
        profileResolution.status === "not_resolved")
        ? profileResolution.status
        : "not_resolved",
  };

  if (typeof context.input.targetAgentId === "string") {
    event.targetAgentId = context.input.targetAgentId;
  }

  const profileId =
    profileResolution && typeof profileResolution.profileId === "string"
      ? profileResolution.profileId
      : context.input.profileId;
  if (typeof profileId === "string") {
    event.profileId = profileId;
  }

  const profileResolvedScope =
    profileResolution && typeof profileResolution.resolvedScope === "string"
      ? profileResolution.resolvedScope
      : context.input.resolvedProfileScope;
  if (typeof profileResolvedScope === "string") {
    event.profileResolvedScope = profileResolvedScope;
  }

  if (typeof context.error?.code === "string") {
    event.errorCode = context.error.code;
  }

  return Object.freeze(event);
}

/**
 * @param {readonly Record<string, unknown>[]} events
 * @param {Record<string, unknown>} request
 * @returns {readonly Record<string, unknown>[]}
 */
function filterEvents(events, request) {
  const mode = /** @type {"direct"|"delegate"|"fanout-fanin"|undefined} */ (
    request.mode
  );
  const routeAdjustedOnly = request.routeAdjustedOnly === true;
  const profileResolutionStatus = /** @type {"resolved"|"not_resolved"|undefined} */ (
    request.profileResolutionStatus
  );

  return events.filter((event) => {
    if (mode !== undefined && event.resolvedMode !== mode) {
      return false;
    }

    if (routeAdjustedOnly && event.routeAdjusted !== true) {
      return false;
    }

    if (
      profileResolutionStatus !== undefined &&
      event.profileResolutionStatus !== profileResolutionStatus
    ) {
      return false;
    }

    return true;
  });
}

/**
 * @param {{
 *   maxEntries?: number,
 *   now?: () => number,
 *   telemetrySink?: (event: Record<string, unknown>) => Promise<void>|void
 * }} [config]
 */
export function createHandoffRoutingTelemetryCollector(config = {}) {
  const maxEntries = config.maxEntries ?? 1_000;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RuntimeExecutionError("maxEntries must be an integer >= 1");
  }

  const now = config.now ?? Date.now;
  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }

  const telemetrySink = config.telemetrySink ?? (() => {});
  if (typeof telemetrySink !== "function") {
    throw new RuntimeExecutionError(
      "telemetrySink must be a function when provided",
    );
  }

  /** @type {Record<string, unknown>[]} */
  const events = [];
  let sequence = 0;

  const middleware = Object.freeze({
    id: "handoff.routing.telemetry.collector",
    appliesTo: Object.freeze(["handoff"]),
    /**
     * @param {Record<string, unknown>} context
     * @returns {Promise<void>}
     */
    async after(context) {
      if (
        context.actionId !== "agent.handoff.execute" ||
        context.version !== 1
      ) {
        return;
      }

      const event = toTelemetryEvent(context, sequence + 1, now);
      if (!event) {
        return;
      }

      sequence += 1;
      events.push(event);
      if (events.length > maxEntries) {
        events.splice(0, events.length - maxEntries);
      }

      await telemetrySink(event);
    },
  });

  return Object.freeze({
    middleware,

    /**
     * @param {unknown} [request]
     * @returns {Record<string, unknown>}
     */
    listEvents(request = {}) {
      const parsed = validateListRequest(request);
      const fromSequence =
        /** @type {number|undefined} */ (parsed.fromSequence) ?? 1;
      const limit =
        /** @type {number|undefined} */ (parsed.limit) ?? 50;

      const filtered = filterEvents(events, parsed).filter(
        (event) =>
          /** @type {number} */ (event.sequence) >= fromSequence,
      );
      const items = filtered.slice(0, limit);
      const nextFromSequence =
        filtered.length > limit
          ? /** @type {number} */ (items[items.length - 1].sequence) + 1
          : undefined;

      const result = {
        status: "ok",
        fromSequence,
        returnedCount: items.length,
        totalCount: filtered.length,
        items: Object.freeze(items),
      };

      if (nextFromSequence !== undefined) {
        result.nextFromSequence = nextFromSequence;
      }

      return Object.freeze(result);
    },

    clear() {
      events.length = 0;
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listState() {
      return Object.freeze([...events]);
    },
  });
}
