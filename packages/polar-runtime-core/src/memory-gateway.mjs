import {
  MEMORY_COMPACT_STRATEGIES,
  ContractValidationError,
  MEMORY_ACTIONS,
  MEMORY_SCOPES,
  PolarTypedError,
  RuntimeExecutionError,
  booleanField,
  createMemoryContracts,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "@polar/domain";

const memorySearchRequestSchema = createStrictObjectSchema({
  schemaId: "memory.gateway.search.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    scope: enumField(MEMORY_SCOPES),
    query: stringField({ minLength: 1 }),
    limit: numberField({ min: 1, max: 100, required: false }),
    cursor: stringField({ minLength: 1, required: false }),
    filters: jsonField({ required: false }),
  },
});

const memoryGetRequestSchema = createStrictObjectSchema({
  schemaId: "memory.gateway.get.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    scope: enumField(MEMORY_SCOPES),
    memoryId: stringField({ minLength: 1 }),
  },
});

const memoryUpsertRequestSchema = createStrictObjectSchema({
  schemaId: "memory.gateway.upsert.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    scope: enumField(MEMORY_SCOPES),
    memoryId: stringField({ minLength: 1, required: false }),
    record: jsonField(),
    metadata: jsonField({ required: false }),
  },
});

const memoryCompactRequestSchema = createStrictObjectSchema({
  schemaId: "memory.gateway.compact.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    scope: enumField(MEMORY_SCOPES),
    strategy: enumField(MEMORY_COMPACT_STRATEGIES, {
      required: false,
    }),
    maxRecords: numberField({ min: 1, max: 10_000, required: false }),
    dryRun: booleanField({ required: false }),
    metadata: jsonField({ required: false }),
  },
});

