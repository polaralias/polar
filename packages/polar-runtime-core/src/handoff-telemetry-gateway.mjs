import {
  booleanField,
  ContractValidationError,
  HANDOFF_ROUTING_EVENT_STATUSES,
  HANDOFF_ROUTING_TELEMETRY_ACTION,
  RuntimeExecutionError,
  createHandoffRoutingTelemetryContract,
  createStrictObjectSchema,
  enumField,
  numberField,
  stringField,
} from "@polar/domain";

const listRequestSchema = createStrictObjectSchema({
  schemaId: "handoff.telemetry.gateway.list.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    fromSequence: numberField({ min: 1, required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
    mode: enumField(["direct", "delegate", "fanout-fanin"], {
      required: false,
    }),
    routeAdjustedOnly: booleanField({ required: false }),
    profileResolutionStatus: enumField(["resolved", "not_resolved"], {
      required: false,
    }),
    sessionId: stringField({ minLength: 1, required: false }),
    workspaceId: stringField({ minLength: 1, required: false }),
    sourceAgentId: stringField({ minLength: 1, required: false }),
    status: enumField(HANDOFF_ROUTING_EVENT_STATUSES, {
      required: false,
    }),
  },
});

/**
 * @param {unknown} request
 * @returns {Record<string, unknown>}
 */
function validateRequest(request) {
  const validation = listRequestSchema.validate(request);
  if (!validation.ok) {
    throw new ContractValidationError("Invalid handoff telemetry list request", {
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
export function registerHandoffRoutingTelemetryContract(contractRegistry) {
  if (
    !contractRegistry.has(
      HANDOFF_ROUTING_TELEMETRY_ACTION.actionId,
      HANDOFF_ROUTING_TELEMETRY_ACTION.version,
    )
  ) {
    contractRegistry.register(createHandoffRoutingTelemetryContract());
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
export function createHandoffRoutingTelemetryGateway({
  middlewarePipeline,
  telemetryCollector,
  lineageStore,
  defaultExecutionType = "handoff",
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
    async listRoutingTelemetry(request = {}) {
      const parsed = validateRequest(request);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: HANDOFF_ROUTING_TELEMETRY_ACTION.actionId,
          version: HANDOFF_ROUTING_TELEMETRY_ACTION.version,
          input: (() => {
            const input = {};
            if (parsed.fromSequence !== undefined) {
              input.fromSequence = parsed.fromSequence;
            }
            if (parsed.limit !== undefined) {
              input.limit = parsed.limit;
            }
            if (parsed.mode !== undefined) {
              input.mode = parsed.mode;
            }
            if (parsed.routeAdjustedOnly !== undefined) {
              input.routeAdjustedOnly = parsed.routeAdjustedOnly;
            }
            if (parsed.profileResolutionStatus !== undefined) {
              input.profileResolutionStatus = parsed.profileResolutionStatus;
            }
            if (parsed.sessionId !== undefined) {
              input.sessionId = parsed.sessionId;
            }
            if (parsed.workspaceId !== undefined) {
              input.workspaceId = parsed.workspaceId;
            }
            if (parsed.sourceAgentId !== undefined) {
              input.sourceAgentId = parsed.sourceAgentId;
            }
            if (parsed.status !== undefined) {
              input.status = parsed.status;
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
