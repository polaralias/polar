import {
  ContractValidationError,
  RuntimeExecutionError,
  USAGE_TELEMETRY_ACTION,
  USAGE_TELEMETRY_EVENT_STATUSES,
  USAGE_TELEMETRY_MODEL_LANES,
  USAGE_TELEMETRY_OPERATIONS,
  createStrictObjectSchema,
  createUsageTelemetryContract,
  enumField,
  booleanField,
  numberField,
  stringField,
} from "@polar/domain";

const listRequestSchema = createStrictObjectSchema({
  schemaId: "usage.telemetry.gateway.list.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    fromSequence: numberField({ min: 1, required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
    operation: enumField(USAGE_TELEMETRY_OPERATIONS, { required: false }),
    providerId: stringField({ minLength: 1, required: false }),
    requestedProviderId: stringField({ minLength: 1, required: false }),
    status: enumField(USAGE_TELEMETRY_EVENT_STATUSES, { required: false }),
    modelLane: enumField(USAGE_TELEMETRY_MODEL_LANES, { required: false }),
    fallbackUsed: booleanField({ required: false }),
  },
});

/**
 * @param {unknown} request
 * @returns {Record<string, unknown>}
 */
function validateRequest(request) {
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
 * @returns {Record<string, unknown>}
 */
function createEmptyLineageResponse() {
  return Object.freeze({
    status: "ok",
    fromSequence: 1,
    returnedCount: 0,
    totalCount: 0,
    items: Object.freeze([]),
  });
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerUsageTelemetryContract(contractRegistry) {
  if (
    !contractRegistry.has(
      USAGE_TELEMETRY_ACTION.actionId,
      USAGE_TELEMETRY_ACTION.version,
    )
  ) {
    contractRegistry.register(createUsageTelemetryContract());
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   telemetryCollector: { listEvents: (request?: unknown) => Record<string, unknown> },
 *   lineageStore?: { query: (request?: unknown) => Promise<Record<string, unknown>>|Record<string, unknown> },
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createUsageTelemetryGateway({
  middlewarePipeline,
  telemetryCollector,
  lineageStore,
  defaultExecutionType = "tool",
}) {
  if (
    typeof telemetryCollector !== "object" ||
    telemetryCollector === null ||
    typeof telemetryCollector.listEvents !== "function"
  ) {
    throw new RuntimeExecutionError(
      "telemetryCollector must expose listEvents(request)",
    );
  }

  if (
    lineageStore !== undefined &&
    (
      typeof lineageStore !== "object" ||
      lineageStore === null ||
      typeof lineageStore.query !== "function"
    )
  ) {
    throw new RuntimeExecutionError(
      "lineageStore must expose query(request) when provided",
    );
  }

  return Object.freeze({
    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listUsageTelemetry(request = {}) {
      const parsed = validateRequest(request);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: USAGE_TELEMETRY_ACTION.actionId,
          version: USAGE_TELEMETRY_ACTION.version,
          input: (() => {
            const input = {};
            if (parsed.fromSequence !== undefined) {
              input.fromSequence = parsed.fromSequence;
            }
            if (parsed.limit !== undefined) {
              input.limit = parsed.limit;
            }
            if (parsed.operation !== undefined) {
              input.operation = parsed.operation;
            }
            if (parsed.providerId !== undefined) {
              input.providerId = parsed.providerId;
            }
            if (parsed.requestedProviderId !== undefined) {
              input.requestedProviderId = parsed.requestedProviderId;
            }
            if (parsed.status !== undefined) {
              input.status = parsed.status;
            }
            if (parsed.modelLane !== undefined) {
              input.modelLane = parsed.modelLane;
            }
            if (parsed.fallbackUsed !== undefined) {
              input.fallbackUsed = parsed.fallbackUsed;
            }
            if (parsed.executionType !== undefined) {
              input.executionType = parsed.executionType;
            }
            return input;
          })(),
        },
        async (input) => telemetryCollector.listEvents(input),
      );
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listExecutionLineage(request = {}) {
      if (!lineageStore) {
        return createEmptyLineageResponse();
      }

      return lineageStore.query(request);
    },
  });
}
