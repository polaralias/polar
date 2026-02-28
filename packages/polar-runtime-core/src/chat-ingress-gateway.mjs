import {
  CHAT_INGRESS_ACTION,
  CHAT_INGRESS_HEALTH_ACTION,
  ContractValidationError,
  INGRESS_ADAPTERS,
  RuntimeExecutionError,
  createChatIngressContract,
  createChatIngressHealthContract,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "../../polar-domain/src/index.mjs";

const gatewayRequestSchema = createStrictObjectSchema({
  schemaId: "chat.ingress.gateway.request",
  fields: {
    adapter: enumField(INGRESS_ADAPTERS),
    payload: jsonField(),
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
  },
});

const gatewayHealthRequestSchema = createStrictObjectSchema({
  schemaId: "chat.ingress.gateway.health.request",
  fields: {
    adapter: enumField(INGRESS_ADAPTERS, { required: false }),
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
  },
});

const healthOutputSchema = createStrictObjectSchema({
  schemaId: "chat.ingress.gateway.health.output",
  fields: {
    status: enumField(["healthy", "unhealthy"]),
    checkedAtMs: numberField({ min: 0 }),
    resultCount: numberField({ min: 1 }),
    results: jsonField(),
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
 * @param {unknown} error
 * @returns {string}
 */
function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * @param {unknown} outcome
 * @returns {{ status: "healthy"|"unhealthy", reason?: string }}
 */
function normalizeHealthOutcome(outcome) {
  if (
    outcome === undefined ||
    outcome === null ||
    outcome === true
  ) {
    return { status: "healthy" };
  }

  if (outcome === false) {
    return {
      status: "unhealthy",
      reason: "Health check returned false",
    };
  }

  if (isPlainObject(outcome)) {
    const status = outcome.status;
    const reason = outcome.reason;

    if (status === "healthy") {
      return { status: "healthy" };
    }

    if (status === "unhealthy") {
      const normalizedReason =
        typeof reason === "string" && reason.length > 0
          ? reason
          : "Health check returned unhealthy status";
      return {
        status: "unhealthy",
        reason: normalizedReason,
      };
    }
  }

  return {
    status: "unhealthy",
    reason: "Health check returned unsupported outcome",
  };
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerChatIngressContract(contractRegistry) {
  const contracts = [
    createChatIngressContract(),
    createChatIngressHealthContract(),
  ];

  for (const contract of contracts) {
    if (!contractRegistry.has(contract.actionId, contract.version)) {
      contractRegistry.register(contract);
    }
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   normalizers: {
 *     web?: (payload: unknown) => Record<string, unknown>|Promise<Record<string, unknown>>,
 *     telegram?: (payload: unknown) => Record<string, unknown>|Promise<Record<string, unknown>>,
 *     slack?: (payload: unknown) => Record<string, unknown>|Promise<Record<string, unknown>>,
 *     discord?: (payload: unknown) => Record<string, unknown>|Promise<Record<string, unknown>>
 *   },
 *   healthChecks?: {
 *     web?: () => unknown|Promise<unknown>,
 *     telegram?: () => unknown|Promise<unknown>,
 *     slack?: () => unknown|Promise<unknown>,
 *     discord?: () => unknown|Promise<unknown>
 *   },
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat",
 *   now?: () => number,
 *   rateLimitOptions?: { windowMs: number, maxRequests: number }
 * }} config
 */
export function createChatIngressGateway({
  middlewarePipeline,
  normalizers,
  healthChecks = {},
  defaultExecutionType = "tool",
  now = Date.now,
  rateLimitOptions = { windowMs: 60000, maxRequests: 50 },
}) {
  if (typeof normalizers !== "object" || normalizers === null) {
    throw new RuntimeExecutionError("normalizers must be an object");
  }

  if (typeof healthChecks !== "object" || healthChecks === null) {
    throw new RuntimeExecutionError("healthChecks must be an object when provided");
  }

  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }

  /**
   * @param {"web"|"telegram"|"slack"|"discord"} adapter
   * @returns {(payload: unknown) => Promise<Record<string, unknown>>}
   */
  function getNormalizer(adapter) {
    const normalizer = normalizers[adapter];
    if (typeof normalizer !== "function") {
      throw new RuntimeExecutionError("Ingress normalizer is not configured", {
        adapter,
      });
    }

    return async (payload) => await normalizer(payload);
  }

  /**
   * @param {"web"|"telegram"|"slack"|"discord"} adapter
   * @returns {(() => Promise<unknown>)|undefined}
   */
  function getHealthCheck(adapter) {
    const check = healthChecks[adapter];
    if (typeof check !== "function") {
      return undefined;
    }

    return async () => await check();
  }

  const rateLimitWindowMs = rateLimitOptions.windowMs > 0 ? rateLimitOptions.windowMs : 60000;
  const rateLimitMaxRequests = rateLimitOptions.maxRequests > 0 ? rateLimitOptions.maxRequests : 50;
  const ingressTimestamps = [];

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async normalize(request) {
      const nowMs = now();
      while (ingressTimestamps.length > 0 && ingressTimestamps[0] < nowMs - rateLimitWindowMs) {
        ingressTimestamps.shift();
      }

      if (ingressTimestamps.length >= rateLimitMaxRequests) {
        throw new RuntimeExecutionError("Rate limit exceeded for ingress gateway", {
          retryAfterMs: rateLimitWindowMs
        });
      }
      ingressTimestamps.push(nowMs);

      const validation = gatewayRequestSchema.validate(request);
      if (!validation.ok) {
        throw new ContractValidationError("Invalid chat ingress request", {
          schemaId: gatewayRequestSchema.schemaId,
          errors: validation.errors ?? [],
        });
      }

      const parsed = /** @type {Record<string, unknown>} */ (validation.value);
      const adapter = /** @type {"web"|"telegram"|"slack"|"discord"} */ (parsed.adapter);
      const normalizer = getNormalizer(adapter);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: CHAT_INGRESS_ACTION.actionId,
          version: CHAT_INGRESS_ACTION.version,
          input: {
            adapter,
            payload: parsed.payload,
          },
        },
        async (input) => await normalizer(input.payload),
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async checkHealth(request = {}) {
      const validation = gatewayHealthRequestSchema.validate(request);
      if (!validation.ok) {
        throw new ContractValidationError("Invalid chat ingress health request", {
          schemaId: gatewayHealthRequestSchema.schemaId,
          errors: validation.errors ?? [],
        });
      }

      const parsed = /** @type {Record<string, unknown>} */ (validation.value);
      const requestedAdapter =
        /** @type {"web"|"telegram"|"slack"|"discord"|undefined} */ (parsed.adapter);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: CHAT_INGRESS_HEALTH_ACTION.actionId,
          version: CHAT_INGRESS_HEALTH_ACTION.version,
          input: requestedAdapter
            ? { adapter: requestedAdapter }
            : {},
        },
        async (input) => {
          const adapters =
            typeof input.adapter === "string"
              ? [input.adapter]
              : INGRESS_ADAPTERS;
          const checkedAtMs = now();

          const results = [];
          for (const adapter of adapters) {
            const check = getHealthCheck(adapter);
            if (check === undefined) {
              results.push(
                Object.freeze({
                  adapter,
                  status: "unhealthy",
                  reason: "Ingress health check is not configured",
                }),
              );
              continue;
            }

            try {
              const outcome = normalizeHealthOutcome(await check());
              if (outcome.status === "healthy") {
                results.push(
                  Object.freeze({
                    adapter,
                    status: "healthy",
                  }),
                );
              } else {
                results.push(
                  Object.freeze({
                    adapter,
                    status: "unhealthy",
                    reason: outcome.reason,
                  }),
                );
              }
            } catch (error) {
              results.push(
                Object.freeze({
                  adapter,
                  status: "unhealthy",
                  reason: toErrorMessage(error),
                }),
              );
            }
          }

          const output = {
            status: results.every((entry) => entry.status === "healthy")
              ? "healthy"
              : "unhealthy",
            checkedAtMs,
            resultCount: results.length,
            results: Object.freeze(results),
          };

          const healthValidation = healthOutputSchema.validate(output);
          if (!healthValidation.ok) {
            throw new RuntimeExecutionError("Invalid chat ingress health output", {
              schemaId: healthOutputSchema.schemaId,
              errors: healthValidation.errors ?? [],
            });
          }

          return /** @type {Record<string, unknown>} */ (healthValidation.value);
        },
      );
    },
  });
}
