import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberArrayField,
  numberField,
  stringArrayField,
  stringField,
} from "./runtime-contracts.mjs";

const commonInputFields = Object.freeze({
  providerId: stringField({ minLength: 1 }),
  model: stringField({ minLength: 1 }),
  prompt: stringField({ minLength: 1 }),
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
  providerExtensions: jsonField({ required: false }),
});

export const PROVIDER_ACTIONS = Object.freeze({
  generate: Object.freeze({
    actionId: "provider.generate",
    version: 1,
  }),
  stream: Object.freeze({
    actionId: "provider.stream",
    version: 1,
  }),
  embed: Object.freeze({
    actionId: "provider.embed",
    version: 1,
  }),
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createProviderOperationContracts(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze([
    Object.freeze({
      actionId: PROVIDER_ACTIONS.generate.actionId,
      version: PROVIDER_ACTIONS.generate.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "provider.generate.input",
        fields: {
          ...commonInputFields,
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "provider.generate.output",
        fields: {
          providerId: stringField({ minLength: 1 }),
          model: stringField({ minLength: 1 }),
          text: stringField({ minLength: 1 }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 90_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: PROVIDER_ACTIONS.stream.actionId,
      version: PROVIDER_ACTIONS.stream.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "provider.stream.input",
        fields: {
          ...commonInputFields,
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "provider.stream.output",
        fields: {
          providerId: stringField({ minLength: 1 }),
          model: stringField({ minLength: 1 }),
          chunks: stringArrayField({ minItems: 1, itemMinLength: 1 }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 120_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: PROVIDER_ACTIONS.embed.actionId,
      version: PROVIDER_ACTIONS.embed.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "provider.embed.input",
        fields: {
          providerId: stringField({ minLength: 1 }),
          model: stringField({ minLength: 1 }),
          text: stringField({ minLength: 1 }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "provider.embed.output",
        fields: {
          providerId: stringField({ minLength: 1 }),
          model: stringField({ minLength: 1 }),
          vector: numberArrayField({ minItems: 1 }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 90_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
  ]);
}
