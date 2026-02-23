import {
  ContractValidationError,
  RuntimeExecutionError,
  SCHEDULER_ACTIONS,
  SCHEDULER_EVENT_DISPOSITIONS,
  SCHEDULER_EVENT_QUEUE_ACTIONABLE_TYPES,
  SCHEDULER_EVENT_QUEUE_ACTIONS,
  SCHEDULER_EVENT_PROCESS_STATUSES,
  SCHEDULER_EVENT_QUEUE_TYPES,
  SCHEDULER_EVENT_RUN_STATUSES,
  SCHEDULER_EVENT_SOURCES,
  SCHEDULER_RUN_LINK_REPLAY_SOURCES,
  booleanField,
  createSchedulerContracts,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "../../polar-domain/src/index.mjs";

const processPersistedEventRequestSchema = createStrictObjectSchema({
  schemaId: "scheduler.gateway.event.process.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    eventId: stringField({ minLength: 1 }),
    source: enumField(SCHEDULER_EVENT_SOURCES),
    runId: stringField({ minLength: 1 }),
    recordedAtMs: numberField({ min: 0 }),
    attempt: numberField({ min: 1, required: false }),
    maxAttempts: numberField({ min: 1, required: false }),
    retryBackoffMs: numberField({ min: 0, required: false }),
    deadLetterOnMaxAttempts: booleanField({ required: false }),
    automationRequest: jsonField({ required: false }),
    heartbeatRequest: jsonField({ required: false }),
    metadata: jsonField({ required: false }),
  },
});

const replayRunLinksRequestSchema = createStrictObjectSchema({
  schemaId: "scheduler.gateway.run-link.replay.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    source: enumField(SCHEDULER_RUN_LINK_REPLAY_SOURCES, { required: false }),
    fromSequence: numberField({ min: 0, required: false }),
  },
});

const listEventQueueRequestSchema = createStrictObjectSchema({
  schemaId: "scheduler.gateway.event-queue.list.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    queue: enumField(SCHEDULER_EVENT_QUEUE_TYPES, { required: false }),
    source: enumField(SCHEDULER_EVENT_SOURCES, { required: false }),
    eventId: stringField({ minLength: 1, required: false }),
    runId: stringField({ minLength: 1, required: false }),
    status: enumField(SCHEDULER_EVENT_PROCESS_STATUSES, { required: false }),
    runStatus: enumField(SCHEDULER_EVENT_RUN_STATUSES, { required: false }),
    disposition: enumField(SCHEDULER_EVENT_DISPOSITIONS, { required: false }),
    fromSequence: numberField({ min: 0, required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
  },
});

const runQueueActionRequestSchema = createStrictObjectSchema({
  schemaId: "scheduler.gateway.event-queue.run-action.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    queue: enumField(SCHEDULER_EVENT_QUEUE_ACTIONABLE_TYPES),
    action: enumField(SCHEDULER_EVENT_QUEUE_ACTIONS),
    eventId: stringField({ minLength: 1 }),
    sequence: numberField({ min: 0, required: false }),
    retryAtMs: numberField({ min: 0, required: false }),
    reason: stringField({ minLength: 1, required: false }),
  },
});

const processableRunStatuses = new Set(SCHEDULER_EVENT_RUN_STATUSES);
const processableEventStatuses = new Set(SCHEDULER_EVENT_PROCESS_STATUSES);
const dispositionStatuses = new Set(SCHEDULER_EVENT_DISPOSITIONS);
const queueActionSupport = Object.freeze({
  retry: Object.freeze(["dismiss", "retry_now"]),
  dead_letter: Object.freeze(["dismiss", "requeue"]),
});

/**
 * @param {unknown} value
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function validateRequest(value, schemaId) {
  const schema = {
    [processPersistedEventRequestSchema.schemaId]:
      processPersistedEventRequestSchema,
    [replayRunLinksRequestSchema.schemaId]: replayRunLinksRequestSchema,
    [listEventQueueRequestSchema.schemaId]: listEventQueueRequestSchema,
    [runQueueActionRequestSchema.schemaId]: runQueueActionRequestSchema,
  }[schemaId];

  const validation = schema.validate(value);
  if (!validation.ok) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: validation.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

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
 * @returns {value is number}
 */
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean|undefined}
 */
function parseOptionalBoolean(value) {
  if (typeof value !== "boolean") {
    return undefined;
  }

  return value;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isNonNegativeInteger(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0;
}

/**
 * @param {Map<string, number>} counts
 * @param {string} idField
 * @returns {readonly Record<string, unknown>[]}
 */
function toCountRows(counts, idField) {
  return Object.freeze(
    [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, count]) =>
        Object.freeze({
          [idField]: id,
          count,
        }),
      ),
  );
}

/**
 * @param {"processed"|"retry"|"dead_letter"} queue
 * @param {Record<string, unknown>} event
 * @param {number} index
 * @returns {Record<string, unknown>}
 */
function normalizeQueueEvent(queue, event, index) {
  if (!isPlainObject(event)) {
    throw new RuntimeExecutionError(
      `Scheduler queue "${queue}" event at index ${index} must be an object`,
    );
  }

  if (!isNonEmptyString(event.eventId)) {
    throw new RuntimeExecutionError(
      `Scheduler queue "${queue}" event at index ${index} is missing eventId`,
    );
  }

  if (!SCHEDULER_EVENT_SOURCES.includes(event.source)) {
    throw new RuntimeExecutionError(
      `Scheduler queue "${queue}" event at index ${index} has invalid source`,
    );
  }

  if (!isNonEmptyString(event.runId)) {
    throw new RuntimeExecutionError(
      `Scheduler queue "${queue}" event at index ${index} is missing runId`,
    );
  }

  if (!isNonNegativeInteger(event.sequence)) {
    throw new RuntimeExecutionError(
      `Scheduler queue "${queue}" event at index ${index} must include sequence`,
    );
  }

  if (queue === "processed") {
    if (!processableEventStatuses.has(event.status)) {
      throw new RuntimeExecutionError(
        `Scheduler queue "${queue}" event at index ${index} has invalid status`,
      );
    }
  }

  if (queue === "retry") {
    if (!isPositiveInteger(event.attempt) || !isPositiveInteger(event.maxAttempts)) {
      throw new RuntimeExecutionError(
        `Scheduler queue "${queue}" event at index ${index} requires attempt and maxAttempts`,
      );
    }
    if (!isNonNegativeInteger(event.retryAtMs)) {
      throw new RuntimeExecutionError(
        `Scheduler queue "${queue}" event at index ${index} requires retryAtMs`,
      );
    }
    if (!isNonEmptyString(event.reason)) {
      throw new RuntimeExecutionError(
        `Scheduler queue "${queue}" event at index ${index} requires reason`,
      );
    }
    if (
      event.requestPayload !== undefined &&
      !isPlainObject(event.requestPayload)
    ) {
      throw new RuntimeExecutionError(
        `Scheduler queue "${queue}" event at index ${index} has invalid requestPayload`,
      );
    }
  }

  if (queue === "dead_letter") {
    if (!isPositiveInteger(event.attempt) || !isPositiveInteger(event.maxAttempts)) {
      throw new RuntimeExecutionError(
        `Scheduler queue "${queue}" event at index ${index} requires attempt and maxAttempts`,
      );
    }
    if (!isNonEmptyString(event.reason)) {
      throw new RuntimeExecutionError(
        `Scheduler queue "${queue}" event at index ${index} requires reason`,
      );
    }
    if (
      event.requestPayload !== undefined &&
      !isPlainObject(event.requestPayload)
    ) {
      throw new RuntimeExecutionError(
        `Scheduler queue "${queue}" event at index ${index} has invalid requestPayload`,
      );
    }
  }

  return Object.freeze({ ...event });
}

