import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "./runtime-contracts.mjs";

export const CONTROL_PLANE_RESOURCE_TYPES = Object.freeze([
  "profile",
  "channel",
  "extension",
  "policy",
  "automation",
  "provider",
]);

export const CONTROL_PLANE_UPSERT_STATUSES = Object.freeze([
  "applied",
  "rejected",
]);
export const CONTROL_PLANE_GET_STATUSES = Object.freeze(["found", "not_found"]);
export const CONTROL_PLANE_LIST_STATUSES = Object.freeze(["ok"]);

export const CONTROL_PLANE_ACTIONS = Object.freeze({
  upsert: Object.freeze({
    actionId: "control-plane.config.upsert",
    version: 1,
  }),
  get: Object.freeze({
    actionId: "control-plane.config.get",
    version: 1,
  }),
  list: Object.freeze({
    actionId: "control-plane.config.list",
    version: 1,
  }),
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createControlPlaneContracts(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze([
    Object.freeze({
      actionId: CONTROL_PLANE_ACTIONS.upsert.actionId,
      version: CONTROL_PLANE_ACTIONS.upsert.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "control-plane.config.upsert.input",
        fields: {
          resourceType: enumField(CONTROL_PLANE_RESOURCE_TYPES),
          resourceId: stringField({ minLength: 1 }),
          config: jsonField(),
          expectedVersion: numberField({ min: 0, required: false }),
          actorId: stringField({ minLength: 1, required: false }),
          metadata: jsonField({ required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "control-plane.config.upsert.output",
        fields: {
          status: enumField(CONTROL_PLANE_UPSERT_STATUSES),
          resourceType: enumField(CONTROL_PLANE_RESOURCE_TYPES),
          resourceId: stringField({ minLength: 1 }),
          version: numberField({ min: 0 }),
          previousVersion: numberField({ min: 0 }),
          config: jsonField({ required: false }),
          reason: stringField({ minLength: 1, required: false }),
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
      actionId: CONTROL_PLANE_ACTIONS.get.actionId,
      version: CONTROL_PLANE_ACTIONS.get.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "control-plane.config.get.input",
        fields: {
          resourceType: enumField(CONTROL_PLANE_RESOURCE_TYPES),
          resourceId: stringField({ minLength: 1 }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "control-plane.config.get.output",
        fields: {
          status: enumField(CONTROL_PLANE_GET_STATUSES),
          resourceType: enumField(CONTROL_PLANE_RESOURCE_TYPES),
          resourceId: stringField({ minLength: 1 }),
          version: numberField({ min: 0 }),
          config: jsonField({ required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 10_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: CONTROL_PLANE_ACTIONS.list.actionId,
      version: CONTROL_PLANE_ACTIONS.list.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "control-plane.config.list.input",
        fields: {
          resourceType: enumField(CONTROL_PLANE_RESOURCE_TYPES),
          cursor: stringField({ minLength: 1, required: false }),
          limit: numberField({ min: 1, max: 100, required: false }),
          includeValues: booleanField({ required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "control-plane.config.list.output",
        fields: {
          status: enumField(CONTROL_PLANE_LIST_STATUSES),
          resourceType: enumField(CONTROL_PLANE_RESOURCE_TYPES),
          items: jsonField(),
          totalCount: numberField({ min: 0 }),
          nextCursor: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 10_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
  ]);
}
