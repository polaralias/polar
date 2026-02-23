import {
  ContractValidationError,
  RuntimeExecutionError,
  SCHEDULER_ACTIONS,
  SCHEDULER_EVENT_RUN_STATUSES,
  SCHEDULER_EVENT_SOURCES,
  SCHEDULER_RUN_LINK_REPLAY_SOURCES,
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

const processableRunStatuses = new Set(SCHEDULER_EVENT_RUN_STATUSES);

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
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createSchedulerGateway({
  middlewarePipeline,
  automationGateway = {},
  heartbeatGateway = {},
  runEventLinker = {},
  defaultExecutionType = "automation",
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

  /** @type {Record<string, unknown>[]} */
  const processedEventLedger = [];
  /** @type {Set<string>} */
  const processedEventIds = new Set();

  /**
   * @param {{
   *   status: "processed"|"rejected"|"failed",
   *   eventId: string,
   *   source: "automation"|"heartbeat",
   *   runId: string,
   *   runStatus?: "executed"|"skipped"|"blocked"|"failed",
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
      ...(entry.runStatus !== undefined ? { runStatus: entry.runStatus } : {}),
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
      ...(ledgerEntry.runStatus !== undefined
        ? { runStatus: ledgerEntry.runStatus }
        : {}),
      ...(ledgerEntry.output !== undefined ? { output: ledgerEntry.output } : {}),
      ...(ledgerEntry.rejectionCode !== undefined
        ? { rejectionCode: ledgerEntry.rejectionCode }
        : {}),
      ...(ledgerEntry.reason !== undefined ? { reason: ledgerEntry.reason } : {}),
      ...(ledgerEntry.failure !== undefined ? { failure: ledgerEntry.failure } : {}),
    };
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
          if (processedEventIds.has(eventId)) {
            return appendProcessedEvent({
              status: "rejected",
              eventId,
              source,
              runId,
              rejectionCode: "POLAR_SCHEDULER_EVENT_DUPLICATE",
              reason: "Persisted scheduler event is already processed",
              recordedAtMs,
              metadata,
            });
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
            return appendProcessedEvent({
              status: "rejected",
              eventId,
              source,
              runId,
              rejectionCode: "POLAR_SCHEDULER_EVENT_PAYLOAD_MISMATCH",
              reason: `Unexpected ${source === "automation" ? "heartbeatRequest" : "automationRequest"} for source "${source}"`,
              recordedAtMs,
              metadata,
            });
          }

          if (!isPlainObject(payload)) {
            return appendProcessedEvent({
              status: "rejected",
              eventId,
              source,
              runId,
              rejectionCode: "POLAR_SCHEDULER_EVENT_PAYLOAD_MISSING",
              reason: `Missing ${source} request payload`,
              recordedAtMs,
              metadata,
            });
          }

          if (typeof payload.runId !== "string" || payload.runId !== runId) {
            return appendProcessedEvent({
              status: "rejected",
              eventId,
              source,
              runId,
              rejectionCode: "POLAR_SCHEDULER_EVENT_RUN_ID_MISMATCH",
              reason: "Persisted scheduler event runId does not match payload runId",
              recordedAtMs,
              metadata,
            });
          }

          if (!gatewayMethod) {
            return appendProcessedEvent({
              status: "rejected",
              eventId,
              source,
              runId,
              rejectionCode: "POLAR_SCHEDULER_GATEWAY_NOT_CONFIGURED",
              reason: `No ${source} gateway handler is configured`,
              recordedAtMs,
              metadata,
            });
          }

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
            processedEventIds.add(eventId);

            return appendProcessedEvent({
              status: "processed",
              eventId,
              source,
              runId,
              ...(runStatus !== undefined ? { runStatus } : {}),
              output,
              recordedAtMs,
              metadata,
            });
          } catch (error) {
            if (error instanceof ContractValidationError) {
              return appendProcessedEvent({
                status: "rejected",
                eventId,
                source,
                runId,
                rejectionCode: error.code,
                reason: error.message,
                failure: {
                  ...(error.details ? { details: error.details } : {}),
                },
                recordedAtMs,
                metadata,
              });
            }

            return appendProcessedEvent({
              status: "failed",
              eventId,
              source,
              runId,
              failure: toFailure(error),
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
     * @returns {readonly Record<string, unknown>[]}
     */
    listProcessedEvents() {
      return Object.freeze([...processedEventLedger]);
    },
  });
}
