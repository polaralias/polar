import {
  CONTROL_PLANE_RESOURCE_TYPES,
  ContractValidationError,
  PROFILE_RESOLUTION_ACTION,
  RuntimeExecutionError,
  createProfileResolutionContract,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
  booleanField,
} from "@polar/domain";

const resolveProfileRequestSchema = createStrictObjectSchema({
  schemaId: "profile.resolve.gateway.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    userId: stringField({ minLength: 1, required: false }),
    workspaceId: stringField({ minLength: 1, required: false }),
    defaultProfileId: stringField({ minLength: 1, required: false }),
    includeProfileConfig: booleanField({ required: false }),
    allowDefaultFallback: booleanField({ required: false }),
  },
});

const configRecordSchema = createStrictObjectSchema({
  schemaId: "profile.resolve.config.record",
  fields: {
    resourceType: enumField(CONTROL_PLANE_RESOURCE_TYPES),
    resourceId: stringField({ minLength: 1 }),
    version: numberField({ min: 1 }),
    config: jsonField(),
    updatedAtMs: numberField({ min: 0 }),
    updatedBy: stringField({ minLength: 1, required: false }),
  },
});

const profilePinConfigSchema = createStrictObjectSchema({
  schemaId: "profile.resolve.pin.policy.config",
  fields: {
    profileId: stringField({ minLength: 1 }),
  },
});

const GLOBAL_PROFILE_PIN_POLICY_ID = "profile-pin:global";

/**
 * @param {string} workspaceId
 * @returns {string}
 */
function createWorkspaceProfilePinPolicyId(workspaceId) {
  return `profile-pin:workspace:${workspaceId}`;
}

/**
 * @param {string} sessionId
 * @returns {string}
 */
function createSessionProfilePinPolicyId(sessionId) {
  return `profile-pin:session:${sessionId}`;
}

/**
 * @param {string} userId
 * @returns {string}
 */
function createUserProfilePinPolicyId(userId) {
  return `profile-pin:user:${userId}`;
}

/**
 * @param {unknown} value
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function validateRequest(value, schemaId) {
  const schema = {
    [resolveProfileRequestSchema.schemaId]: resolveProfileRequestSchema,
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
 * @param {unknown} record
 * @param {string} resourceType
 * @param {string} resourceId
 * @returns {Record<string, unknown>|undefined}
 */
