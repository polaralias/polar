import { createModelPolicyEngine } from "./model-policy-engine.mjs";
import {
  ContractValidationError,
  EXECUTION_TYPES,
  PolarTypedError,
  RuntimeExecutionError,
  PROVIDER_ACTIONS,
  createProviderOperationContracts,
  createStrictObjectSchema,
  booleanField,
  enumField,
  jsonField,
  numberField,
  stringArrayField,
  stringField,
} from "../../polar-domain/src/index.mjs";

const commonGatewayFields = {
  endpointMode: enumField(["responses", "chat", "anthropic_messages", "gemini_generate_content"], { required: false }),
  system: stringField({ minLength: 1, required: false }),
  messages: jsonField({ required: false }),
  maxOutputTokens: numberField({ required: false, min: 1 }),
  temperature: numberField({ required: false, min: 0 }),
  topP: numberField({ required: false, min: 0 }),
  topK: numberField({ required: false, min: 1 }),
  presencePenalty: numberField({ required: false }),
  frequencyPenalty: numberField({ required: false }),
  seed: numberField({ required: false }),
  stream: booleanField({ required: false }),
  tools: jsonField({ required: false }),
  toolChoice: jsonField({ required: false }),
  responseFormat: jsonField({ required: false }),
  reasoningEffort: stringField({ minLength: 1, required: false }),
  reasoningSummary: stringField({ minLength: 1, required: false }),
  verbosity: stringField({ minLength: 1, required: false }),
  thinkingEnabled: booleanField({ required: false }),
  thinkingBudget: numberField({ required: false, min: 1 }),
  thinkingLevel: stringField({ minLength: 1, required: false }),
  workspaceId: stringField({ minLength: 1, required: false }),
  providerExtensions: jsonField({ required: false }),
};

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
    modelLane: enumField(["local", "worker", "brain"], { required: false }),
    estimatedCostUsd: numberField({ min: 0, required: false }),
    ...commonGatewayFields,
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
    modelLane: enumField(["local", "worker", "brain"], { required: false }),
    estimatedCostUsd: numberField({ min: 0, required: false }),
    ...commonGatewayFields,
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
    modelLane: enumField(["local", "worker", "brain"], { required: false }),
    estimatedCostUsd: numberField({ min: 0, required: false }),
    workspaceId: stringField({ minLength: 1, required: false }),
  },
});

const listModelsRequestSchema = createStrictObjectSchema({
  schemaId: "provider.gateway.listModels.request",
  fields: {
    executionType: enumField(executionTypes, { required: false }),
    traceId: stringField({ minLength: 1, required: false }),
    providerId: stringField({ minLength: 1 }),
    fallbackProviderIds: stringArrayField({ minItems: 1, required: false }),
    workspaceId: stringField({ minLength: 1, required: false }),
  },
});

/**
 * @typedef {Object} ProviderOperationInput
 * @property {string} providerId
 * @property {string} model
 * @property {"responses"|"chat"|"anthropic_messages"|"gemini_generate_content"} [endpointMode]
 * @property {string} [system]
 * @property {unknown} [messages]
 * @property {number} [maxOutputTokens]
 * @property {number} [temperature]
 * @property {number} [topP]
 * @property {number} [topK]
 * @property {number} [presencePenalty]
 * @property {number} [frequencyPenalty]
 * @property {number} [seed]
 * @property {boolean} [stream]
 * @property {unknown} [tools]
 * @property {unknown} [toolChoice]
 * @property {unknown} [responseFormat]
 * @property {string} [reasoningEffort]
 * @property {string} [reasoningSummary]
 * @property {string} [verbosity]
 * @property {boolean} [thinkingEnabled]
 * @property {number} [thinkingBudget]
 * @property {string} [thinkingLevel]
 * @property {unknown} [providerExtensions]
 */

/**
 * @typedef {ProviderOperationInput & { prompt: string }} ProviderGenerateInput
 * @typedef {ProviderOperationInput & { prompt: string }} ProviderStreamInput
 * @typedef {ProviderOperationInput & { text: string }} ProviderEmbedInput
 */

