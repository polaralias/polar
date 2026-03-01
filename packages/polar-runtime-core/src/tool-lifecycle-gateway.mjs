import {
  ContractValidationError,
  RuntimeExecutionError,
  TOOL_LIFECYCLE_ACTION,
  TOOL_LIFECYCLE_PHASES,
  TOOL_LIFECYCLE_SOURCES,
  booleanField,
  createStrictObjectSchema,
  createToolLifecycleContract,
  enumField,
  jsonField,
  stringField,
} from "@polar/domain";

const lifecycleRequestSchema = createStrictObjectSchema({
  schemaId: "tool.lifecycle.gateway.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    phase: enumField(TOOL_LIFECYCLE_PHASES),
    toolCallId: stringField({ minLength: 1 }),
    toolName: stringField({ minLength: 1 }),
    source: enumField(TOOL_LIFECYCLE_SOURCES, { required: false }),
    isError: booleanField({ required: false }),
    args: jsonField({ required: false }),
    result: jsonField({ required: false }),
  },
});

/**
 * @param {unknown} value
 * @returns {string|undefined}
 */
function serializePayload(value) {
  if (value === undefined) {
    return undefined;
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return "null";
    }

    return serialized;
  } catch (error) {
    throw new RuntimeExecutionError("Unable to serialize tool lifecycle payload", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerToolLifecycleContract(contractRegistry) {
  if (
    !contractRegistry.has(
      TOOL_LIFECYCLE_ACTION.actionId,
      TOOL_LIFECYCLE_ACTION.version,
    )
  ) {
    contractRegistry.register(createToolLifecycleContract());
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   defaultSource?: "pi-agent-loop",
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createToolLifecycleGateway({
  middlewarePipeline,
  defaultSource = "pi-agent-loop",
  defaultExecutionType = "tool",
}) {
  if (!TOOL_LIFECYCLE_SOURCES.includes(defaultSource)) {
    throw new ContractValidationError("Invalid tool lifecycle source", {
      source: defaultSource,
    });
  }

  /**
   * @param {unknown} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async function handleEvent(request) {
    const validation = lifecycleRequestSchema.validate(request);
    if (!validation.ok) {
      throw new ContractValidationError("Invalid tool lifecycle gateway request", {
        schemaId: lifecycleRequestSchema.schemaId,
        errors: validation.errors ?? [],
      });
    }

    const validatedRequest = /** @type {Record<string, unknown>} */ (validation.value);
    const executionType =
      /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
        validatedRequest.executionType
      ) ?? defaultExecutionType;
    const source =
      /** @type {"pi-agent-loop"|undefined} */ (validatedRequest.source) ??
      defaultSource;
    const phase = /** @type {"before"|"after"} */ (validatedRequest.phase);

    const payloadJson = serializePayload(
      phase === "before"
        ? validatedRequest.args
        : validatedRequest.result,
    );

    const middlewareInput = {
      phase,
      toolCallId: validatedRequest.toolCallId,
      toolName: validatedRequest.toolName,
      source,
      isError: validatedRequest.isError ?? false,
    };
    if (payloadJson !== undefined) {
      middlewareInput.payloadJson = payloadJson;
    }

    return middlewarePipeline.run(
      {
        executionType,
        traceId: validatedRequest.traceId,
        actionId: TOOL_LIFECYCLE_ACTION.actionId,
        version: TOOL_LIFECYCLE_ACTION.version,
        input: middlewareInput,
      },
      async (input) => ({
        status: "accepted",
        phase: input.phase,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        source: input.source,
      }),
    );
  }

  /**
   * @param {{ executionType?: "tool"|"handoff"|"automation"|"heartbeat", traceId?: string, source?: "pi-agent-loop" }} [base]
   */
  function createLifecycleHandler(base = {}) {
    return async (event) =>
      handleEvent({
        ...base,
        ...event,
      });
  }

  return Object.freeze({
    handleEvent,
    createLifecycleHandler,
  });
}
