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

export const PLUGIN_INSTALLER_ACTION = Object.freeze({
  actionId: "plugin.install.from-descriptor",
  version: 1,
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createPluginInstallerContract(options = {}) {
  const { trustClass = "native", riskClass = "high" } = options;

  return Object.freeze({
    actionId: PLUGIN_INSTALLER_ACTION.actionId,
    version: PLUGIN_INSTALLER_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "plugin.install.from-descriptor.input",
      fields: {
        sourceUri: stringField({ minLength: 1 }),
        pluginDescriptor: jsonField(),
        expectedDescriptorHash: stringField({ minLength: 1, required: false }),
        requestedTrustLevel: enumField(EXTENSION_TRUST_LEVELS, {
          required: false,
        }),
        authBindings: jsonField({ required: false }),
        approvalTicket: stringField({ minLength: 1, required: false }),
        enableAfterInstall: booleanField({ required: false }),
        metadata: jsonField({ required: false }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "plugin.install.from-descriptor.output",
      fields: {
        status: enumField(["applied", "rejected"]),
        extensionId: stringField({ minLength: 1 }),
        operation: enumField(["install", "upgrade"]),
        trustLevel: enumField(EXTENSION_TRUST_LEVELS),
        lifecycleStatus: enumField(["applied", "rejected"]),
        lifecycleState: enumField(EXTENSION_LIFECYCLE_STATES),
        permissionDelta: jsonField(),
        capabilityIds: stringArrayField({ minItems: 1 }),
        descriptorHash: stringField({ minLength: 1 }),
        authBinding: jsonField(),
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
