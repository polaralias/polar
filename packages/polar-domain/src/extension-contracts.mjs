import {
  createStrictObjectSchema,
  enumField,
  jsonField,
  stringArrayField,
  stringField,
} from "./runtime-contracts.mjs";

export const EXTENSION_TYPES = Object.freeze(["skill", "mcp", "plugin"]);

export const EXTENSION_TRUST_LEVELS = Object.freeze([
  "trusted",
  "reviewed",
  "sandboxed",
  "blocked",
]);

export const EXTENSION_LIFECYCLE_OPERATIONS = Object.freeze([
  "install",
  "enable",
  "disable",
  "upgrade",
  "rollback",
  "remove",
  "retrust",
]);

export const EXTENSION_LIFECYCLE_STATES = Object.freeze([
  "pending_install",
  "installed",
  "enabled",
  "disabled",
  "removed",
  "blocked",
]);

export const CAPABILITY_RISK_LEVELS = Object.freeze(["read", "write", "destructive", "unknown"]);
export const CAPABILITY_SIDE_EFFECTS = Object.freeze(["none", "internal", "external", "unknown"]);
export const CAPABILITY_DATA_EGRESS = Object.freeze(["none", "network", "unknown"]);

export const EXTENSION_LIFECYCLE_ACTION = Object.freeze({
  actionId: "extension.lifecycle.apply",
  version: 1,
});

export const EXTENSION_EXECUTE_ACTION = Object.freeze({
  actionId: "extension.operation.execute",
  version: 1,
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createExtensionLifecycleContract(options = {}) {
  const { trustClass = "native", riskClass = "high" } = options;

  return Object.freeze({
    actionId: EXTENSION_LIFECYCLE_ACTION.actionId,
    version: EXTENSION_LIFECYCLE_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "extension.lifecycle.apply.input",
      fields: {
        extensionId: stringField({ minLength: 1 }),
        extensionType: enumField(EXTENSION_TYPES),
        operation: enumField(EXTENSION_LIFECYCLE_OPERATIONS),
        trustLevel: enumField(EXTENSION_TRUST_LEVELS, { required: false }),
        sourceUri: stringField({ minLength: 1, required: false }),
        requestedPermissions: stringArrayField({
          minItems: 0,
          required: false,
        }),
        approvalTicket: stringField({ minLength: 1, required: false }),
        capabilities: jsonField({ required: false }),
        metadata: jsonField({ required: false }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "extension.lifecycle.apply.output",
      fields: {
        status: enumField(["applied", "rejected"]),
        extensionId: stringField({ minLength: 1 }),
        extensionType: enumField(EXTENSION_TYPES),
        operation: enumField(EXTENSION_LIFECYCLE_OPERATIONS),
        trustLevel: enumField(EXTENSION_TRUST_LEVELS),
        lifecycleState: enumField(EXTENSION_LIFECYCLE_STATES),
        permissionDelta: jsonField(),
        reason: stringField({ minLength: 1, required: false }),
      },
    }),
    riskClass,
    trustClass,
    timeoutMs: 30_000,
    retryPolicy: {
      maxAttempts: 1,
    },
  });
}

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createExtensionExecuteContract(options = {}) {
  const { trustClass = "native", riskClass = "high" } = options;

  return Object.freeze({
    actionId: EXTENSION_EXECUTE_ACTION.actionId,
    version: EXTENSION_EXECUTE_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "extension.operation.execute.input",
      fields: {
        extensionId: stringField({ minLength: 1 }),
        extensionType: enumField(EXTENSION_TYPES),
        capabilityId: stringField({ minLength: 1 }),
        sessionId: stringField({ minLength: 1 }),
        userId: stringField({ minLength: 1 }),
        trustLevel: enumField(EXTENSION_TRUST_LEVELS, { required: false }),
        capabilityScope: jsonField(),
        input: jsonField(),
        metadata: jsonField({ required: false }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "extension.operation.execute.output",
      fields: {
        status: enumField(["completed", "failed"]),
        extensionId: stringField({ minLength: 1 }),
        extensionType: enumField(EXTENSION_TYPES),
        capabilityId: stringField({ minLength: 1 }),
        trustLevel: enumField(EXTENSION_TRUST_LEVELS),
        output: jsonField({ required: false }),
        error: jsonField({ required: false }),
      },
    }),
    riskClass,
    trustClass,
    timeoutMs: 30_000,
    retryPolicy: {
      maxAttempts: 1,
    },
  });
}

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createExtensionContracts(options = {}) {
  return Object.freeze([
    createExtensionLifecycleContract(options),
    createExtensionExecuteContract(options),
  ]);
}
