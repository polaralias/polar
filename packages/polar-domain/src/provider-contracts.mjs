import {
  createStrictObjectSchema,
  numberArrayField,
  stringArrayField,
  stringField,
} from "./runtime-contracts.mjs";

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
          providerId: stringField({ minLength: 1 }),
          model: stringField({ minLength: 1 }),
          prompt: stringField({ minLength: 1 }),
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
          providerId: stringField({ minLength: 1 }),
          model: stringField({ minLength: 1 }),
          prompt: stringField({ minLength: 1 }),
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
