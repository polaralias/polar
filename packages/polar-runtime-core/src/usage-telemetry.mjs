import {
  ContractValidationError,
  RuntimeExecutionError,
  USAGE_TELEMETRY_EVENT_STATUSES,
  USAGE_TELEMETRY_MODEL_LANES,
  USAGE_TELEMETRY_OPERATIONS,
  booleanField,
  createStrictObjectSchema,
  enumField,
  numberField,
  stringArrayField,
  stringField,
} from "@polar/domain";

const providerActionIds = Object.freeze([
  "provider.generate",
  "provider.stream",
  "provider.embed",
]);

const recordOperationSchema = createStrictObjectSchema({
  schemaId: "usage.telemetry.record.input",
  fields: {
    traceId: stringField({ minLength: 1 }),
    actionId: enumField(providerActionIds),
    operation: enumField(USAGE_TELEMETRY_OPERATIONS),
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"]),
    requestedProviderId: stringField({ minLength: 1 }),
    providerId: stringField({ minLength: 1 }),
    attemptedProviderIds: stringArrayField({ minItems: 1, itemMinLength: 1 }),
    fallbackProviderIds: stringArrayField({
      minItems: 1,
      itemMinLength: 1,
      required: false,
    }),
    fallbackUsed: booleanField(),
    status: enumField(USAGE_TELEMETRY_EVENT_STATUSES),
    durationMs: numberField({ min: 0 }),
    model: stringField({ minLength: 1 }),
    modelLane: enumField(USAGE_TELEMETRY_MODEL_LANES, { required: false }),
    estimatedCostUsd: numberField({ min: 0, required: false }),
    errorCode: stringField({ minLength: 1, required: false }),
  },
});

