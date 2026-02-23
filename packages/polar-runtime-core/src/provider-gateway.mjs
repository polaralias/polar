import {
  ContractValidationError,
  EXECUTION_TYPES,
  PolarTypedError,
  RuntimeExecutionError,
  PROVIDER_ACTIONS,
  createProviderOperationContracts,
  createStrictObjectSchema,
  enumField,
  stringArrayField,
  stringField,
} from "../../polar-domain/src/index.mjs";

const executionTypes = Object.freeze([...EXECUTION_TYPES]);

const generateRequestSchema = createStrictObjectSchema({
  schemaId: "provider.gateway.generate.request",
  fields: {
    executionType: enumField(executionTypes, { required: false }),
    traceId: stringField({ minLength: 1, required: false }),
    providerId: stringField({ minLength: 1 }),
    fallbackProviderIds: stringArrayField({ minItems: 1, required: false }),
    model: stringField({ minLength: 1 }),
    prompt: stringField({ minLength: 1 }),
  },
});

const streamRequestSchema = createStrictObjectSchema({
  schemaId: "provider.gateway.stream.request",
  fields: {
    executionType: enumField(executionTypes, { required: false }),
    traceId: stringField({ minLength: 1, required: false }),
    providerId: stringField({ minLength: 1 }),
    fallbackProviderIds: stringArrayField({ minItems: 1, required: false }),
    model: stringField({ minLength: 1 }),
    prompt: stringField({ minLength: 1 }),
  },
});

const embedRequestSchema = createStrictObjectSchema({
  schemaId: "provider.gateway.embed.request",
  fields: {
    executionType: enumField(executionTypes, { required: false }),
    traceId: stringField({ minLength: 1, required: false }),
    providerId: stringField({ minLength: 1 }),
    fallbackProviderIds: stringArrayField({ minItems: 1, required: false }),
    model: stringField({ minLength: 1 }),
    text: stringField({ minLength: 1 }),
  },
});

/**
 * @typedef {Object} ProviderOperationInput
 * @property {string} providerId
 * @property {string} model
 */

/**
 * @typedef {ProviderOperationInput & { prompt: string }} ProviderGenerateInput
 * @typedef {ProviderOperationInput & { prompt: string }} ProviderStreamInput
 * @typedef {ProviderOperationInput & { text: string }} ProviderEmbedInput
 */

/**
 * @typedef {Object} ProviderEngine
 * @property {(input: ProviderGenerateInput) => Promise<Record<string, unknown>>} generate
 * @property {(input: ProviderStreamInput) => Promise<Record<string, unknown>>} stream
 * @property {(input: ProviderEmbedInput) => Promise<Record<string, unknown>>} embed
 */

/**
 * @param {unknown} value
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function validateRequest(value, schemaId) {
  const schema = {
    [generateRequestSchema.schemaId]: generateRequestSchema,
    [streamRequestSchema.schemaId]: streamRequestSchema,
    [embedRequestSchema.schemaId]: embedRequestSchema,
  }[schemaId];

  const result = schema.validate(value);
  if (!result.ok) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: result.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (result.value);
}

/**
 * @param {Map<string, ProviderEngine>} providers
 * @param {string} providerId
 * @returns {ProviderEngine}
 */
function getProviderOrThrow(providers, providerId) {
  const provider = providers.get(providerId);
  if (!provider) {
    throw new RuntimeExecutionError(`Provider adapter is not configured: ${providerId}`, {
      providerId,
    });
  }

  return provider;
}

/**
 * @param {Map<string, ProviderEngine>} providers
 * @param {{ providerId: string, fallbackProviderIds?: readonly string[] }} request
 * @returns {readonly string[]}
 */
function resolveProviderOrder(providers, request) {
  const fallbackProviderIds = request.fallbackProviderIds ?? [];
  const orderedProviderIds = [request.providerId, ...fallbackProviderIds];
  const deduplicated = [];
  const seen = new Set();

  for (const providerId of orderedProviderIds) {
    if (seen.has(providerId)) {
      continue;
    }

    seen.add(providerId);
    getProviderOrThrow(providers, providerId);
    deduplicated.push(providerId);
  }

  return Object.freeze(deduplicated);
}

/**
 * @param {unknown} error
 * @returns {PolarTypedError}
 */
function normalizeTypedError(error) {
  if (error instanceof PolarTypedError) {
    return error;
  }

  return new RuntimeExecutionError("Provider operation failed", {
    cause: error instanceof Error ? error.message : String(error),
  });
}

/**
 * @param {PolarTypedError} error
 * @returns {boolean}
 */
