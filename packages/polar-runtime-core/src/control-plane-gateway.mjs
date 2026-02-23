import {
  CONTROL_PLANE_ACTIONS,
  CONTROL_PLANE_RESOURCE_TYPES,
  ContractValidationError,
  RuntimeExecutionError,
  booleanField,
  createControlPlaneContracts,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "../../polar-domain/src/index.mjs";

const upsertRequestSchema = createStrictObjectSchema({
  schemaId: "control-plane.gateway.upsert.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    resourceType: enumField(CONTROL_PLANE_RESOURCE_TYPES),
    resourceId: stringField({ minLength: 1 }),
    config: jsonField(),
    expectedVersion: numberField({ min: 0, required: false }),
    actorId: stringField({ minLength: 1, required: false }),
    metadata: jsonField({ required: false }),
  },
});

const getRequestSchema = createStrictObjectSchema({
  schemaId: "control-plane.gateway.get.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    resourceType: enumField(CONTROL_PLANE_RESOURCE_TYPES),
    resourceId: stringField({ minLength: 1 }),
  },
});

const listRequestSchema = createStrictObjectSchema({
  schemaId: "control-plane.gateway.list.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    resourceType: enumField(CONTROL_PLANE_RESOURCE_TYPES),
    cursor: stringField({ minLength: 1, required: false }),
    limit: numberField({ min: 1, max: 100, required: false }),
    includeValues: booleanField({ required: false }),
  },
});

const storedRecordSchema = createStrictObjectSchema({
  schemaId: "control-plane.gateway.stored-record",
  fields: {
    resourceType: enumField(CONTROL_PLANE_RESOURCE_TYPES),
    resourceId: stringField({ minLength: 1 }),
    version: numberField({ min: 1 }),
    config: jsonField(),
    updatedAtMs: numberField({ min: 0 }),
    updatedBy: stringField({ minLength: 1, required: false }),
  },
});

/**
 * @param {unknown} value
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function validateRequest(value, schemaId) {
  const schema = {
    [upsertRequestSchema.schemaId]: upsertRequestSchema,
    [getRequestSchema.schemaId]: getRequestSchema,
    [listRequestSchema.schemaId]: listRequestSchema,
    [storedRecordSchema.schemaId]: storedRecordSchema,
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
 * @param {"profile"|"channel"|"extension"|"policy"|"automation"} resourceType
 * @param {string} resourceId
 * @returns {string}
 */
function createResourceKey(resourceType, resourceId) {
  return `${resourceType}:${resourceId}`;
}

/**
 * @param {string|undefined} cursor
 * @returns {number}
 */
function parseCursor(cursor) {
  if (cursor === undefined) {
    return 0;
  }

  if (!/^\d+$/.test(cursor)) {
    throw new ContractValidationError(
      "Invalid control-plane list cursor",
      {
        schemaId: listRequestSchema.schemaId,
        errors: [
          `${listRequestSchema.schemaId}.cursor must be an unsigned integer string`,
        ],
      },
    );
  }

  const offset = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ContractValidationError(
      "Invalid control-plane list cursor",
      {
        schemaId: listRequestSchema.schemaId,
        errors: [
          `${listRequestSchema.schemaId}.cursor must be a safe non-negative integer`,
        ],
      },
    );
  }

  return offset;
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerControlPlaneContracts(contractRegistry) {
  for (const contract of createControlPlaneContracts()) {
    if (!contractRegistry.has(contract.actionId, contract.version)) {
      contractRegistry.register(contract);
    }
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   initialRecords?: readonly Record<string, unknown>[],
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat",
 *   now?: () => number
 * }} config
 */