function validateConfigRecord(record, resourceType, resourceId) {
  if (record === undefined || record === null) {
    return undefined;
  }

  const validation = configRecordSchema.validate(record);
  if (!validation.ok) {
    throw new RuntimeExecutionError(
      "Invalid control-plane config record for profile resolution",
      {
        resourceType,
        resourceId,
        schemaId: configRecordSchema.schemaId,
        errors: validation.errors ?? [],
      },
    );
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {unknown} config
 * @param {string} pinResourceId
 * @returns {string}
 */
function parsePinnedProfileId(config, pinResourceId) {
  if (
    typeof config === "object" &&
    config !== null &&
    Object.getPrototypeOf(config) === Object.prototype &&
    config.unpinned === true
  ) {
    return null;
  }
  const validation = profilePinConfigSchema.validate(config);
  if (!validation.ok) {
    throw new RuntimeExecutionError("Invalid profile pin policy config", {
      pinResourceId,
      schemaId: profilePinConfigSchema.schemaId,
      errors: validation.errors ?? [],
    });
  }

  const parsed = /** @type {Record<string, unknown>} */ (validation.value);
  if (parsed.profileId === "__UNPINNED__") {
    return null;
  }
  return /** @type {string} */ (parsed.profileId);
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerProfileResolutionContract(contractRegistry) {
  const contract = createProfileResolutionContract();
  if (!contractRegistry.has(contract.actionId, contract.version)) {
    contractRegistry.register(contract);
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   readConfigRecord: (
 *     resourceType: "profile"|"channel"|"extension"|"policy"|"automation",
 *     resourceId: string
 *   ) => Record<string, unknown>|undefined,
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createProfileResolutionGateway({
  middlewarePipeline,
  readConfigRecord,
  defaultExecutionType = "tool",
}) {
  if (typeof readConfigRecord !== "function") {
    throw new RuntimeExecutionError(
      "readConfigRecord must be a function for profile resolution",
    );
  }

  /**
   * @param {"profile"|"channel"|"extension"|"policy"|"automation"} resourceType
   * @param {string} resourceId
   * @returns {Record<string, unknown>|undefined}
   */
  function readRecord(resourceType, resourceId) {
    return validateConfigRecord(
      readConfigRecord(resourceType, resourceId),
      resourceType,
      resourceId,
    );
  }

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async resolve(request) {
      const parsed = validateRequest(
        request,
        resolveProfileRequestSchema.schemaId,
      );

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: PROFILE_RESOLUTION_ACTION.actionId,
          version: PROFILE_RESOLUTION_ACTION.version,
          input: (() => {
            const input = {};
            if (parsed.sessionId !== undefined) {
              input.sessionId = parsed.sessionId;
            }
            if (parsed.userId !== undefined) {
              input.userId = parsed.userId;
            }
            if (parsed.workspaceId !== undefined) {
              input.workspaceId = parsed.workspaceId;
            }
            if (parsed.defaultProfileId !== undefined) {
              input.defaultProfileId = parsed.defaultProfileId;
            }
            if (parsed.includeProfileConfig !== undefined) {
              input.includeProfileConfig = parsed.includeProfileConfig;
            }
            if (parsed.allowDefaultFallback !== undefined) {
              input.allowDefaultFallback = parsed.allowDefaultFallback;
            }
            return input;
          })(),
        },
        async (input) => {
          const includeProfileConfig = input.includeProfileConfig !== false;
          const allowDefaultFallback = input.allowDefaultFallback !== false;

          const orderedPins = [];
          if (typeof input.sessionId === "string") {
            orderedPins.push({
              scope: "session",
              pinResourceId: createSessionProfilePinPolicyId(input.sessionId),
            });
          }
          if (typeof input.userId === "string") {
            orderedPins.push({
              scope: "user",
              pinResourceId: createUserProfilePinPolicyId(input.userId),
            });
          }
          if (typeof input.workspaceId === "string") {
            orderedPins.push({
              scope: "workspace",
              pinResourceId: createWorkspaceProfilePinPolicyId(input.workspaceId),
            });
          }
          orderedPins.push({
            scope: "global",
            pinResourceId: GLOBAL_PROFILE_PIN_POLICY_ID,
          });

          for (const pin of orderedPins) {
            const pinRecord = readRecord("policy", pin.pinResourceId);
            if (!pinRecord) {
              continue;
            }

            const pinnedProfileId = parsePinnedProfileId(
              pinRecord.config,
              pin.pinResourceId,
            );
            if (pinnedProfileId === null) {
              continue;
            }
            const pinnedProfileRecord = readRecord("profile", pinnedProfileId);
            if (!pinnedProfileRecord) {
              return {
                status: "not_found",
                resolvedScope: pin.scope,
                profileId: pinnedProfileId,
                pinResourceId: pin.pinResourceId,
                reason: `Pinned ${pin.scope} profile "${pinnedProfileId}" is not configured`,
              };
            }

            const resolved = {
              status: "resolved",
              resolvedScope: pin.scope,
              profileId: pinnedProfileId,
              profileVersion: pinnedProfileRecord.version,
              pinResourceId: pin.pinResourceId,
            };
            if (includeProfileConfig) {
              resolved.profileConfig = pinnedProfileRecord.config;
            }
            return resolved;
          }

          if (
            allowDefaultFallback &&
            typeof input.defaultProfileId === "string"
          ) {
            const fallbackRecord = readRecord("profile", input.defaultProfileId);
            if (fallbackRecord) {
              const resolved = {
                status: "resolved",
                resolvedScope: "default",
                profileId: input.defaultProfileId,
                profileVersion: fallbackRecord.version,
              };
              if (includeProfileConfig) {
                resolved.profileConfig = fallbackRecord.config;
              }
              return resolved;
            }

            return {
              status: "not_found",
              resolvedScope: "default",
              profileId: input.defaultProfileId,
              reason: `Default profile "${input.defaultProfileId}" is not configured`,
            };
          }

          return {
            status: "not_found",
            reason: "No pinned profile found for requested scopes",
          };
        },
      );
    },
  });
}
