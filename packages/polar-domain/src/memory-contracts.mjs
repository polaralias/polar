import {
  booleanField,
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
export const MEMORY_UPSERT_STATUSES = Object.freeze(["completed", "degraded"]);
export const MEMORY_COMPACT_STATUSES = Object.freeze(["completed", "degraded"]);
export const MEMORY_COMPACT_STRATEGIES = Object.freeze([
  "summarize",
  "deduplicate",
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
  upsert: Object.freeze({
    actionId: "memory.upsert",
    version: 1,
  }),
  compact: Object.freeze({
    actionId: "memory.compact",
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
    Object.freeze({
      actionId: MEMORY_ACTIONS.upsert.actionId,
      version: MEMORY_ACTIONS.upsert.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "memory.upsert.input",
        fields: {
          sessionId: stringField({ minLength: 1 }),
          userId: stringField({ minLength: 1 }),
          scope: enumField(MEMORY_SCOPES),
          memoryId: stringField({ minLength: 1, required: false }),
          record: jsonField(),
          metadata: jsonField({ required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "memory.upsert.output",
        fields: {
          status: enumField(MEMORY_UPSERT_STATUSES),
          sessionId: stringField({ minLength: 1 }),
          userId: stringField({ minLength: 1 }),
          scope: enumField(MEMORY_SCOPES),
          memoryId: stringField({ minLength: 1, required: false }),
          providerStatus: enumField(MEMORY_PROVIDER_STATUSES),
          created: booleanField({ required: false }),
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
      actionId: MEMORY_ACTIONS.compact.actionId,
      version: MEMORY_ACTIONS.compact.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "memory.compact.input",
        fields: {
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
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "memory.compact.output",
        fields: {
          status: enumField(MEMORY_COMPACT_STATUSES),
          sessionId: stringField({ minLength: 1 }),
          userId: stringField({ minLength: 1 }),
          scope: enumField(MEMORY_SCOPES),
          strategy: enumField(MEMORY_COMPACT_STRATEGIES),
          examinedCount: numberField({ min: 0 }),
          compactedCount: numberField({ min: 0 }),
          archivedCount: numberField({ min: 0 }),
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