/**
 * @typedef {Object} ProviderCapabilities
 * @property {boolean} [supportsResponsesEndpoint]
 * @property {boolean} [supportsChatCompletionsEndpoint]
 * @property {boolean} [supportsNativeThinkingControl]
 * @property {boolean} [supportsOpenAIReasoningObject]
 * @property {boolean} [supportsOpenAIVerbosity]
 * @property {boolean} [supportsTopK]
 * @property {boolean} [requiresVersionHeader]
 * @property {boolean} [supportsStatefulResponses]
 */

/**
 * @typedef {Object} ProviderEngine
 * @property {ProviderCapabilities} [capabilities]
 * @property {(input: ProviderGenerateInput) => Promise<Record<string, unknown>>} generate
 * @property {(input: ProviderStreamInput) => Promise<Record<string, unknown>>} stream
 * @property {(input: ProviderEmbedInput) => Promise<Record<string, unknown>>} embed
 * @property {(input: { providerId: string }) => Promise<Record<string, unknown>>} [listModels]
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
    [listModelsRequestSchema.schemaId]: listModelsRequestSchema,
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
 * @param {((id: string) => Promise<ProviderEngine|undefined>)|undefined} resolveProvider
 * @returns {Promise<ProviderEngine>}
 */
async function getProviderOrThrow(providers, providerId, resolveProvider) {
  let provider = providers.get(providerId);
  if (!provider && resolveProvider) {
    provider = await resolveProvider(providerId);
    if (provider) {
      providers.set(providerId, provider);
    }
  }

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
 * @param {((id: string) => Promise<ProviderEngine|undefined>)|undefined} resolveProvider
 * @returns {Promise<readonly string[]>}
 */
async function resolveProviderOrder(providers, request, resolveProvider) {
  const fallbackProviderIds = request.fallbackProviderIds ?? [];
  const orderedProviderIds = [request.providerId, ...fallbackProviderIds];
  const deduplicated = [];
  const seen = new Set();

  for (const providerId of orderedProviderIds) {
    if (seen.has(providerId)) {
      continue;
    }

    seen.add(providerId);
    await getProviderOrThrow(providers, providerId, resolveProvider);
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
 * @param {() => number} now
 * @returns {string}
 */
function createProviderTraceId(now) {
  return `trace-provider-${now().toString(16)}-${Math.random()
    .toString(16)
    .slice(2, 10)}`;
}

import { createContractKey } from "./contract-registry.mjs";

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
 *   providers?: Record<string, ProviderEngine>|Map<string, ProviderEngine>,
 *   resolveProvider?: (providerId: string) => Promise<ProviderEngine|undefined>,
 *   resolveFallbackOrder?: (request: {
 *     operation: "generate"|"stream"|"embed",
 *     providerId: string,
 *     fallbackProviderIds?: readonly string[]
 *   }) => readonly string[],
 *   usageTelemetryCollector?: {
 *     recordOperation: (event: {
 *       traceId: string,
 *       actionId: string,
 *       operation: "generate"|"stream"|"embed",
 *       executionType: "tool"|"handoff"|"automation"|"heartbeat",
 *       requestedProviderId: string,
 *       providerId: string,
 *       attemptedProviderIds: readonly string[],
 *       fallbackProviderIds?: readonly string[],
 *       fallbackUsed: boolean,
 *       status: "completed"|"failed",
 *       durationMs: number,
 *       model: string,
 *       modelLane?: "local"|"worker"|"brain",
 *       estimatedCostUsd?: number,
 *       errorCode?: string
 *     }) => Promise<void>|void
 *   },
 *   now?: () => number
 * }} config
 */
export function createProviderGateway({
  registry,
  middlewarePipeline,
  telemetry,
  modelPolicyEngine = createModelPolicyEngine(),
  providers = new Map(),
  resolveProvider,
  resolveFallbackOrder,
  usageTelemetryCollector = { async recordOperation() { } },
  now = Date.now,
  cooldownDurationMs = 60_000,
}) {
  const providerEntries =
    providers instanceof Map ? [...providers.entries()] : Object.entries(providers);

  const providerMap = new Map(providerEntries);
  /** @type {Map<string, number>} */
  const cooldownEntries = new Map();
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

  if (
    typeof usageTelemetryCollector !== "object" ||
    usageTelemetryCollector === null ||
    typeof usageTelemetryCollector.recordOperation !== "function"
  ) {
    throw new RuntimeExecutionError(
      "usageTelemetryCollector must expose recordOperation(event)",
    );
  }

  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }

  /**
   * @param {{
   *   operation: "generate"|"stream"|"embed",
   *   validatedRequest: Record<string, unknown>,
   *   actionId: string,
   *   version: number,
   *   buildInput: (request: Record<string, unknown>, providerId: string) => Promise<Record<string, unknown>>|Record<string, unknown>
   * }} params
   * @returns {Promise<Record<string, unknown>>}
   */
  const runWithFallback = async (params) => {
    const requestProviderId = /** @type {string} */ (params.validatedRequest.providerId);
    const requestFallbackProviderIds = /** @type {readonly string[]|undefined} */ (
      params.validatedRequest.fallbackProviderIds
    );
    const executionType =
      /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
        params.validatedRequest.executionType
      ) ?? "tool";
    const traceId =
      /** @type {string|undefined} */ (params.validatedRequest.traceId) ??
      createProviderTraceId(now);
    const operationStartedAtMs = now();

    const providerOrder = resolveFallbackOrder
      ? Object.freeze(
        [...resolveFallbackOrder({
          operation: params.operation,
          providerId: requestProviderId,
          fallbackProviderIds: requestFallbackProviderIds,
        })],
      )
      : await resolveProviderOrder(providerMap, {
        providerId: requestProviderId,
        fallbackProviderIds: requestFallbackProviderIds,
      }, resolveProvider);

    if (!Array.isArray(providerOrder) || providerOrder.length === 0) {
      throw new RuntimeExecutionError(
        `Provider fallback order is empty for ${params.operation}`,
        {
          operation: params.operation,
          providerId: requestProviderId,
        },
      );
    }

    const cooldownTimestamp = now();
    const activeProviderOrder = providerOrder.filter((id) => {
      const cooldownUntil = cooldownEntries.get(id);
      if (cooldownUntil !== undefined && cooldownTimestamp < cooldownUntil) {
        return false;
      }
      return true;
    });

    // If all providers are in cooldown, use the full list as a last-resort recovery
    const effectiveOrder = activeProviderOrder.length > 0 ? activeProviderOrder : providerOrder;

    const fallbackProviderIds = requestFallbackProviderIds
      ? Object.freeze([...requestFallbackProviderIds])
      : undefined;

    const attempts = [];
    for (let index = 0; index < effectiveOrder.length; index += 1) {
      const providerId = effectiveOrder[index];
      const provider = await getProviderOrThrow(providerMap, providerId, resolveProvider);
      const isLastProvider = index === effectiveOrder.length - 1;

      try {
        const output = await middlewarePipeline.run(
          {
            executionType,
            traceId,
            actionId: params.actionId,
            version: params.version,
            input: await params.buildInput(params.validatedRequest, providerId),
          },
          async (validatedInput) => {
            const operation = provider[params.operation];
            if (typeof operation !== "function") {
              throw new RuntimeExecutionError(`Operation ${params.operation} not supported by this provider setup`, { providerId });
            }
            return await operation(validatedInput);
          },
        );

        // Success on this provider -> clear its cooldown if any
        cooldownEntries.delete(providerId);

        const attemptedProviderIds = Object.freeze([
          ...attempts.map((attempt) => attempt.providerId),
          providerId,
        ]);
        const telemetryEvent = {
          traceId,
          actionId: params.actionId,
          operation: params.operation,
          executionType,
          requestedProviderId: requestProviderId,
          providerId,
          attemptedProviderIds,
          fallbackUsed: providerId !== requestProviderId || attempts.length > 0,
          status: "completed",
          durationMs: Math.max(0, now() - operationStartedAtMs),
          model: /** @type {string|undefined} */ (params.validatedRequest.model) || "N/A",
        };

        if (fallbackProviderIds !== undefined) {
          telemetryEvent.fallbackProviderIds = fallbackProviderIds;
        }
        if (params.validatedRequest.modelLane !== undefined) {
          telemetryEvent.modelLane =
            /** @type {"local"|"worker"|"brain"} */ (
              params.validatedRequest.modelLane
            );
        }
        if (params.validatedRequest.estimatedCostUsd !== undefined) {
          telemetryEvent.estimatedCostUsd =
            /** @type {number} */ (params.validatedRequest.estimatedCostUsd);
        }

        await usageTelemetryCollector.recordOperation(telemetryEvent);

        return output;
      } catch (error) {
        const normalized = normalizeTypedError(error);
        attempts.push(
          Object.freeze({
            providerId,
            code: normalized.code,
            message: normalized.message,
          }),
        );

        // Failure -> put in cooldown unless it's a validation error
        if (shouldTryFallback(normalized)) {
          cooldownEntries.set(providerId, now() + cooldownDurationMs);
        }

        if (isLastProvider || !shouldTryFallback(normalized)) {
          const terminalError =
            attempts.length === 1 && isLastProvider
              ? normalized
              : new RuntimeExecutionError(
                `All providers failed for ${params.operation}`,
                {
                  operation: params.operation,
                  attempts: Object.freeze([...attempts]),
                },
              );
          const telemetryEvent = {
            traceId,
            actionId: params.actionId,
            operation: params.operation,
            executionType,
            requestedProviderId: requestProviderId,
            providerId,
            attemptedProviderIds: Object.freeze([
              ...attempts.map((attempt) => attempt.providerId),
            ]),
            fallbackUsed: providerId !== requestProviderId || attempts.length > 1,
            status: "failed",
            durationMs: Math.max(0, now() - operationStartedAtMs),
            model: /** @type {string|undefined} */ (params.validatedRequest.model) || "N/A",
            errorCode: terminalError.code,
          };

          if (fallbackProviderIds !== undefined) {
            telemetryEvent.fallbackProviderIds = fallbackProviderIds;
          }
          if (params.validatedRequest.modelLane !== undefined) {
            telemetryEvent.modelLane =
              /** @type {"local"|"worker"|"brain"} */ (
                params.validatedRequest.modelLane
              );
          }
          if (params.validatedRequest.estimatedCostUsd !== undefined) {
            telemetryEvent.estimatedCostUsd =
              /** @type {number} */ (params.validatedRequest.estimatedCostUsd);
          }

          await usageTelemetryCollector.recordOperation(telemetryEvent);
          throw terminalError;
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

      const resolved = modelPolicyEngine.resolve(validatedRequest);
      const effectiveRequest = {
        ...validatedRequest,
        providerId: resolved.providerId,
        model: resolved.model,
      };

      return runWithFallback({
        operation: "generate",
        validatedRequest: effectiveRequest,
        actionId: PROVIDER_ACTIONS.generate.actionId,
        version: PROVIDER_ACTIONS.generate.version,
        buildInput: async (parsedRequest, providerId) => {
          const provider = await getProviderOrThrow(providerMap, providerId, resolveProvider);
          const caps = provider.capabilities || {};
          const input = {
            providerId,
            model: parsedRequest.model,
            prompt: parsedRequest.prompt,
          };
          for (const key of Object.keys(commonGatewayFields)) {
            if (parsedRequest[key] !== undefined) {
              if (key === "reasoningEffort" && !caps.supportsOpenAIReasoningObject) continue;
              if (key === "reasoningSummary" && !caps.supportsOpenAIReasoningObject) continue;
              if (key === "verbosity" && !caps.supportsOpenAIVerbosity) continue;
              if (key === "thinkingEnabled" && !caps.supportsNativeThinkingControl) continue;
              if (key === "thinkingBudget" && !caps.supportsNativeThinkingControl) continue;
              if (key === "thinkingLevel" && !caps.supportsNativeThinkingControl) continue;
              if (key === "topK" && !caps.supportsTopK) continue;
              if (key === "endpointMode") {
                // BUG-028 fix: Always pass endpointMode through as a routing hint
                input[key] = parsedRequest[key];
                continue;
              }
              input[key] = parsedRequest[key];
            }
          }
          if (parsedRequest.estimatedCostUsd !== undefined) {
            input.estimatedCostUsd = parsedRequest.estimatedCostUsd;
          }
          return input;
        },
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

      const resolved = modelPolicyEngine.resolve(validatedRequest);
      const effectiveRequest = {
        ...validatedRequest,
        providerId: resolved.providerId,
        model: resolved.model,
      };

      return runWithFallback({
        operation: "stream",
        validatedRequest: effectiveRequest,
        actionId: PROVIDER_ACTIONS.stream.actionId,
        version: PROVIDER_ACTIONS.stream.version,
        buildInput: async (parsedRequest, providerId) => {
          const provider = await getProviderOrThrow(providerMap, providerId, resolveProvider);
          const caps = provider.capabilities || {};
          const input = {
            providerId,
            model: parsedRequest.model,
            prompt: parsedRequest.prompt,
          };
          for (const key of Object.keys(commonGatewayFields)) {
            if (parsedRequest[key] !== undefined) {
              if (key === "reasoningEffort" && !caps.supportsOpenAIReasoningObject) continue;
              if (key === "reasoningSummary" && !caps.supportsOpenAIReasoningObject) continue;
              if (key === "verbosity" && !caps.supportsOpenAIVerbosity) continue;
              if (key === "thinkingEnabled" && !caps.supportsNativeThinkingControl) continue;
              if (key === "thinkingBudget" && !caps.supportsNativeThinkingControl) continue;
              if (key === "thinkingLevel" && !caps.supportsNativeThinkingControl) continue;
              if (key === "topK" && !caps.supportsTopK) continue;
              if (key === "endpointMode") {
                // BUG-028 fix: Always pass endpointMode through as a routing hint
                input[key] = parsedRequest[key];
                continue;
              }
              input[key] = parsedRequest[key];
            }
          }
          if (parsedRequest.estimatedCostUsd !== undefined) {
            input.estimatedCostUsd = parsedRequest.estimatedCostUsd;
          }
          return input;
        },
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

      const resolved = modelPolicyEngine.resolve(validatedRequest);
      const effectiveRequest = {
        ...validatedRequest,
        providerId: resolved.providerId,
        model: resolved.model,
      };

      return runWithFallback({
        operation: "embed",
        validatedRequest: effectiveRequest,
        actionId: PROVIDER_ACTIONS.embed.actionId,
        version: PROVIDER_ACTIONS.embed.version,
        buildInput: (parsedRequest, providerId) => {
          const input = {
            providerId,
            model: parsedRequest.model,
            text: parsedRequest.text,
          };
          if (parsedRequest.workspaceId !== undefined) input.workspaceId = parsedRequest.workspaceId;
          if (parsedRequest.estimatedCostUsd !== undefined) input.estimatedCostUsd = parsedRequest.estimatedCostUsd;
          return input;
        },
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async listModels(request) {
      const validatedRequest = validateRequest(
        request,
        listModelsRequestSchema.schemaId,
      );

      return runWithFallback({
        operation: "listModels",
        validatedRequest,
        actionId: PROVIDER_ACTIONS.listModels.actionId,
        version: PROVIDER_ACTIONS.listModels.version,
        buildInput: (parsedRequest, providerId) => ({
          providerId,
        }),
      });
    },
  });
}