const listRequestSchema = createStrictObjectSchema({
  schemaId: "usage.telemetry.list.request",
  fields: {
    fromSequence: numberField({ min: 1, required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
    operation: enumField(USAGE_TELEMETRY_OPERATIONS, { required: false }),
    providerId: stringField({ minLength: 1, required: false }),
    requestedProviderId: stringField({ minLength: 1, required: false }),
    status: enumField(USAGE_TELEMETRY_EVENT_STATUSES, { required: false }),
    modelLane: enumField(USAGE_TELEMETRY_MODEL_LANES, { required: false }),
    fallbackUsed: booleanField({ required: false }),
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
  },
});

/**
 * @param {unknown} request
 * @returns {Record<string, unknown>}
 */
function validateListRequest(request) {
  const validation = listRequestSchema.validate(request);
  if (!validation.ok) {
    throw new ContractValidationError("Invalid usage telemetry list request", {
      schemaId: listRequestSchema.schemaId,
      errors: validation.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function validateOperationRecord(value) {
  const validation = recordOperationSchema.validate(value);
  if (!validation.ok) {
    throw new ContractValidationError("Invalid usage telemetry record input", {
      schemaId: recordOperationSchema.schemaId,
      errors: validation.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {readonly Record<string, unknown>[]} events
 * @returns {number}
 */
function sumEstimatedCost(events) {
  return events.reduce((total, event) => {
    const estimated = /** @type {number|undefined} */ (event.estimatedCostUsd);
    return total + (estimated ?? 0);
  }, 0);
}

/**
 * @param {readonly Record<string, unknown>[]} events
 * @returns {Record<string, unknown>}
 */
function buildSummary(events) {
  const completedCount = events.filter((event) => event.status === "completed").length;
  const failedCount = events.filter((event) => event.status === "failed").length;
  const fallbackCount = events.filter((event) => event.fallbackUsed === true).length;
  const totalDurationMs = events.reduce(
    (total, event) => total + /** @type {number} */ (event.durationMs),
    0,
  );
  const totalEstimatedCostUsd = sumEstimatedCost(events);

  const byOperation = [];
  for (const operation of USAGE_TELEMETRY_OPERATIONS) {
    const operationEvents = events.filter((event) => event.operation === operation);
    if (operationEvents.length === 0) {
      continue;
    }

    byOperation.push(
      Object.freeze({
        operation,
        totalCount: operationEvents.length,
        failedCount: operationEvents.filter((event) => event.status === "failed").length,
        fallbackCount: operationEvents.filter((event) => event.fallbackUsed === true).length,
        totalEstimatedCostUsd: sumEstimatedCost(operationEvents),
      }),
    );
  }

  /** @type {Map<string, { totalCount: number, failedCount: number, fallbackCount: number, totalEstimatedCostUsd: number }>} */
  const providerCounts = new Map();
  for (const event of events) {
    const providerId = /** @type {string} */ (event.providerId);
    const entry = providerCounts.get(providerId) ?? {
      totalCount: 0,
      failedCount: 0,
      fallbackCount: 0,
      totalEstimatedCostUsd: 0,
    };

    entry.totalCount += 1;
    if (event.status === "failed") {
      entry.failedCount += 1;
    }
    if (event.fallbackUsed === true) {
      entry.fallbackCount += 1;
    }
    entry.totalEstimatedCostUsd +=
      (/** @type {number|undefined} */ (event.estimatedCostUsd) ?? 0);

    providerCounts.set(providerId, entry);
  }

  const byProvider = [...providerCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([providerId, entry]) =>
      Object.freeze({
        providerId,
        totalCount: entry.totalCount,
        failedCount: entry.failedCount,
        fallbackCount: entry.fallbackCount,
        totalEstimatedCostUsd: entry.totalEstimatedCostUsd,
      }),
    );

  const byModelLane = [];
  for (const modelLane of USAGE_TELEMETRY_MODEL_LANES) {
    const modelLaneEvents = events.filter((event) => event.modelLane === modelLane);
    if (modelLaneEvents.length === 0) {
      continue;
    }

    byModelLane.push(
      Object.freeze({
        modelLane,
        totalCount: modelLaneEvents.length,
        totalEstimatedCostUsd: sumEstimatedCost(modelLaneEvents),
      }),
    );
  }

  return Object.freeze({
    totalOperations: events.length,
    completedCount,
    failedCount,
    fallbackCount,
    totalDurationMs,
    totalEstimatedCostUsd,
    byOperation: Object.freeze(byOperation),
    byProvider: Object.freeze(byProvider),
    byModelLane: Object.freeze(byModelLane),
  });
}

/**
 * @param {readonly Record<string, unknown>[]} events
 * @param {Record<string, unknown>} request
 * @returns {readonly Record<string, unknown>[]}
 */
function filterEvents(events, request) {
  const operation = /** @type {"generate"|"stream"|"embed"|undefined} */ (
    request.operation
  );
  const providerId = /** @type {string|undefined} */ (request.providerId);
  const requestedProviderId = /** @type {string|undefined} */ (
    request.requestedProviderId
  );
  const status = /** @type {"completed"|"failed"|undefined} */ (request.status);
  const modelLane = /** @type {"local"|"worker"|"brain"|undefined} */ (
    request.modelLane
  );
  const fallbackUsed = /** @type {boolean|undefined} */ (request.fallbackUsed);
  const executionType = /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
    request.executionType
  );

  return events.filter((event) => {
    if (operation !== undefined && event.operation !== operation) {
      return false;
    }
    if (providerId !== undefined && event.providerId !== providerId) {
      return false;
    }
    if (
      requestedProviderId !== undefined &&
      event.requestedProviderId !== requestedProviderId
    ) {
      return false;
    }
    if (status !== undefined && event.status !== status) {
      return false;
    }
    if (modelLane !== undefined && event.modelLane !== modelLane) {
      return false;
    }
    if (fallbackUsed !== undefined && event.fallbackUsed !== fallbackUsed) {
      return false;
    }
    if (executionType !== undefined && event.executionType !== executionType) {
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
export function createUsageTelemetryCollector(config = {}) {
  const maxEntries = config.maxEntries ?? 5_000;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RuntimeExecutionError("maxEntries must be an integer >= 1");
  }

  const now = config.now ?? Date.now;
  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }

  const telemetrySink = config.telemetrySink ?? (() => { });
  if (typeof telemetrySink !== "function") {
    throw new RuntimeExecutionError(
      "telemetrySink must be a function when provided",
    );
  }

  /** @type {Record<string, unknown>[]} */
  const events = [];
  let sequence = 0;

  return Object.freeze({
    /**
     * @param {unknown} event
     * @returns {Promise<void>}
     */
    async recordOperation(event) {
      const parsed = validateOperationRecord(event);
      const timestampMs = now();

      const normalized = Object.freeze({
        sequence: sequence + 1,
        timestamp: new Date(timestampMs).toISOString(),
        timestampMs,
        ...parsed,
      });

      sequence += 1;
      events.push(normalized);
      if (events.length > maxEntries) {
        events.splice(0, events.length - maxEntries);
      }

      try {
        await telemetrySink(normalized);
      } catch (error) {
        throw new RuntimeExecutionError("Usage telemetry sink rejected event", {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    },

    /**
     * @param {unknown} [request]
     * @returns {Record<string, unknown>}
     */
    listEvents(request = {}) {
      const parsed = validateListRequest(request);
      const fromSequence = /** @type {number|undefined} */ (parsed.fromSequence) ?? 1;
      const limit = /** @type {number|undefined} */ (parsed.limit) ?? 50;

      const filtered = filterEvents(events, parsed).filter(
        (event) => /** @type {number} */(event.sequence) >= fromSequence,
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
        summary: buildSummary(filtered),
      };

      if (nextFromSequence !== undefined) {
        result.nextFromSequence = nextFromSequence;
      }

      return Object.freeze(result);
    },

    clear() {
      events.length = 0;
      sequence = 0;
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listState() {
      return Object.freeze([...events]);
    },
  });
}
