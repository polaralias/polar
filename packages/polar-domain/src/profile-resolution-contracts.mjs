import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "./runtime-contracts.mjs";

export const PROFILE_RESOLUTION_STATUSES = Object.freeze([
  "resolved",
  "not_found",
]);

export const PROFILE_RESOLUTION_SCOPES = Object.freeze([
  "session",
  "workspace",
  "global",
  "default",
]);

export const PROFILE_RESOLUTION_ACTION = Object.freeze({
  actionId: "profile.resolve",
  version: 1,
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createProfileResolutionContract(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze({
    actionId: PROFILE_RESOLUTION_ACTION.actionId,
    version: PROFILE_RESOLUTION_ACTION.version,
    inputSchema: createStrictObjectSchema({
      schemaId: "profile.resolve.input",
      fields: {
        sessionId: stringField({ minLength: 1, required: false }),
        workspaceId: stringField({ minLength: 1, required: false }),
        defaultProfileId: stringField({ minLength: 1, required: false }),
        includeProfileConfig: booleanField({ required: false }),
        allowDefaultFallback: booleanField({ required: false }),
      },
    }),
    outputSchema: createStrictObjectSchema({
      schemaId: "profile.resolve.output",
      fields: {
        status: enumField(PROFILE_RESOLUTION_STATUSES),
        resolvedScope: enumField(PROFILE_RESOLUTION_SCOPES, { required: false }),
        profileId: stringField({ minLength: 1, required: false }),
        profileVersion: numberField({ min: 1, required: false }),
        profileConfig: jsonField({ required: false }),
        pinResourceId: stringField({ minLength: 1, required: false }),
        reason: stringField({ minLength: 1, required: false }),
      },
    }),
    riskClass,
    trustClass,
    timeoutMs: 10_000,
    retryPolicy: {
      maxAttempts: 1,
    },
  });
}