export function createControlPlaneGateway({
  middlewarePipeline,
  initialRecords = [],
  defaultExecutionType = "tool",
  now = () => Date.now(),
}) {
  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const records = new Map();
  for (const initialRecord of initialRecords) {
    const validated = validateRequest(
      initialRecord,
      storedRecordSchema.schemaId,
    );
    const key = createResourceKey(
      /** @type {"profile"|"channel"|"extension"|"policy"|"automation"} */ (
        validated.resourceType
      ),
      /** @type {string} */ (validated.resourceId),
    );
    records.set(key, validated);
  }

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async upsertConfig(request) {
      const parsed = validateRequest(request, upsertRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: CONTROL_PLANE_ACTIONS.upsert.actionId,
          version: CONTROL_PLANE_ACTIONS.upsert.version,
          input: (() => {
            const input = {
              resourceType: parsed.resourceType,
              resourceId: parsed.resourceId,
              config: parsed.config,
            };
            if (parsed.expectedVersion !== undefined) {
              input.expectedVersion = parsed.expectedVersion;
            }
            if (parsed.actorId !== undefined) {
              input.actorId = parsed.actorId;
            }
            if (parsed.metadata !== undefined) {
              input.metadata = parsed.metadata;
            }
            return input;
          })(),
        },
        async (input) => {
          const resourceType = /** @type {"profile"|"channel"|"extension"|"policy"|"automation"} */ (
            input.resourceType
          );
          const resourceId = /** @type {string} */ (input.resourceId);
          const key = createResourceKey(resourceType, resourceId);
          const current = records.get(key);
          const previousVersion =
            /** @type {number|undefined} */ (current?.version) ?? 0;
          const expectedVersion = /** @type {number|undefined} */ (
            input.expectedVersion
          );

          if (
            expectedVersion !== undefined &&
            expectedVersion !== previousVersion
          ) {
            return {
              status: "rejected",
              resourceType,
              resourceId,
              version: previousVersion,
              previousVersion,
              reason: "Version conflict",
            };
          }

          const nextVersion = previousVersion + 1;
          const stored = validateRequest(
            {
              resourceType,
              resourceId,
              version: nextVersion,
              config: input.config,
              updatedAtMs: now(),
              ...(input.actorId !== undefined
                ? {
                    updatedBy: input.actorId,
                  }
                : {}),
            },
            storedRecordSchema.schemaId,
          );
          records.set(key, stored);

          return {
            status: "applied",
            resourceType,
            resourceId,
            version: nextVersion,
            previousVersion,
            config: input.config,
          };
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async getConfig(request) {
      const parsed = validateRequest(request, getRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: CONTROL_PLANE_ACTIONS.get.actionId,
          version: CONTROL_PLANE_ACTIONS.get.version,
          input: {
            resourceType: parsed.resourceType,
            resourceId: parsed.resourceId,
          },
        },
        async (input) => {
          const resourceType = /** @type {"profile"|"channel"|"extension"|"policy"|"automation"} */ (
            input.resourceType
          );
          const resourceId = /** @type {string} */ (input.resourceId);
          const key = createResourceKey(resourceType, resourceId);
          const record = records.get(key);
          if (!record) {
            return {
              status: "not_found",
              resourceType,
              resourceId,
              version: 0,
            };
          }

          return {
            status: "found",
            resourceType,
            resourceId,
            version: record.version,
            config: record.config,
          };
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async listConfigs(request) {
      const parsed = validateRequest(request, listRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: CONTROL_PLANE_ACTIONS.list.actionId,
          version: CONTROL_PLANE_ACTIONS.list.version,
          input: {
            resourceType: parsed.resourceType,
            ...(parsed.cursor !== undefined ? { cursor: parsed.cursor } : {}),
            ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
            ...(parsed.includeValues !== undefined
              ? { includeValues: parsed.includeValues }
              : {}),
          },
        },
        async (input) => {
          const resourceType = /** @type {"profile"|"channel"|"extension"|"policy"|"automation"} */ (
            input.resourceType
          );
          const includeValues = input.includeValues === true;
          const limit = /** @type {number|undefined} */ (input.limit) ?? 50;
          const offset = parseCursor(
            /** @type {string|undefined} */ (input.cursor),
          );

          const typedRecords = [...records.values()]
            .filter((record) => record.resourceType === resourceType)
            .sort((left, right) => left.resourceId.localeCompare(right.resourceId));
          const totalCount = typedRecords.length;
          const pagedRecords = typedRecords.slice(offset, offset + limit);
          const nextOffset = offset + limit;

          const items = Object.freeze(
            pagedRecords.map((record) =>
              Object.freeze({
                resourceId: record.resourceId,
                version: record.version,
                ...(includeValues ? { config: record.config } : {}),
              }),
            ),
          );

          return {
            status: "ok",
            resourceType,
            items,
            totalCount,
            ...(nextOffset < totalCount
              ? {
                  nextCursor: String(nextOffset),
                }
              : {}),
          };
        },
      );
    },

    /**
     * @param {"profile"|"channel"|"extension"|"policy"|"automation"} resourceType
     * @param {string} resourceId
     * @returns {Record<string, unknown>|undefined}
     */
    readConfigRecord(resourceType, resourceId) {
      if (
        !CONTROL_PLANE_RESOURCE_TYPES.includes(resourceType) ||
        typeof resourceId !== "string" ||
        resourceId.length === 0
      ) {
        throw new RuntimeExecutionError(
          "readConfigRecord requires valid resourceType and resourceId",
          {
            resourceType,
            resourceId,
          },
        );
      }

      const key = createResourceKey(resourceType, resourceId);
      const record = records.get(key);
      if (!record) {
        return undefined;
      }

      return Object.freeze({ ...record });
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listStoredRecords() {
      return Object.freeze(
        [...records.values()]
          .map((record) => Object.freeze({ ...record }))
          .sort((left, right) => {
            const leftKey = createResourceKey(left.resourceType, left.resourceId);
            const rightKey = createResourceKey(right.resourceType, right.resourceId);
            return leftKey.localeCompare(rightKey);
          }),
      );
    },
  });
}
