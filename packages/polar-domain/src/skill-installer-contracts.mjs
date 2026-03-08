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
        requireManifestReview: booleanField({ required: false }),
        mcpInventory: jsonField({ required: false }),
        metadata: jsonField({ required: false }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "skill.install.from-manifest.output",
      fields: {
        status: enumField(["applied", "rejected"]),
        extensionId: stringField({ minLength: 1 }),
        operation: enumField(["install", "upgrade"], { required: false }),
        trustLevel: enumField(EXTENSION_TRUST_LEVELS, { required: false }),
        lifecycleStatus: enumField(["applied", "rejected"], { required: false }),
        lifecycleState: enumField(EXTENSION_LIFECYCLE_STATES),
        permissionDelta: jsonField({ required: false }),
        capabilityIds: stringArrayField({ minItems: 1, required: false }),
        manifestHash: stringField({ minLength: 1, required: false }),
        provenance: jsonField({ required: false }),
        reason: stringField({ minLength: 1, required: false }),
        missingMetadata: jsonField({ required: false }),
        proposedManifest: jsonField({ required: false }),
        reviewStatus: enumField(["pending", "approved", "rejected"], { required: false }),
        manifestSource: enumField(["provided", "generated"], { required: false }),
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
export const SKILL_ANALYZER_ACTION = Object.freeze({
  actionId: "skill.install.analyze",
  version: 1,
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createSkillAnalyzerContract(options = {}) {
  const { trustClass = "native", riskClass = "low" } = options;

  return Object.freeze({
    actionId: SKILL_ANALYZER_ACTION.actionId,
    version: SKILL_ANALYZER_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "skill.install.analyze.input",
      fields: {
        sourceUri: stringField({ minLength: 1 }),
        skillContent: stringField({ minLength: 1 }), // content of SKILL.md
        mcpInventory: jsonField(), // list of available MCP tools
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "skill.install.analyze.output",
      fields: {
        status: enumField(["applied", "rejected"]),
        extensionId: stringField({ minLength: 1 }),
        proposedManifest: jsonField(),
        reason: stringField({ minLength: 1, required: false }),
      },
    }),
    riskClass,
    trustClass,
    timeoutMs: 60_000,
  });
}