const unavailableMessagePattern =
  /\b(unavailable|offline|unreachable|timeout|timed out|connection refused)\b/i;

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
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function validateRequest(value, schemaId) {
  const schema = {
    [memorySearchRequestSchema.schemaId]: memorySearchRequestSchema,
    [memoryGetRequestSchema.schemaId]: memoryGetRequestSchema,
    [memoryUpsertRequestSchema.schemaId]: memoryUpsertRequestSchema,
    [memoryCompactRequestSchema.schemaId]: memoryCompactRequestSchema,
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
 * @param {unknown} error
 * @returns {boolean}
 */
function defaultIsProviderUnavailableError(error) {
  if (error instanceof PolarTypedError) {
    if (error.code === "POLAR_MEMORY_PROVIDER_UNAVAILABLE") {
      return true;
    }

    if (
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR" &&
      unavailableMessagePattern.test(error.message)
    ) {
      return true;
    }

    const cause = error.details?.cause;
    if (typeof cause === "string" && unavailableMessagePattern.test(cause)) {
      return true;
    }
  }

  return unavailableMessagePattern.test(toErrorMessage(error));
}

/**
 * @param {unknown} value
 * @returns {{ records: readonly unknown[], nextCursor?: string }}
 */
function normalizeSearchResult(value) {
  if (!isPlainObject(value)) {
    throw new RuntimeExecutionError(
      "Memory provider search result must be a plain object",
    );
  }

  if (!Array.isArray(value.records)) {
    throw new RuntimeExecutionError(
      "Memory provider search result must include records array",
    );
  }

  const normalized = {
    records: Object.freeze([...value.records]),
  };
  if (value.nextCursor !== undefined) {
    if (typeof value.nextCursor !== "string" || value.nextCursor.length === 0) {
      throw new RuntimeExecutionError(
        "Memory provider search result nextCursor must be a non-empty string when provided",
      );
    }
    normalized.nextCursor = value.nextCursor;
  }

  return normalized;
}

/**
 * @param {unknown} value
 * @returns {{ status: "completed"|"not_found", record?: unknown }}
 */
function normalizeGetResult(value) {
  if (value === undefined || value === null) {
    return { status: "not_found" };
  }

  if (!isPlainObject(value)) {
    throw new RuntimeExecutionError("Memory provider get result must be a plain object");
  }

  if (value.found === false) {
    return { status: "not_found" };
  }

  if (Object.prototype.hasOwnProperty.call(value, "record")) {
    const record = value.record;
    if (record === undefined) {
      return { status: "not_found" };
    }

    return {
      status: "completed",
      record,
    };
  }

  return {
    status: "completed",
    record: value,
  };
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isNonNegativeInteger(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0;
}

/**
 * @param {unknown} value
 * @param {string|undefined} inputMemoryId
 * @returns {{ memoryId: string, created?: boolean }}
 */
function normalizeUpsertResult(value, inputMemoryId) {
  let memoryId = inputMemoryId;
  /** @type {boolean|undefined} */
  let created = undefined;

  if (typeof value === "string" && value.length > 0) {
    memoryId = value;
  } else if (isPlainObject(value)) {
    if (value.memoryId !== undefined) {
      if (typeof value.memoryId !== "string" || value.memoryId.length === 0) {
        throw new RuntimeExecutionError(
          "Memory provider upsert result memoryId must be a non-empty string when provided",
        );
      }
      memoryId = value.memoryId;
    }
    if (value.created !== undefined) {
      if (typeof value.created !== "boolean") {
        throw new RuntimeExecutionError(
          "Memory provider upsert result created must be boolean when provided",
        );
      }
      created = value.created;
    }
  } else {
    throw new RuntimeExecutionError(
      "Memory provider upsert result must be a non-empty string or plain object",
    );
  }

  if (typeof memoryId !== "string" || memoryId.length === 0) {
    throw new RuntimeExecutionError(
      "Memory provider upsert result must include memoryId",
    );
  }

  return {
    memoryId,
    ...(created !== undefined ? { created } : {}),
  };
}

/**
 * @param {unknown} value
 * @returns {{ examinedCount: number, compactedCount: number, archivedCount: number }}
 */
function normalizeCompactResult(value) {
  if (!isPlainObject(value)) {
    throw new RuntimeExecutionError(
      "Memory provider compact result must be a plain object",
    );
  }

  if (!isNonNegativeInteger(value.examinedCount)) {
    throw new RuntimeExecutionError(
      "Memory provider compact result examinedCount must be a non-negative integer",
    );
  }

  if (!isNonNegativeInteger(value.compactedCount)) {
    throw new RuntimeExecutionError(
      "Memory provider compact result compactedCount must be a non-negative integer",
    );
  }

  if (
    value.archivedCount !== undefined &&
    !isNonNegativeInteger(value.archivedCount)
  ) {
    throw new RuntimeExecutionError(
      "Memory provider compact result archivedCount must be a non-negative integer when provided",
    );
  }

  return {
    examinedCount: value.examinedCount,
    compactedCount: value.compactedCount,
    archivedCount: value.archivedCount ?? 0,
  };
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerMemoryContracts(contractRegistry) {
  for (const contract of createMemoryContracts()) {
    if (!contractRegistry.has(contract.actionId, contract.version)) {
      contractRegistry.register(contract);
    }
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   memoryProvider: {
 *     search: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     get: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     upsert: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     compact: (request: Record<string, unknown>) => Promise<unknown>|unknown
 *   },
 *   isProviderUnavailableError?: (error: unknown) => boolean,
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createMemoryGateway({
  middlewarePipeline,
  memoryProvider,
  isProviderUnavailableError = defaultIsProviderUnavailableError,
  defaultExecutionType = "tool",
}) {
  if (
    typeof memoryProvider !== "object" ||
    memoryProvider === null ||
    typeof memoryProvider.search !== "function" ||
    typeof memoryProvider.get !== "function" ||
    typeof memoryProvider.upsert !== "function" ||
    typeof memoryProvider.compact !== "function"
  ) {
    throw new RuntimeExecutionError(
      "memoryProvider must expose search(request), get(request), upsert(request), and compact(request)",
    );
  }

  if (typeof isProviderUnavailableError !== "function") {
    throw new RuntimeExecutionError(
      "isProviderUnavailableError must be a function when provided",
    );
  }

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async search(request) {
      const validatedRequest = validateRequest(
        request,
        memorySearchRequestSchema.schemaId,
      );

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              validatedRequest.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (validatedRequest.traceId),
          actionId: MEMORY_ACTIONS.search.actionId,
          version: MEMORY_ACTIONS.search.version,
          input: (() => {
            const input = {
              sessionId: validatedRequest.sessionId,
              userId: validatedRequest.userId,
              scope: validatedRequest.scope,
              query: validatedRequest.query,
            };
            if (validatedRequest.limit !== undefined) {
              input.limit = validatedRequest.limit;
            }
            if (validatedRequest.cursor !== undefined) {
              input.cursor = validatedRequest.cursor;
            }
            if (validatedRequest.filters !== undefined) {
              input.filters = validatedRequest.filters;
            }
            return input;
          })(),
        },
        async (input) => {
          try {
            const providerResponse = normalizeSearchResult(
              await memoryProvider.search({
                sessionId: input.sessionId,
                userId: input.userId,
                scope: input.scope,
                query: input.query,
                limit: input.limit,
                cursor: input.cursor,
                filters: input.filters,
              }),
            );

            const output = {
              status: "completed",
              sessionId: input.sessionId,
              userId: input.userId,
              scope: input.scope,
              query: input.query,
              resultCount: providerResponse.records.length,
              records: providerResponse.records,
              providerStatus: "available",
            };
            if (providerResponse.nextCursor !== undefined) {
              output.nextCursor = providerResponse.nextCursor;
            }

            return output;
          } catch (error) {
            if (isProviderUnavailableError(error)) {
              return {
                status: "degraded",
                sessionId: input.sessionId,
                userId: input.userId,
                scope: input.scope,
                query: input.query,
                resultCount: 0,
                records: Object.freeze([]),
                providerStatus: "unavailable",
                degradedReason: toErrorMessage(error),
              };
            }

            if (error instanceof PolarTypedError) {
              throw error;
            }

            throw new RuntimeExecutionError("Memory search failed", {
              cause: toErrorMessage(error),
            });
          }
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async get(request) {
      const validatedRequest = validateRequest(
        request,
        memoryGetRequestSchema.schemaId,
      );

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              validatedRequest.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (validatedRequest.traceId),
          actionId: MEMORY_ACTIONS.get.actionId,
          version: MEMORY_ACTIONS.get.version,
          input: {
            sessionId: validatedRequest.sessionId,
            userId: validatedRequest.userId,
            scope: validatedRequest.scope,
            memoryId: validatedRequest.memoryId,
          },
        },
        async (input) => {
          try {
            const providerResponse = normalizeGetResult(
              await memoryProvider.get({
                sessionId: input.sessionId,
                userId: input.userId,
                scope: input.scope,
                memoryId: input.memoryId,
              }),
            );

            if (providerResponse.status === "not_found") {
              return {
                status: "not_found",
                sessionId: input.sessionId,
                userId: input.userId,
                scope: input.scope,
                memoryId: input.memoryId,
                providerStatus: "available",
              };
            }

            return {
              status: "completed",
              sessionId: input.sessionId,
              userId: input.userId,
              scope: input.scope,
              memoryId: input.memoryId,
              record: providerResponse.record,
              providerStatus: "available",
            };
          } catch (error) {
            if (isProviderUnavailableError(error)) {
              return {
                status: "degraded",
                sessionId: input.sessionId,
                userId: input.userId,
                scope: input.scope,
                memoryId: input.memoryId,
                providerStatus: "unavailable",
                degradedReason: toErrorMessage(error),
              };
            }

            if (error instanceof PolarTypedError) {
              throw error;
            }

            throw new RuntimeExecutionError("Memory get failed", {
              cause: toErrorMessage(error),
            });
          }
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async upsert(request) {
      const validatedRequest = validateRequest(
        request,
        memoryUpsertRequestSchema.schemaId,
      );

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              validatedRequest.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (validatedRequest.traceId),
          actionId: MEMORY_ACTIONS.upsert.actionId,
          version: MEMORY_ACTIONS.upsert.version,
          input: {
            sessionId: validatedRequest.sessionId,
            userId: validatedRequest.userId,
            scope: validatedRequest.scope,
            ...(validatedRequest.memoryId !== undefined
              ? { memoryId: validatedRequest.memoryId }
              : {}),
            record: validatedRequest.record,
            ...(validatedRequest.metadata !== undefined
              ? { metadata: validatedRequest.metadata }
              : {}),
          },
        },
        async (input) => {
          try {
            const providerResponse = normalizeUpsertResult(
              await memoryProvider.upsert({
                sessionId: input.sessionId,
                userId: input.userId,
                scope: input.scope,
                memoryId: input.memoryId,
                record: input.record,
                metadata: input.metadata,
              }),
              /** @type {string|undefined} */ (input.memoryId),
            );

            return {
              status: "completed",
              sessionId: input.sessionId,
              userId: input.userId,
              scope: input.scope,
              memoryId: providerResponse.memoryId,
              providerStatus: "available",
              ...(providerResponse.created !== undefined
                ? { created: providerResponse.created }
                : {}),
            };
          } catch (error) {
            if (isProviderUnavailableError(error)) {
              return {
                status: "degraded",
                sessionId: input.sessionId,
                userId: input.userId,
                scope: input.scope,
                ...(input.memoryId !== undefined
                  ? { memoryId: input.memoryId }
                  : {}),
                providerStatus: "unavailable",
                degradedReason: toErrorMessage(error),
              };
            }

            if (error instanceof PolarTypedError) {
              throw error;
            }

            throw new RuntimeExecutionError("Memory upsert failed", {
              cause: toErrorMessage(error),
            });
          }
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async compact(request) {
      const validatedRequest = validateRequest(
        request,
        memoryCompactRequestSchema.schemaId,
      );

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              validatedRequest.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (validatedRequest.traceId),
          actionId: MEMORY_ACTIONS.compact.actionId,
          version: MEMORY_ACTIONS.compact.version,
          input: {
            sessionId: validatedRequest.sessionId,
            userId: validatedRequest.userId,
            scope: validatedRequest.scope,
            strategy:
              /** @type {"summarize"|"deduplicate"|undefined} */ (
                validatedRequest.strategy
              ) ?? "summarize",
            ...(validatedRequest.maxRecords !== undefined
              ? { maxRecords: validatedRequest.maxRecords }
              : {}),
            ...(validatedRequest.dryRun !== undefined
              ? { dryRun: validatedRequest.dryRun }
              : {}),
            ...(validatedRequest.metadata !== undefined
              ? { metadata: validatedRequest.metadata }
              : {}),
          },
        },
        async (input) => {
          try {
            const providerResponse = normalizeCompactResult(
              await memoryProvider.compact({
                sessionId: input.sessionId,
                userId: input.userId,
                scope: input.scope,
                strategy: input.strategy,
                maxRecords: input.maxRecords,
                dryRun: input.dryRun,
                metadata: input.metadata,
              }),
            );

            return {
              status: "completed",
              sessionId: input.sessionId,
              userId: input.userId,
              scope: input.scope,
              strategy: input.strategy,
              examinedCount: providerResponse.examinedCount,
              compactedCount: providerResponse.compactedCount,
              archivedCount: providerResponse.archivedCount,
              providerStatus: "available",
            };
          } catch (error) {
            if (isProviderUnavailableError(error)) {
              return {
                status: "degraded",
                sessionId: input.sessionId,
                userId: input.userId,
                scope: input.scope,
                strategy: input.strategy,
                examinedCount: 0,
                compactedCount: 0,
                archivedCount: 0,
                providerStatus: "unavailable",
                degradedReason: toErrorMessage(error),
              };
            }

            if (error instanceof PolarTypedError) {
              throw error;
            }

            throw new RuntimeExecutionError("Memory compact failed", {
              cause: toErrorMessage(error),
            });
          }
        },
      );
    },
  });
}