function shouldTryFallback(error) {
  if (
    error.code === "POLAR_CONTRACT_VALIDATION_ERROR" &&
    error.details.direction === "input"
  ) {
    return false;
  }

  return true;
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerProviderOperationContracts(contractRegistry) {
  for (const contract of createProviderOperationContracts()) {
    if (!contractRegistry.has(contract.actionId, contract.version)) {
      contractRegistry.register(contract);
    }
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   providers: Record<string, ProviderEngine>|Map<string, ProviderEngine>,
 *   resolveFallbackOrder?: (request: {
 *     operation: "generate"|"stream"|"embed",
 *     providerId: string,
 *     fallbackProviderIds?: readonly string[]
 *   }) => readonly string[]
 * }} config
 */
export function createProviderGateway({
  middlewarePipeline,
  providers,
  resolveFallbackOrder,
}) {
  const providerEntries =
    providers instanceof Map ? [...providers.entries()] : Object.entries(providers);

  const providerMap = new Map(providerEntries);
  for (const [providerId, provider] of providerMap.entries()) {
    if (typeof providerId !== "string" || providerId.length === 0) {
      throw new RuntimeExecutionError("Provider id must be a non-empty string");
    }

    if (typeof provider !== "object" || provider === null) {
      throw new RuntimeExecutionError(`Provider adapter is invalid: ${providerId}`);
    }

    for (const operation of ["generate", "stream", "embed"]) {
      if (typeof provider[operation] !== "function") {
        throw new RuntimeExecutionError(
          `Provider adapter "${providerId}" is missing "${operation}"`,
          {
            providerId,
            operation,
          },
        );
      }
    }
  }

  /**
   * @param {{
   *   operation: "generate"|"stream"|"embed",
   *   validatedRequest: Record<string, unknown>,
   *   actionId: string,
   *   version: number,
   *   buildInput: (request: Record<string, unknown>, providerId: string) => Record<string, unknown>
   * }} params
   * @returns {Promise<Record<string, unknown>>}
   */
  const runWithFallback = async (params) => {
    const requestProviderId = /** @type {string} */ (params.validatedRequest.providerId);
    const requestFallbackProviderIds = /** @type {readonly string[]|undefined} */ (
      params.validatedRequest.fallbackProviderIds
    );

    const providerOrder = resolveFallbackOrder
      ? Object.freeze(
          [...resolveFallbackOrder({
            operation: params.operation,
            providerId: requestProviderId,
            fallbackProviderIds: requestFallbackProviderIds,
          })],
        )
      : resolveProviderOrder(providerMap, {
          providerId: requestProviderId,
          fallbackProviderIds: requestFallbackProviderIds,
        });

    if (!Array.isArray(providerOrder) || providerOrder.length === 0) {
      throw new RuntimeExecutionError(
        `Provider fallback order is empty for ${params.operation}`,
        {
          operation: params.operation,
          providerId: requestProviderId,
        },
      );
    }

    const attempts = [];
    for (let index = 0; index < providerOrder.length; index += 1) {
      const providerId = providerOrder[index];
      const provider = getProviderOrThrow(providerMap, providerId);
      const isLastProvider = index === providerOrder.length - 1;

      try {
        return await middlewarePipeline.run(
          {
            executionType: params.validatedRequest.executionType ?? "tool",
            traceId: params.validatedRequest.traceId,
            actionId: params.actionId,
            version: params.version,
            input: params.buildInput(params.validatedRequest, providerId),
          },
          async (validatedInput) => {
            const operation = provider[params.operation];
            return await operation(validatedInput);
          },
        );
      } catch (error) {
        const normalized = normalizeTypedError(error);
        attempts.push(
          Object.freeze({
            providerId,
            code: normalized.code,
            message: normalized.message,
          }),
        );

        if (isLastProvider || !shouldTryFallback(normalized)) {
          if (attempts.length === 1 && isLastProvider) {
            throw normalized;
          }

          throw new RuntimeExecutionError(
            `All providers failed for ${params.operation}`,
            {
              operation: params.operation,
              attempts: Object.freeze([...attempts]),
            },
          );
        }
      }
    }

    throw new RuntimeExecutionError(
      `No provider attempt was executed for ${params.operation}`,
      {
        operation: params.operation,
      },
    );
  };

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async generate(request) {
      const validatedRequest = validateRequest(
        request,
        generateRequestSchema.schemaId,
      );

      return runWithFallback({
        operation: "generate",
        validatedRequest,
        actionId: PROVIDER_ACTIONS.generate.actionId,
        version: PROVIDER_ACTIONS.generate.version,
        buildInput: (parsedRequest, providerId) => ({
          providerId,
          model: parsedRequest.model,
          prompt: parsedRequest.prompt,
        }),
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async stream(request) {
      const validatedRequest = validateRequest(
        request,
        streamRequestSchema.schemaId,
      );

      return runWithFallback({
        operation: "stream",
        validatedRequest,
        actionId: PROVIDER_ACTIONS.stream.actionId,
        version: PROVIDER_ACTIONS.stream.version,
        buildInput: (parsedRequest, providerId) => ({
          providerId,
          model: parsedRequest.model,
          prompt: parsedRequest.prompt,
        }),
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async embed(request) {
      const validatedRequest = validateRequest(
        request,
        embedRequestSchema.schemaId,
      );

      return runWithFallback({
        operation: "embed",
        validatedRequest,
        actionId: PROVIDER_ACTIONS.embed.actionId,
        version: PROVIDER_ACTIONS.embed.version,
        buildInput: (parsedRequest, providerId) => ({
          providerId,
          model: parsedRequest.model,
          text: parsedRequest.text,
        }),
      });
    },
  });
}