/**
 * @param {"processed"|"retry"|"dead_letter"} queue
 * @param {unknown} events
 * @returns {readonly Record<string, unknown>[]}
 */
function normalizeQueueEvents(queue, events) {
  if (!Array.isArray(events)) {
    throw new RuntimeExecutionError(`Scheduler queue "${queue}" state must be an array`);
  }

  return Object.freeze(
    events
      .map((event, index) => normalizeQueueEvent(queue, event, index))
      .sort(
        (left, right) =>
          /** @type {number} */ (left.sequence) -
          /** @type {number} */ (right.sequence),
      ),
  );
}

/**
 * @param {"processed"|"retry"|"dead_letter"} queue
 * @param {readonly Record<string, unknown>[]} events
 * @returns {Record<string, unknown>}
 */
function buildEventQueueSummary(queue, events) {
  const sourceCounts = new Map();
  const runIds = new Set();

  for (const event of events) {
    const source = /** @type {string} */ (event.source);
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    runIds.add(/** @type {string} */ (event.runId));
  }

  const summary = {
    queue,
    totalCount: events.length,
    uniqueRunCount: runIds.size,
    sourceBreakdown: toCountRows(sourceCounts, "source"),
  };

  if (events.length > 0) {
    const first = events[0];
    const last = events[events.length - 1];
    summary.firstSequence = first.sequence;
    summary.lastSequence = last.sequence;
  }

  if (queue === "processed") {
    const statusCounts = new Map();
    const runStatusCounts = new Map();
    const dispositionCounts = new Map();
    for (const event of events) {
      const status = /** @type {string} */ (event.status);
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

      const runStatus = /** @type {string|undefined} */ (event.runStatus);
      if (runStatus !== undefined) {
        runStatusCounts.set(runStatus, (runStatusCounts.get(runStatus) ?? 0) + 1);
      }

      const disposition =
        /** @type {"none"|"retry_scheduled"|"dead_lettered"|undefined} */ (
          event.disposition
        ) ?? "none";
      dispositionCounts.set(
        disposition,
        (dispositionCounts.get(disposition) ?? 0) + 1,
      );
    }

    summary.statusBreakdown = toCountRows(statusCounts, "status");
    summary.runStatusBreakdown = toCountRows(runStatusCounts, "runStatus");
    summary.dispositionBreakdown = toCountRows(
      dispositionCounts,
      "disposition",
    );
  }

  if (queue === "retry" && events.length > 0) {
    const retryAtValues = events.map((event) => /** @type {number} */ (event.retryAtMs));
    summary.nextRetryAtMs = Math.min(...retryAtValues);
    summary.latestRetryAtMs = Math.max(...retryAtValues);
  }

  if (queue === "dead_letter") {
    const reasonCounts = new Map();
    for (const event of events) {
      const reason = /** @type {string} */ (event.reason);
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    summary.reasonBreakdown = toCountRows(reasonCounts, "reason");
  }

  return Object.freeze(summary);
}

/**
 * @param {"processed"|"retry"|"dead_letter"} queue
 * @param {"processed"|"rejected"|"failed"|undefined} status
 * @param {"executed"|"skipped"|"blocked"|"failed"|undefined} runStatus
 * @param {"none"|"retry_scheduled"|"dead_lettered"|undefined} disposition
 */
function assertQueueFilterCompatibility(queue, status, runStatus, disposition) {
  if (queue === "processed") {
    return;
  }

  if (status !== undefined || runStatus !== undefined || disposition !== undefined) {
    throw new ContractValidationError(
      "Invalid scheduler queue diagnostics filter combination",
      {
        schemaId: listEventQueueRequestSchema.schemaId,
        errors: [
          `${listEventQueueRequestSchema.schemaId}.status, .runStatus, and .disposition are only valid when queue is "processed"`,
        ],
      },
    );
  }
}

/**
 * @param {"retry"|"dead_letter"} queue
 * @param {"dismiss"|"retry_now"|"requeue"} action
 * @returns {boolean}
 */
function isQueueActionSupported(queue, action) {
  return queueActionSupport[queue].includes(action);
}

/**
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
function toFailure(error) {
  return {
    code: "POLAR_RUNTIME_EXECUTION_ERROR",
    message: "Scheduler event processing failed",
    cause: error instanceof Error ? error.message : String(error),
  };
}

/**
 * @param {string} source
 * @returns {"automation"|"heartbeat"}
 */
function toExecutionType(source) {
  return source === "heartbeat" ? "heartbeat" : "automation";
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerSchedulerContracts(contractRegistry) {
  for (const contract of createSchedulerContracts()) {
    if (!contractRegistry.has(contract.actionId, contract.version)) {
      contractRegistry.register(contract);
    }
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   automationGateway?: {
 *     executeRun?: (request: unknown) => Promise<Record<string, unknown>>|Record<string, unknown>
 *   },
 *   heartbeatGateway?: {
 *     tick?: (request: unknown) => Promise<Record<string, unknown>>|Record<string, unknown>
 *   },
 *   runEventLinker?: {
 *     replayRecordedRuns?: (request: unknown) => Promise<Record<string, unknown>>|Record<string, unknown>
 *   },
 *   schedulerStateStore?: {
 *     hasProcessedEvent?: (request: { eventId: string }) => Promise<unknown>|unknown,
 *     storeProcessedEvent?: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     storeRetryEvent?: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     storeDeadLetterEvent?: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     listProcessedEvents?: () => Promise<unknown>|unknown,
 *     listRetryEvents?: () => Promise<unknown>|unknown,
 *     listDeadLetterEvents?: () => Promise<unknown>|unknown,
 *     removeRetryEvent?: (request: { eventId: string, sequence?: number }) => Promise<unknown>|unknown,
 *     removeDeadLetterEvent?: (request: { eventId: string, sequence?: number }) => Promise<unknown>|unknown
 *   },
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat",
 *   now?: () => number
 * }} config
 */
export function createSchedulerGateway({
  middlewarePipeline,
  automationGateway = {},
  heartbeatGateway = {},
  runEventLinker = {},
  schedulerStateStore = {},
  defaultExecutionType = "automation",
  now = () => Date.now(),
}) {
  if (typeof automationGateway !== "object" || automationGateway === null) {
    throw new RuntimeExecutionError(
      "automationGateway must be an object when provided",
    );
  }

  if (
    automationGateway.executeRun !== undefined &&
    typeof automationGateway.executeRun !== "function"
  ) {
    throw new RuntimeExecutionError(
      "automationGateway.executeRun must be a function when provided",
    );
  }

  if (typeof heartbeatGateway !== "object" || heartbeatGateway === null) {
    throw new RuntimeExecutionError(
      "heartbeatGateway must be an object when provided",
    );
  }

  if (
    heartbeatGateway.tick !== undefined &&
    typeof heartbeatGateway.tick !== "function"
  ) {
    throw new RuntimeExecutionError(
      "heartbeatGateway.tick must be a function when provided",
    );
  }

  if (typeof runEventLinker !== "object" || runEventLinker === null) {
    throw new RuntimeExecutionError(
      "runEventLinker must be an object when provided",
    );
  }

  if (
    runEventLinker.replayRecordedRuns !== undefined &&
    typeof runEventLinker.replayRecordedRuns !== "function"
  ) {
    throw new RuntimeExecutionError(
      "runEventLinker.replayRecordedRuns must be a function when provided",
    );
  }

  if (typeof schedulerStateStore !== "object" || schedulerStateStore === null) {
    throw new RuntimeExecutionError(
      "schedulerStateStore must be an object when provided",
    );
  }

  if (
    schedulerStateStore.hasProcessedEvent !== undefined &&
    typeof schedulerStateStore.hasProcessedEvent !== "function"
  ) {
    throw new RuntimeExecutionError(
      "schedulerStateStore.hasProcessedEvent must be a function when provided",
    );
  }

  if (
    schedulerStateStore.storeProcessedEvent !== undefined &&
    typeof schedulerStateStore.storeProcessedEvent !== "function"
  ) {
    throw new RuntimeExecutionError(
      "schedulerStateStore.storeProcessedEvent must be a function when provided",
    );
  }

  if (
    schedulerStateStore.storeRetryEvent !== undefined &&
    typeof schedulerStateStore.storeRetryEvent !== "function"
  ) {
    throw new RuntimeExecutionError(
      "schedulerStateStore.storeRetryEvent must be a function when provided",
    );
  }

  if (
    schedulerStateStore.storeDeadLetterEvent !== undefined &&
    typeof schedulerStateStore.storeDeadLetterEvent !== "function"
  ) {
    throw new RuntimeExecutionError(
      "schedulerStateStore.storeDeadLetterEvent must be a function when provided",
    );
  }

  if (
    schedulerStateStore.listProcessedEvents !== undefined &&
    typeof schedulerStateStore.listProcessedEvents !== "function"
  ) {
    throw new RuntimeExecutionError(
      "schedulerStateStore.listProcessedEvents must be a function when provided",
    );
  }

  if (
    schedulerStateStore.listRetryEvents !== undefined &&
    typeof schedulerStateStore.listRetryEvents !== "function"
  ) {
    throw new RuntimeExecutionError(
      "schedulerStateStore.listRetryEvents must be a function when provided",
    );
  }

  if (
    schedulerStateStore.listDeadLetterEvents !== undefined &&
    typeof schedulerStateStore.listDeadLetterEvents !== "function"
  ) {
    throw new RuntimeExecutionError(
      "schedulerStateStore.listDeadLetterEvents must be a function when provided",
    );
  }

  if (
    schedulerStateStore.removeRetryEvent !== undefined &&
    typeof schedulerStateStore.removeRetryEvent !== "function"
  ) {
    throw new RuntimeExecutionError(
      "schedulerStateStore.removeRetryEvent must be a function when provided",
    );
  }

  if (
    schedulerStateStore.removeDeadLetterEvent !== undefined &&
    typeof schedulerStateStore.removeDeadLetterEvent !== "function"
  ) {
    throw new RuntimeExecutionError(
      "schedulerStateStore.removeDeadLetterEvent must be a function when provided",
    );
  }

  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }

  /** @type {Record<string, unknown>[]} */
  const processedEventLedger = [];
  /** @type {Set<string>} */
  const processedEventIds = new Set();
  /** @type {Record<string, unknown>[]} */
  const retryEventLedger = [];
  /** @type {Record<string, unknown>[]} */
  const deadLetterEventLedger = [];

  /**
   * @param {{
   *   status: "processed"|"rejected"|"failed",
   *   eventId: string,
   *   source: "automation"|"heartbeat",
   *   runId: string,
   *   attempt?: number,
   *   maxAttempts?: number,
   *   runStatus?: "executed"|"skipped"|"blocked"|"failed",
   *   disposition?: "none"|"retry_scheduled"|"dead_lettered",
   *   retryAtMs?: number,
   *   nextAttempt?: number,
   *   deadLetterReason?: string,
   *   output?: unknown,
   *   rejectionCode?: string,
   *   reason?: string,
   *   failure?: unknown,
   *   recordedAtMs: number,
   *   metadata?: unknown
   * }} entry
   * @returns {Record<string, unknown>}
   */
  const appendProcessedEvent = (entry) => {
    const sequence = processedEventLedger.length;
    const ledgerEntry = Object.freeze({
      status: entry.status,
      eventId: entry.eventId,
      source: entry.source,
      runId: entry.runId,
      sequence,
      ...(entry.attempt !== undefined ? { attempt: entry.attempt } : {}),
      ...(entry.maxAttempts !== undefined ? { maxAttempts: entry.maxAttempts } : {}),
      ...(entry.runStatus !== undefined ? { runStatus: entry.runStatus } : {}),
      ...(entry.disposition !== undefined
        ? { disposition: entry.disposition }
        : {}),
      ...(entry.retryAtMs !== undefined ? { retryAtMs: entry.retryAtMs } : {}),
      ...(entry.nextAttempt !== undefined ? { nextAttempt: entry.nextAttempt } : {}),
      ...(entry.deadLetterReason !== undefined
        ? { deadLetterReason: entry.deadLetterReason }
        : {}),
      ...(entry.output !== undefined ? { output: entry.output } : {}),
      ...(entry.rejectionCode !== undefined
        ? { rejectionCode: entry.rejectionCode }
        : {}),
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      ...(entry.failure !== undefined ? { failure: entry.failure } : {}),
      recordedAtMs: entry.recordedAtMs,
      ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
    });
    processedEventLedger.push(ledgerEntry);

    return {
      status: ledgerEntry.status,
      eventId: ledgerEntry.eventId,
      source: ledgerEntry.source,
      runId: ledgerEntry.runId,
      sequence: ledgerEntry.sequence,
      ...(ledgerEntry.attempt !== undefined ? { attempt: ledgerEntry.attempt } : {}),
      ...(ledgerEntry.maxAttempts !== undefined
        ? { maxAttempts: ledgerEntry.maxAttempts }
        : {}),
      ...(ledgerEntry.runStatus !== undefined
        ? { runStatus: ledgerEntry.runStatus }
        : {}),
      ...(ledgerEntry.disposition !== undefined
        ? { disposition: ledgerEntry.disposition }
        : {}),
      ...(ledgerEntry.retryAtMs !== undefined
        ? { retryAtMs: ledgerEntry.retryAtMs }
        : {}),
      ...(ledgerEntry.nextAttempt !== undefined
        ? { nextAttempt: ledgerEntry.nextAttempt }
        : {}),
      ...(ledgerEntry.deadLetterReason !== undefined
        ? { deadLetterReason: ledgerEntry.deadLetterReason }
        : {}),
      ...(ledgerEntry.output !== undefined ? { output: ledgerEntry.output } : {}),
      ...(ledgerEntry.rejectionCode !== undefined
        ? { rejectionCode: ledgerEntry.rejectionCode }
        : {}),
      ...(ledgerEntry.reason !== undefined ? { reason: ledgerEntry.reason } : {}),
      ...(ledgerEntry.failure !== undefined ? { failure: ledgerEntry.failure } : {}),
    };
  };

  /**
   * @param {{
   *   eventId: string,
   *   source: "automation"|"heartbeat",
   *   runId: string,
   *   attempt: number,
   *   maxAttempts: number,
   *   retryAtMs: number,
   *   reason: string,
   *   requestPayload: Record<string, unknown>,
   *   metadata?: unknown
   * }} entry
   * @returns {Record<string, unknown>}
   */
  const appendRetryEvent = (entry) => {
    const sequence = retryEventLedger.length;
    const ledgerEntry = Object.freeze({
      sequence,
      eventId: entry.eventId,
      source: entry.source,
      runId: entry.runId,
      attempt: entry.attempt,
      maxAttempts: entry.maxAttempts,
      retryAtMs: entry.retryAtMs,
      reason: entry.reason,
      requestPayload: entry.requestPayload,
      ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
    });
    retryEventLedger.push(ledgerEntry);

    return {
      sequence: ledgerEntry.sequence,
      eventId: ledgerEntry.eventId,
      source: ledgerEntry.source,
      runId: ledgerEntry.runId,
      attempt: ledgerEntry.attempt,
      maxAttempts: ledgerEntry.maxAttempts,
      retryAtMs: ledgerEntry.retryAtMs,
      reason: ledgerEntry.reason,
    };
  };

  /**
   * @param {{
   *   eventId: string,
   *   source: "automation"|"heartbeat",
   *   runId: string,
 *   attempt: number,
 *   maxAttempts: number,
 *   reason: string,
 *   requestPayload?: Record<string, unknown>,
 *   output?: unknown,
 *   failure?: unknown,
 *   metadata?: unknown
 * }} entry
   * @returns {Record<string, unknown>}
   */
  const appendDeadLetterEvent = (entry) => {
    const sequence = deadLetterEventLedger.length;
    const ledgerEntry = Object.freeze({
      sequence,
      eventId: entry.eventId,
      source: entry.source,
      runId: entry.runId,
      attempt: entry.attempt,
      maxAttempts: entry.maxAttempts,
      reason: entry.reason,
      ...(entry.requestPayload !== undefined
        ? { requestPayload: entry.requestPayload }
        : {}),
      ...(entry.output !== undefined ? { output: entry.output } : {}),
      ...(entry.failure !== undefined ? { failure: entry.failure } : {}),
      ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
    });
    deadLetterEventLedger.push(ledgerEntry);

    return {
      sequence: ledgerEntry.sequence,
      eventId: ledgerEntry.eventId,
      source: ledgerEntry.source,
      runId: ledgerEntry.runId,
      attempt: ledgerEntry.attempt,
      maxAttempts: ledgerEntry.maxAttempts,
      reason: ledgerEntry.reason,
      ...(ledgerEntry.requestPayload !== undefined
        ? { requestPayload: ledgerEntry.requestPayload }
        : {}),
    };
  };

  /**
   * @param {string} eventId
   * @returns {Promise<boolean>}
   */
  const hasPersistedProcessedEvent = async (eventId) => {
    if (!schedulerStateStore.hasProcessedEvent) {
      return false;
    }

    const result = await schedulerStateStore.hasProcessedEvent({ eventId });
    return result === true;
  };

  /**
   * @param {Record<string, unknown>} event
   * @returns {Promise<void>}
   */
  const persistProcessedEvent = async (event) => {
    if (!schedulerStateStore.storeProcessedEvent) {
      return;
    }

    await schedulerStateStore.storeProcessedEvent(event);
  };

  /**
   * @param {Record<string, unknown>} event
   * @returns {Promise<void>}
   */
  const persistRetryEvent = async (event) => {
    if (!schedulerStateStore.storeRetryEvent) {
      return;
    }

    await schedulerStateStore.storeRetryEvent(event);
  };

  /**
   * @param {Record<string, unknown>} event
   * @returns {Promise<void>}
   */
  const persistDeadLetterEvent = async (event) => {
    if (!schedulerStateStore.storeDeadLetterEvent) {
      return;
    }

    await schedulerStateStore.storeDeadLetterEvent(event);
  };

  /**
   * @param {"retry"|"dead_letter"} queue
   * @param {string} eventId
   * @param {number|undefined} sequence
   * @returns {Promise<boolean|undefined>}
   */
  const removePersistedQueueEvent = async (queue, eventId, sequence) => {
    if (queue === "retry") {
      if (schedulerStateStore.listRetryEvents && !schedulerStateStore.removeRetryEvent) {
        throw new RuntimeExecutionError(
          "schedulerStateStore.removeRetryEvent is required when listRetryEvents is configured",
        );
      }
      if (!schedulerStateStore.removeRetryEvent) {
        return undefined;
      }

      const removed = await schedulerStateStore.removeRetryEvent({
        eventId,
        ...(sequence !== undefined ? { sequence } : {}),
      });
      return removed === true;
    }

    if (
      schedulerStateStore.listDeadLetterEvents &&
      !schedulerStateStore.removeDeadLetterEvent
    ) {
      throw new RuntimeExecutionError(
        "schedulerStateStore.removeDeadLetterEvent is required when listDeadLetterEvents is configured",
      );
    }
    if (!schedulerStateStore.removeDeadLetterEvent) {
      return undefined;
    }

    const removed = await schedulerStateStore.removeDeadLetterEvent({
      eventId,
      ...(sequence !== undefined ? { sequence } : {}),
    });
    return removed === true;
  };

  /**
   * @param {"processed"|"retry"|"dead_letter"} queue
   * @returns {Promise<readonly Record<string, unknown>[]>}
   */
  const getQueueEvents = async (queue) => {
    if (queue === "processed") {
      if (schedulerStateStore.listProcessedEvents) {
        return normalizeQueueEvents(
          queue,
          await schedulerStateStore.listProcessedEvents(),
        );
      }
      return normalizeQueueEvents(queue, processedEventLedger);
    }

    if (queue === "retry") {
      if (schedulerStateStore.listRetryEvents) {
        return normalizeQueueEvents(queue, await schedulerStateStore.listRetryEvents());
      }
      return normalizeQueueEvents(queue, retryEventLedger);
    }

    if (schedulerStateStore.listDeadLetterEvents) {
      return normalizeQueueEvents(
        queue,
        await schedulerStateStore.listDeadLetterEvents(),
      );
    }
    return normalizeQueueEvents(queue, deadLetterEventLedger);
  };

  /**
   * @param {"retry"|"dead_letter"} queue
   * @param {string} eventId
   * @param {number|undefined} sequence
   * @returns {Record<string, unknown>|undefined}
   */
  const removeQueueEventFromLedger = (queue, eventId, sequence) => {
    const ledger = queue === "retry" ? retryEventLedger : deadLetterEventLedger;
    const index = ledger.findIndex(
      (event) =>
        event.eventId === eventId &&
        (sequence === undefined || event.sequence === sequence),
    );
    if (index < 0) {
      return undefined;
    }

    const [removed] = ledger.splice(index, 1);
    return removed;
  };

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async processPersistedEvent(request) {
      const parsed = validateRequest(
        request,
        processPersistedEventRequestSchema.schemaId,
      );

      const source = /** @type {"automation"|"heartbeat"} */ (parsed.source);
      const eventId = /** @type {string} */ (parsed.eventId);
      const runId = /** @type {string} */ (parsed.runId);
      const recordedAtMs = /** @type {number} */ (parsed.recordedAtMs);
      const attempt = /** @type {number|undefined} */ (parsed.attempt) ?? 1;
      const maxAttempts =
        /** @type {number|undefined} */ (parsed.maxAttempts) ?? 1;
      const retryBackoffMs =
        /** @type {number|undefined} */ (parsed.retryBackoffMs) ?? 0;
      const deadLetterOnMaxAttempts =
        /** @type {boolean|undefined} */ (parsed.deadLetterOnMaxAttempts) !== false;
      const metadata = parsed.metadata;

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? toExecutionType(source) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: SCHEDULER_ACTIONS.processPersistedEvent.actionId,
          version: SCHEDULER_ACTIONS.processPersistedEvent.version,
          input: {
            eventId,
            source,
            runId,
            recordedAtMs,
            attempt,
            maxAttempts,
            retryBackoffMs,
            deadLetterOnMaxAttempts,
            ...(parsed.automationRequest !== undefined
              ? { automationRequest: parsed.automationRequest }
              : {}),
            ...(parsed.heartbeatRequest !== undefined
              ? { heartbeatRequest: parsed.heartbeatRequest }
              : {}),
            ...(metadata !== undefined ? { metadata } : {}),
          },
        },
        async (input) => {
          const inputAttempt =
            /** @type {number|undefined} */ (input.attempt) ?? 1;
          const inputMaxAttempts =
            /** @type {number|undefined} */ (input.maxAttempts) ?? 1;
          const inputRetryBackoffMs =
            /** @type {number|undefined} */ (input.retryBackoffMs) ?? 0;
          const inputDeadLetterOnMaxAttempts =
            /** @type {boolean|undefined} */ (input.deadLetterOnMaxAttempts) !==
            false;
          const appendRejected = (rejectionCode, reason, failure) =>
            appendProcessedEvent({
              status: "rejected",
              eventId,
              source,
              runId,
              attempt: inputAttempt,
              maxAttempts: inputMaxAttempts,
              rejectionCode,
              reason,
              ...(failure !== undefined ? { failure } : {}),
              recordedAtMs,
              metadata,
            });

          if (!isPositiveInteger(inputAttempt)) {
            return appendRejected(
              "POLAR_SCHEDULER_EVENT_ATTEMPT_INVALID",
              "Persisted scheduler event attempt must be a positive integer",
            );
          }

          if (!isPositiveInteger(inputMaxAttempts)) {
            return appendRejected(
              "POLAR_SCHEDULER_EVENT_MAX_ATTEMPTS_INVALID",
              "Persisted scheduler event maxAttempts must be a positive integer",
            );
          }

          if (
            !Number.isInteger(inputRetryBackoffMs) ||
            inputRetryBackoffMs < 0
          ) {
            return appendRejected(
              "POLAR_SCHEDULER_EVENT_RETRY_BACKOFF_INVALID",
              "Persisted scheduler event retryBackoffMs must be a non-negative integer",
            );
          }

          if (inputAttempt > inputMaxAttempts) {
            return appendRejected(
              "POLAR_SCHEDULER_EVENT_ATTEMPT_EXCEEDS_MAX",
              "Persisted scheduler event attempt exceeds maxAttempts",
            );
          }

          let persistedProcessed = false;
          try {
            persistedProcessed = await hasPersistedProcessedEvent(eventId);
          } catch (error) {
            return appendProcessedEvent({
              status: "failed",
              eventId,
              source,
              runId,
              attempt: inputAttempt,
              maxAttempts: inputMaxAttempts,
              failure: toFailure(error),
              recordedAtMs,
              metadata,
            });
          }

          if (processedEventIds.has(eventId) || persistedProcessed) {
            return appendRejected(
              "POLAR_SCHEDULER_EVENT_DUPLICATE",
              "Persisted scheduler event is already processed",
            );
          }

          const payload =
            source === "automation" ? input.automationRequest : input.heartbeatRequest;
          const oppositePayload =
            source === "automation" ? input.heartbeatRequest : input.automationRequest;
          const gatewayMethod =
            source === "automation"
              ? automationGateway.executeRun
              : heartbeatGateway.tick;

          if (oppositePayload !== undefined) {
            return appendRejected(
              "POLAR_SCHEDULER_EVENT_PAYLOAD_MISMATCH",
              `Unexpected ${source === "automation" ? "heartbeatRequest" : "automationRequest"} for source "${source}"`,
            );
          }

          if (!isPlainObject(payload)) {
            return appendRejected(
              "POLAR_SCHEDULER_EVENT_PAYLOAD_MISSING",
              `Missing ${source} request payload`,
            );
          }

          if (typeof payload.runId !== "string" || payload.runId !== runId) {
            return appendRejected(
              "POLAR_SCHEDULER_EVENT_RUN_ID_MISMATCH",
              "Persisted scheduler event runId does not match payload runId",
            );
          }

          if (!gatewayMethod) {
            return appendRejected(
              "POLAR_SCHEDULER_GATEWAY_NOT_CONFIGURED",
              `No ${source} gateway handler is configured`,
            );
          }

          const scheduleRetry = async ({ reason, output, failure }) => {
            const retryAtMs =
              Math.max(recordedAtMs, now()) + inputRetryBackoffMs;
            const nextAttempt = inputAttempt + 1;
            const retryEvent = appendRetryEvent({
              eventId,
              source,
              runId,
              attempt: inputAttempt,
              maxAttempts: inputMaxAttempts,
              retryAtMs,
              reason,
              requestPayload: payload,
              metadata,
            });
            await persistRetryEvent({
              ...retryEvent,
              reason,
              requestPayload: payload,
              ...(output !== undefined ? { output } : {}),
              ...(failure !== undefined ? { failure } : {}),
              ...(metadata !== undefined ? { metadata } : {}),
            });

            return {
              disposition: "retry_scheduled",
              retryAtMs,
              nextAttempt,
            };
          };

          const scheduleDeadLetter = async ({ reason, output, failure }) => {
            const deadLetterEvent = appendDeadLetterEvent({
              eventId,
              source,
              runId,
              attempt: inputAttempt,
              maxAttempts: inputMaxAttempts,
              reason,
              requestPayload: payload,
              ...(output !== undefined ? { output } : {}),
              ...(failure !== undefined ? { failure } : {}),
              ...(metadata !== undefined ? { metadata } : {}),
            });
            await persistDeadLetterEvent({
              ...deadLetterEvent,
              reason,
              requestPayload: payload,
              ...(output !== undefined ? { output } : {}),
              ...(failure !== undefined ? { failure } : {}),
              ...(metadata !== undefined ? { metadata } : {}),
            });

            return {
              disposition: "dead_lettered",
              deadLetterReason: reason,
            };
          };

          try {
            const output = await gatewayMethod(payload);
            const outputStatus =
              isPlainObject(output) && typeof output.status === "string"
                ? output.status
                : undefined;
            const runStatus = processableRunStatuses.has(outputStatus)
              ? /** @type {"executed"|"skipped"|"blocked"|"failed"} */ (
                  outputStatus
                )
              : undefined;
            const outputRecord = isPlainObject(output) ? output : undefined;
            const retryEligible =
              parseOptionalBoolean(outputRecord?.retryEligible) ?? false;
            const deadLetterEligible =
              parseOptionalBoolean(outputRecord?.deadLetterEligible) ?? false;

            /** @type {{ disposition: "none"|"retry_scheduled"|"dead_lettered", retryAtMs?: number, nextAttempt?: number, deadLetterReason?: string }} */
            let disposition = {
              disposition: "none",
            };
            if (runStatus === "failed") {
              if (retryEligible === true && inputAttempt < inputMaxAttempts) {
                disposition = await scheduleRetry({
                  reason: "run_failed_retry_eligible",
                  output,
                });
              } else if (
                deadLetterEligible === true ||
                (inputDeadLetterOnMaxAttempts === true &&
                  inputAttempt >= inputMaxAttempts)
              ) {
                disposition = await scheduleDeadLetter({
                  reason:
                    deadLetterEligible === true
                      ? "run_failed_dead_letter_eligible"
                      : "max_attempts_exhausted",
                  output,
                });
              }
            }

            const processedEvent = appendProcessedEvent({
              status: "processed",
              eventId,
              source,
              runId,
              attempt: inputAttempt,
              maxAttempts: inputMaxAttempts,
              ...(runStatus !== undefined ? { runStatus } : {}),
              ...(dispositionStatuses.has(disposition.disposition)
                ? { disposition: disposition.disposition }
                : {}),
              ...(disposition.retryAtMs !== undefined
                ? { retryAtMs: disposition.retryAtMs }
                : {}),
              ...(disposition.nextAttempt !== undefined
                ? { nextAttempt: disposition.nextAttempt }
                : {}),
              ...(disposition.deadLetterReason !== undefined
                ? { deadLetterReason: disposition.deadLetterReason }
                : {}),
              output,
              recordedAtMs,
              metadata,
            });

            processedEventIds.add(eventId);
            await persistProcessedEvent({
              ...processedEvent,
              recordedAtMs,
              retryBackoffMs: inputRetryBackoffMs,
              deadLetterOnMaxAttempts: inputDeadLetterOnMaxAttempts,
              ...(metadata !== undefined ? { metadata } : {}),
            });

            return processedEvent;
          } catch (error) {
            if (error instanceof ContractValidationError) {
              return appendRejected(error.code, error.message, {
                ...(error.details ? { details: error.details } : {}),
              });
            }

            const failure = toFailure(error);
            /** @type {{ disposition: "none"|"retry_scheduled"|"dead_lettered", retryAtMs?: number, nextAttempt?: number, deadLetterReason?: string }} */
            let disposition = {
              disposition: "none",
            };
            if (inputAttempt < inputMaxAttempts) {
              disposition = await scheduleRetry({
                reason: "execution_failed_retry",
                failure,
              });
            } else if (inputDeadLetterOnMaxAttempts === true) {
              disposition = await scheduleDeadLetter({
                reason: "max_attempts_exhausted",
                failure,
              });
            }

            return appendProcessedEvent({
              status: "failed",
              eventId,
              source,
              runId,
              attempt: inputAttempt,
              maxAttempts: inputMaxAttempts,
              ...(dispositionStatuses.has(disposition.disposition)
                ? { disposition: disposition.disposition }
                : {}),
              ...(disposition.retryAtMs !== undefined
                ? { retryAtMs: disposition.retryAtMs }
                : {}),
              ...(disposition.nextAttempt !== undefined
                ? { nextAttempt: disposition.nextAttempt }
                : {}),
              ...(disposition.deadLetterReason !== undefined
                ? { deadLetterReason: disposition.deadLetterReason }
                : {}),
              failure,
              recordedAtMs,
              metadata,
            });
          }
        },
      );
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async replayRunLinks(request = {}) {
      const parsed = validateRequest(request, replayRunLinksRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: SCHEDULER_ACTIONS.replayRunLinks.actionId,
          version: SCHEDULER_ACTIONS.replayRunLinks.version,
          input: {
            ...(parsed.source !== undefined ? { source: parsed.source } : {}),
            ...(parsed.fromSequence !== undefined
              ? { fromSequence: parsed.fromSequence }
              : {}),
          },
        },
        async (input) => {
          if (!runEventLinker.replayRecordedRuns) {
            throw new RuntimeExecutionError(
              "runEventLinker.replayRecordedRuns is required to replay run links",
            );
          }

          const source = /** @type {"automation"|"heartbeat"|"all"|undefined} */ (
            input.source
          ) ?? "all";
          const fromSequence =
            /** @type {number|undefined} */ (input.fromSequence) ?? 0;
          const replayResult = await runEventLinker.replayRecordedRuns({
            source,
            fromSequence,
          });

          return {
            status: "ok",
            source,
            fromSequence,
            automationRecordCount: replayResult.automationRecordCount,
            heartbeatRecordCount: replayResult.heartbeatRecordCount,
            linkedCount: replayResult.linkedCount,
            skippedCount: replayResult.skippedCount,
            rejectedCount: replayResult.rejectedCount,
            totalCount: replayResult.totalCount,
          };
        },
      );
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async runQueueAction(request = {}) {
      const parsed = validateRequest(
        request,
        runQueueActionRequestSchema.schemaId,
      );

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: SCHEDULER_ACTIONS.runQueueAction.actionId,
          version: SCHEDULER_ACTIONS.runQueueAction.version,
          input: {
            queue: parsed.queue,
            action: parsed.action,
            eventId: parsed.eventId,
            ...(parsed.sequence !== undefined ? { sequence: parsed.sequence } : {}),
            ...(parsed.retryAtMs !== undefined
              ? { retryAtMs: parsed.retryAtMs }
              : {}),
            ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
          },
        },
        async (input) => {
          const queue = /** @type {"retry"|"dead_letter"} */ (input.queue);
          const action = /** @type {"dismiss"|"retry_now"|"requeue"} */ (
            input.action
          );
          const eventId = /** @type {string} */ (input.eventId);
          const sequence = /** @type {number|undefined} */ (input.sequence);
          const requestedRetryAtMs =
            /** @type {number|undefined} */ (input.retryAtMs);
          const requestedReason = /** @type {string|undefined} */ (input.reason);

          const rejectQueueAction = (rejectionCode, reason) =>
            Object.freeze({
              status: "rejected",
              queue,
              action,
              eventId,
              rejectionCode,
              reason,
            });

          if (!isQueueActionSupported(queue, action)) {
            return rejectQueueAction(
              "POLAR_SCHEDULER_QUEUE_ACTION_UNSUPPORTED",
              `Scheduler queue action "${action}" is not supported for queue "${queue}"`,
            );
          }

          if (
            requestedRetryAtMs !== undefined &&
            !isNonNegativeInteger(requestedRetryAtMs)
          ) {
            return rejectQueueAction(
              "POLAR_SCHEDULER_QUEUE_ACTION_RETRY_AT_INVALID",
              "Scheduler queue action retryAtMs must be a non-negative integer when provided",
            );
          }

          const queueEvents = await getQueueEvents(queue);
          const matchedEvent = queueEvents.find(
            (event) =>
              event.eventId === eventId &&
              (sequence === undefined || event.sequence === sequence),
          );

          if (!matchedEvent) {
            return {
              status: "not_found",
              queue,
              action,
              eventId,
            };
          }

          const matchedSequence = /** @type {number} */ (matchedEvent.sequence);
          const matchedSource = /** @type {"automation"|"heartbeat"} */ (
            matchedEvent.source
          );
          const matchedRunId = /** @type {string} */ (matchedEvent.runId);
          const matchedAttempt = isPositiveInteger(matchedEvent.attempt)
            ? matchedEvent.attempt
            : 1;
          const matchedMaxAttempts = isPositiveInteger(matchedEvent.maxAttempts)
            ? matchedEvent.maxAttempts
            : matchedAttempt;
          const actionAppliedAtMs = now();

          if (action === "dismiss") {
            const persistedRemoved = await removePersistedQueueEvent(
              queue,
              eventId,
              sequence,
            );
            if (persistedRemoved === false) {
              return {
                status: "not_found",
                queue,
                action,
                eventId,
              };
            }
            removeQueueEventFromLedger(queue, eventId, sequence);

            return Object.freeze({
              status: "applied",
              queue,
              action,
              eventId,
              sequence: matchedSequence,
              source: matchedSource,
              runId: matchedRunId,
              attempt: matchedAttempt,
              maxAttempts: matchedMaxAttempts,
              appliedAtMs: actionAppliedAtMs,
            });
          }

          const requestPayload = isPlainObject(matchedEvent.requestPayload)
            ? matchedEvent.requestPayload
            : undefined;
          if (!requestPayload) {
            return rejectQueueAction(
              "POLAR_SCHEDULER_QUEUE_ACTION_PAYLOAD_MISSING",
              "Scheduler queue action requires requestPayload on the targeted queue event",
            );
          }

          const persistedRemoved = await removePersistedQueueEvent(
            queue,
            eventId,
            sequence,
          );
          if (persistedRemoved === false) {
            return {
              status: "not_found",
              queue,
              action,
              eventId,
            };
          }
          removeQueueEventFromLedger(queue, eventId, sequence);

          const retryAtMs = requestedRetryAtMs ?? actionAppliedAtMs;
          const reason =
            requestedReason ??
            (action === "retry_now" ? "operator_retry_now" : "operator_requeue");
          const replayRetryEvent = appendRetryEvent({
            eventId,
            source: matchedSource,
            runId: matchedRunId,
            attempt: matchedAttempt,
            maxAttempts: matchedMaxAttempts,
            retryAtMs,
            reason,
            requestPayload,
            ...(matchedEvent.metadata !== undefined
              ? { metadata: matchedEvent.metadata }
              : {}),
          });
          await persistRetryEvent({
            ...replayRetryEvent,
            reason,
            requestPayload,
            ...(matchedEvent.output !== undefined
              ? { output: matchedEvent.output }
              : {}),
            ...(matchedEvent.failure !== undefined
              ? { failure: matchedEvent.failure }
              : {}),
            ...(matchedEvent.metadata !== undefined
              ? { metadata: matchedEvent.metadata }
              : {}),
          });

          return Object.freeze({
            status: "applied",
            queue,
            action,
            eventId,
            sequence: matchedSequence,
            targetQueue: "retry",
            targetSequence: replayRetryEvent.sequence,
            source: matchedSource,
            runId: matchedRunId,
            attempt: matchedAttempt,
            maxAttempts: matchedMaxAttempts,
            retryAtMs,
            appliedAtMs: actionAppliedAtMs,
          });
        },
      );
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listEventQueue(request = {}) {
      const parsed = validateRequest(request, listEventQueueRequestSchema.schemaId);
      const queue =
        /** @type {"processed"|"retry"|"dead_letter"|undefined} */ (parsed.queue) ??
        "processed";
      assertQueueFilterCompatibility(
        queue,
        /** @type {"processed"|"rejected"|"failed"|undefined} */ (parsed.status),
        /** @type {"executed"|"skipped"|"blocked"|"failed"|undefined} */ (
          parsed.runStatus
        ),
        /** @type {"none"|"retry_scheduled"|"dead_lettered"|undefined} */ (
          parsed.disposition
        ),
      );

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: SCHEDULER_ACTIONS.listEventQueue.actionId,
          version: SCHEDULER_ACTIONS.listEventQueue.version,
          input: {
            queue,
            ...(parsed.source !== undefined ? { source: parsed.source } : {}),
            ...(parsed.eventId !== undefined ? { eventId: parsed.eventId } : {}),
            ...(parsed.runId !== undefined ? { runId: parsed.runId } : {}),
            ...(parsed.status !== undefined ? { status: parsed.status } : {}),
            ...(parsed.runStatus !== undefined
              ? { runStatus: parsed.runStatus }
              : {}),
            ...(parsed.disposition !== undefined
              ? { disposition: parsed.disposition }
              : {}),
            ...(parsed.fromSequence !== undefined
              ? { fromSequence: parsed.fromSequence }
              : {}),
            ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
          },
        },
        async (input) => {
          const selectedQueue =
            /** @type {"processed"|"retry"|"dead_letter"|undefined} */ (
              input.queue
            ) ?? "processed";
          const status = /** @type {"processed"|"rejected"|"failed"|undefined} */ (
            input.status
          );
          const runStatus =
            /** @type {"executed"|"skipped"|"blocked"|"failed"|undefined} */ (
              input.runStatus
            );
          const disposition =
            /** @type {"none"|"retry_scheduled"|"dead_lettered"|undefined} */ (
              input.disposition
            );
          assertQueueFilterCompatibility(
            selectedQueue,
            status,
            runStatus,
            disposition,
          );

          const fromSequence =
            /** @type {number|undefined} */ (input.fromSequence) ?? 0;
          const limit = /** @type {number|undefined} */ (input.limit) ?? 50;
          const source = /** @type {"automation"|"heartbeat"|undefined} */ (
            input.source
          );
          const eventId = /** @type {string|undefined} */ (input.eventId);
          const runId = /** @type {string|undefined} */ (input.runId);

          const queueEvents = await getQueueEvents(selectedQueue);
          const filtered = queueEvents.filter((event) => {
            if (source !== undefined && event.source !== source) {
              return false;
            }
            if (eventId !== undefined && event.eventId !== eventId) {
              return false;
            }
            if (runId !== undefined && event.runId !== runId) {
              return false;
            }
            if (
              status !== undefined &&
              selectedQueue === "processed" &&
              event.status !== status
            ) {
              return false;
            }
            if (
              runStatus !== undefined &&
              selectedQueue === "processed" &&
              event.runStatus !== runStatus
            ) {
              return false;
            }
            if (
              disposition !== undefined &&
              selectedQueue === "processed" &&
              ((/** @type {string|undefined} */ (event.disposition) ?? "none") !==
                disposition)
            ) {
              return false;
            }
            return /** @type {number} */ (event.sequence) >= fromSequence;
          });
          const items = Object.freeze(filtered.slice(0, limit));
          const nextFromSequence =
            filtered.length > limit
              ? /** @type {number} */ (items[items.length - 1].sequence) + 1
              : undefined;

          const result = {
            status: "ok",
            queue: selectedQueue,
            fromSequence,
            returnedCount: items.length,
            totalCount: filtered.length,
            items,
            summary: buildEventQueueSummary(selectedQueue, filtered),
          };
          if (nextFromSequence !== undefined) {
            result.nextFromSequence = nextFromSequence;
          }

          return Object.freeze(result);
        },
      );
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listProcessedEvents() {
      return Object.freeze([...processedEventLedger]);
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listRetryEvents() {
      return Object.freeze([...retryEventLedger]);
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listDeadLetterEvents() {
      return Object.freeze([...deadLetterEventLedger]);
    },
  });
}
