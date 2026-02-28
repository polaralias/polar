const ENABLED_STATE = "enabled";
const REMOVED_STATE = "removed";
const KNOWN_LIFECYCLE_STATES = new Set([
  "pending_install",
  "installed",
  "enabled",
  "disabled",
  "removed",
  "blocked",
]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeSkillList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || seen.has(item)) {
      continue;
    }
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

/**
 * @param {unknown} capabilities
 * @returns {string[]}
 */
function extractCapabilityIds(capabilities) {
  if (!Array.isArray(capabilities)) {
    return [];
  }

  const capabilityIds = [];
  const seen = new Set();
  for (const capability of capabilities) {
    const capabilityId =
      typeof capability === "string"
        ? capability
        : isPlainObject(capability) && typeof capability.capabilityId === "string"
          ? capability.capabilityId
          : undefined;
    if (
      typeof capabilityId === "string" &&
      capabilityId.length > 0 &&
      !seen.has(capabilityId)
    ) {
      seen.add(capabilityId);
      capabilityIds.push(capabilityId);
    }
  }
  return capabilityIds;
}

/**
 * @param {unknown} lifecycleState
 * @returns {string}
 */
function normalizeLifecycleState(lifecycleState) {
  if (
    typeof lifecycleState === "string" &&
    KNOWN_LIFECYCLE_STATES.has(lifecycleState)
  ) {
    return lifecycleState;
  }
  return "installed";
}

/**
 * Build extension authority projection.
 * Registry authority entries override extension gateway snapshots when present.
 * @param {unknown[]} installedExtensions
 * @param {unknown[]} authorityStates
 */
function buildAuthorityProjection(installedExtensions, authorityStates) {
  const projected = new Map();

  for (const state of installedExtensions) {
    if (!isPlainObject(state) || typeof state.extensionId !== "string") {
      continue;
    }
    projected.set(
      state.extensionId,
      Object.freeze({
        extensionId: state.extensionId,
        lifecycleState: normalizeLifecycleState(state.lifecycleState),
        capabilityIds: Object.freeze(extractCapabilityIds(state.capabilities)),
      }),
    );
  }

  for (const authority of authorityStates) {
    if (!isPlainObject(authority) || typeof authority.extensionId !== "string") {
      continue;
    }

    const extensionId = authority.extensionId;
    const lifecycleState = normalizeLifecycleState(authority.lifecycleState);
    if (lifecycleState === REMOVED_STATE) {
      projected.delete(extensionId);
      continue;
    }

    const current = projected.get(extensionId);
    const authorityCapabilityIds = extractCapabilityIds(authority.capabilities);
    projected.set(
      extensionId,
      Object.freeze({
        extensionId,
        lifecycleState,
        capabilityIds: Object.freeze(
          authorityCapabilityIds.length > 0
            ? authorityCapabilityIds
            : current?.capabilityIds ?? [],
        ),
      }),
    );
  }

  return projected;
}

/**
 * Validates requested forward_skills against a server-side allowlist.
 * @param {Object} args
 * @param {string[]} args.forwardSkills
 * @param {Object} args.sessionProfile
 * @param {Object} args.multiAgentConfig
 * @returns {{ allowedSkills: string[], rejectedSkills: string[], isBlocked: boolean }}
 */
export function validateForwardSkills({
  forwardSkills = [],
  sessionProfile = {},
  multiAgentConfig = {},
}) {
  const serverAllowlist =
    sessionProfile?.profileConfig?.allowedSkills ||
    multiAgentConfig?.globalAllowedSkills ||
    [];

  const allowedSet = new Set(serverAllowlist);
  const allowedSkills = [];
  const rejectedSkills = [];

  for (const skill of forwardSkills) {
    if (allowedSet.has(skill)) {
      allowedSkills.push(skill);
    } else {
      rejectedSkills.push(skill);
    }
  }

  const allowEmptySkills = multiAgentConfig?.allowEmptySkillsDelegation === true;
  const isBlocked =
    allowedSkills.length === 0 && forwardSkills.length > 0 && !allowEmptySkills;

  return { allowedSkills, rejectedSkills, isBlocked };
}

/**
 * Validates model override request.
 * @param {Object} args
 * @param {string} [args.modelOverride]
 * @param {Object} args.multiAgentConfig
 * @param {Object} args.basePolicy
 * @returns {{ providerId: string, modelId: string, rejectedReason?: string }}
 */
export function validateModelOverride({
  modelOverride,
  multiAgentConfig = {},
  basePolicy = {},
}) {
  const allowlistedModels = multiAgentConfig.allowlistedModels || [
    "gpt-4.1-mini",
    "claude-sonnet-4-6",
    "gemini-3.1-pro-preview",
  ];

  if (!modelOverride) {
    return {
      providerId: basePolicy.providerId || "openai",
      modelId: basePolicy.modelId || "gpt-4.1-mini",
    };
  }

  if (!allowlistedModels.includes(modelOverride)) {
    return {
      providerId: basePolicy.providerId || "openai",
      modelId: basePolicy.modelId || "gpt-4.1-mini",
      rejectedReason: `Model "${modelOverride}" is not in the server allowlist.`,
    };
  }

  let providerId = basePolicy.providerId || "openai";
  if (modelOverride.startsWith("claude")) {
    providerId = "anthropic";
  } else if (modelOverride.startsWith("gemini")) {
    providerId = "google";
  } else if (modelOverride.startsWith("gpt")) {
    providerId = "openai";
  } else if (modelOverride.startsWith("deepseek")) {
    providerId = "deepseek";
  }

  return { providerId, modelId: modelOverride };
}

/**
 * Computes a strict capability scope for tool execution.
 * Enabled extension capabilities are projected from authority states when provided,
 * otherwise from extension gateway state snapshots.
 * @param {Object} args
 * @param {Object} [args.sessionProfile]
 * @param {Object} [args.multiAgentConfig]
 * @param {Object} [args.activeDelegation]
 * @param {Array<Object>} [args.installedExtensions]
 * @param {Array<Object>} [args.authorityStates]
 * @returns {{ allowed: Record<string, string[]>, constraints: Object, rejectedSkills: string[] }}
 */
export function computeCapabilityScope({
  sessionProfile = {},
  multiAgentConfig = {},
  activeDelegation,
  installedExtensions = [],
  authorityStates = [],
}) {
  const scope = {
    allowed: {},
    constraints: {},
  };
  const rejectedSkills = [];
  scope.allowed.system = ["lookup_weather", "delegate_to_agent", "complete_task"];

  const effectiveAllowedSkills = normalizeSkillList(
    activeDelegation?.forward_skills ||
    sessionProfile?.profileConfig?.allowedSkills ||
    multiAgentConfig?.globalAllowedSkills ||
    [],
  );

  const authorityProjection = buildAuthorityProjection(
    Array.isArray(installedExtensions) ? installedExtensions : [],
    Array.isArray(authorityStates) ? authorityStates : [],
  );

  for (const extensionId of effectiveAllowedSkills) {
    const authorityState = authorityProjection.get(extensionId);
    if (
      !authorityState ||
      authorityState.lifecycleState !== ENABLED_STATE ||
      authorityState.capabilityIds.length === 0
    ) {
      rejectedSkills.push(extensionId);
      continue;
    }

    scope.allowed[extensionId] = [...authorityState.capabilityIds];
  }

  scope.rejectedSkills = rejectedSkills;
  return scope;
}
