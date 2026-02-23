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

export const SKILL_INSTALLER_ACTION = Object.freeze({
  actionId: "skill.install.from-manifest",
  version: 1,
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createSkillInstallerContract(options = {}) {
  const { trustClass = "native", riskClass = "high" } = options;

  return Object.freeze({
    actionId: SKILL_INSTALLER_ACTION.actionId,
    version: SKILL_INSTALLER_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "skill.install.from-manifest.input",
      fields: {
        sourceUri: stringField({ minLength: 1 }),
        skillManifest: stringField({ minLength: 1 }),
        expectedHash: stringField({ minLength: 1, required: false }),
        pinnedRevision: stringField({ minLength: 1, required: false }),
        requestedTrustLevel: enumField(EXTENSION_TRUST_LEVELS, {
          required: false,
        }),
        approvalTicket: stringField({ minLength: 1, required: false }),
        enableAfterInstall: booleanField({ required: false }),
        metadata: jsonField({ required: false }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "skill.install.from-manifest.output",
      fields: {
        status: enumField(["applied", "rejected"]),
        extensionId: stringField({ minLength: 1 }),
        operation: enumField(["install", "upgrade"]),
        trustLevel: enumField(EXTENSION_TRUST_LEVELS),
        lifecycleStatus: enumField(["applied", "rejected"]),
        lifecycleState: enumField(EXTENSION_LIFECYCLE_STATES),
        permissionDelta: jsonField(),
        capabilityIds: stringArrayField({ minItems: 1 }),
        manifestHash: stringField({ minLength: 1 }),
        provenance: jsonField(),
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
