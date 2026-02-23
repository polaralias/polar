import {
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "./runtime-contracts.mjs";

export const MEMORY_SCOPES = Object.freeze(["session", "workspace", "global"]);
export const MEMORY_PROVIDER_STATUSES = Object.freeze([
  "available",
  "unavailable",
]);
export const MEMORY_SEARCH_STATUSES = Object.freeze(["completed", "degraded"]);
export const MEMORY_GET_STATUSES = Object.freeze([
  "completed",
  "not_found",
  "degraded",
]);

export const MEMORY_ACTIONS = Object.freeze({
  search: Object.freeze({
    actionId: "memory.search",
    version: 1,
  }),
  get: Object.freeze({
    actionId: "memory.get",
    version: 1,
  }),
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createMemoryContracts(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze([
    Object.freeze({
      actionId: MEMORY_ACTIONS.search.actionId,
      version: MEMORY_ACTIONS.search.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "memory.search.input",
        fields: {
          sessionId: stringField({ minLength: 1 }),
          userId: stringField({ minLength: 1 }),
          scope: enumField(MEMORY_SCOPES),
          query: stringField({ minLength: 1 }),
          limit: numberField({ min: 1, max: 100, required: false }),
          cursor: stringField({ minLength: 1, required: false }),
          filters: jsonField({ required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "memory.search.output",
        fields: {
          status: enumField(MEMORY_SEARCH_STATUSES),
          sessionId: stringField({ minLength: 1 }),
          userId: stringField({ minLength: 1 }),
          scope: enumField(MEMORY_SCOPES),
          query: stringField({ minLength: 1 }),
          resultCount: numberField({ min: 0 }),
          records: jsonField(),
          nextCursor: stringField({ minLength: 1, required: false }),
          providerStatus: enumField(MEMORY_PROVIDER_STATUSES),
          degradedReason: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 20_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: MEMORY_ACTIONS.get.actionId,
      version: MEMORY_ACTIONS.get.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "memory.get.input",
        fields: {
          sessionId: stringField({ minLength: 1 }),
          userId: stringField({ minLength: 1 }),
          scope: enumField(MEMORY_SCOPES),
          memoryId: stringField({ minLength: 1 }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "memory.get.output",
        fields: {
          status: enumField(MEMORY_GET_STATUSES),
          sessionId: stringField({ minLength: 1 }),
          userId: stringField({ minLength: 1 }),
          scope: enumField(MEMORY_SCOPES),
          memoryId: stringField({ minLength: 1 }),
          record: jsonField({ required: false }),
          providerStatus: enumField(MEMORY_PROVIDER_STATUSES),
          degradedReason: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 20_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
  ]);
}
