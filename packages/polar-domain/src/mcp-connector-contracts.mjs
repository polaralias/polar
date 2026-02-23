import {
  EXTENSION_LIFECYCLE_STATES,
  EXTENSION_TRUST_LEVELS,
} from "./extension-contracts.mjs";
import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  stringArrayField,
  stringField,
} from "./runtime-contracts.mjs";

export const MCP_CONNECTOR_ACTION = Object.freeze({
  actionId: "mcp.connector.sync",
  version: 1,
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createMcpConnectorContract(options = {}) {
  const { trustClass = "native", riskClass = "high" } = options;

  return Object.freeze({
    actionId: MCP_CONNECTOR_ACTION.actionId,
    version: MCP_CONNECTOR_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "mcp.connector.sync.input",
      fields: {
        sourceUri: stringField({ minLength: 1 }),
        serverId: stringField({ minLength: 1 }),
        connectionConfig: jsonField({ required: false }),
        expectedCatalogHash: stringField({ minLength: 1, required: false }),
        expectedToolIds: stringArrayField({ minItems: 0, required: false }),
        requestedTrustLevel: enumField(EXTENSION_TRUST_LEVELS, {
          required: false,
        }),
        approvalTicket: stringField({ minLength: 1, required: false }),
        enableAfterSync: booleanField({ required: false }),
        metadata: jsonField({ required: false }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "mcp.connector.sync.output",
      fields: {
        status: enumField(["applied", "rejected"]),
        extensionId: stringField({ minLength: 1 }),
        operation: enumField(["install", "upgrade"]),
        trustLevel: enumField(EXTENSION_TRUST_LEVELS),
        lifecycleStatus: enumField(["applied", "rejected"]),
        lifecycleState: enumField(EXTENSION_LIFECYCLE_STATES),
        permissionDelta: jsonField(),
        capabilityIds: stringArrayField({ minItems: 0 }),
        catalogHash: stringField({ minLength: 1 }),
        health: jsonField(),
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
