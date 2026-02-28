import {
  ContractValidationError,
  EXTENSION_EXECUTE_ACTION,
  EXTENSION_LIFECYCLE_ACTION,
  EXTENSION_LIFECYCLE_OPERATIONS,
  EXTENSION_LIFECYCLE_STATES,
  EXTENSION_TRUST_LEVELS,
  EXTENSION_TYPES,
  RuntimeExecutionError,
  createExtensionContracts,
  createStrictObjectSchema,
  enumField,
  jsonField,
  stringArrayField,
  stringField,
} from "../../polar-domain/src/index.mjs";

const lifecycleRequestSchema = createStrictObjectSchema({
  schemaId: "extension.gateway.lifecycle.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
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
    metadata: jsonField({ required: false }),
    capabilities: jsonField({ required: false }),
  },
});

const executeRequestSchema = createStrictObjectSchema({
  schemaId: "extension.gateway.execute.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
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
});

const extensionStateSchema = createStrictObjectSchema({
  schemaId: "extension.gateway.state",
  fields: {
    extensionId: stringField({ minLength: 1 }),
    extensionType: enumField(EXTENSION_TYPES),
    trustLevel: enumField(EXTENSION_TRUST_LEVELS),
    lifecycleState: enumField(EXTENSION_LIFECYCLE_STATES),
    permissions: stringArrayField({ minItems: 0 }),
    capabilities: jsonField({ required: false }),
  },
});

/**
 * @param {readonly string[]|undefined} value
 * @returns {readonly string[]}
 */
function normalizePermissions(value) {
  const items = value ?? [];
  const deduped = new Set();
  for (const permission of items) {
    deduped.add(permission);
  }

  return Object.freeze([...deduped].sort((left, right) => left.localeCompare(right)));
}

/**
 * @param {readonly string[]} previousPermissions
 * @param {readonly string[]} nextPermissions
 */
function createPermissionDelta(previousPermissions, nextPermissions) {
  const previous = new Set(previousPermissions);
  const next = new Set(nextPermissions);

  const added = [];
  const removed = [];
  const retained = [];

  for (const permission of nextPermissions) {
    if (!previous.has(permission)) {
      added.push(permission);
    } else {
      retained.push(permission);
    }
  }

  for (const permission of previousPermissions) {
    if (!next.has(permission)) {
      removed.push(permission);
    }
  }

  return Object.freeze({
    added: Object.freeze([...added]),
    removed: Object.freeze([...removed]),
    retained: Object.freeze([...retained]),
  });
}

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
 * @param {unknown} decision
 * @returns {{ allowed: boolean, reason?: string }}
 */
function normalizePolicyDecision(decision) {
  if (decision === undefined) {
    return {
      allowed: true,
    };
  }

  if (typeof decision === "boolean") {
    return {
      allowed: decision,
    };
  }

  if (!isPlainObject(decision) || typeof decision.allowed !== "boolean") {
    throw new RuntimeExecutionError("Invalid extension policy decision result");
  }

  const normalizedDecision = {
    allowed: decision.allowed,
  };
  if (decision.reason !== undefined) {
    if (typeof decision.reason !== "string" || decision.reason.length === 0) {
      throw new RuntimeExecutionError("Invalid extension policy decision reason");
    }
    normalizedDecision.reason = decision.reason;
  }

  return normalizedDecision;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function parseRequest(value, schema) {
  const validation = schema.validate(value);
  if (!validation.ok) {
    throw new ContractValidationError(`Invalid ${schema.schemaId}`, {
      schemaId: schema.schemaId,
      errors: validation.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {Record<string, unknown>} state
 * @returns {Record<string, unknown>}
 */
function validateState(state) {
  return parseRequest(state, extensionStateSchema);
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerExtensionContracts(contractRegistry) {
  for (const contract of createExtensionContracts()) {
    if (!contractRegistry.has(contract.actionId, contract.version)) {
      contractRegistry.register(contract);
    }
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   extensionRegistry?: { get: (extensionId: string) => unknown },
 *   initialStates?: readonly Record<string, unknown>[],
 *   policy?: {
 *     evaluateLifecycle?: (input: Record<string, unknown>, currentState: Record<string, unknown>|undefined) => Promise<{ allowed: boolean, reason?: string }|boolean|void>|{ allowed: boolean, reason?: string }|boolean|void,
 *     evaluateExecution?: (input: Record<string, unknown>, currentState: Record<string, unknown>|undefined) => Promise<{ allowed: boolean, reason?: string }|boolean|void>|{ allowed: boolean, reason?: string }|boolean|void
 *   },
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createExtensionGateway({
  middlewarePipeline,
  extensionRegistry,
  initialStates = [],
  policy = {},
  defaultExecutionType = "tool",
  approvalStore,
}) {
  if (extensionRegistry !== undefined) {
    if (
      typeof extensionRegistry !== "object" ||
      extensionRegistry === null ||
      typeof extensionRegistry.get !== "function"
    ) {
      throw new RuntimeExecutionError(
        "extensionRegistry must expose get(extensionId) when provided",
      );
    }
  }

  if (typeof policy !== "object" || policy === null) {
    throw new RuntimeExecutionError("policy must be an object when provided");
  }

  const evaluateLifecycle = policy.evaluateLifecycle;
  const evaluateExecution = policy.evaluateExecution;

  if (evaluateLifecycle !== undefined && typeof evaluateLifecycle !== "function") {
    throw new RuntimeExecutionError(
      "policy.evaluateLifecycle must be a function when provided",
    );
  }

  if (evaluateExecution !== undefined && typeof evaluateExecution !== "function") {
    throw new RuntimeExecutionError(
      "policy.evaluateExecution must be a function when provided",
    );
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const extensionStates = new Map();
  for (const state of initialStates) {
    const validatedState = validateState(state);
    extensionStates.set(validatedState.extensionId, validatedState);
  }

  /**
   * @param {Record<string, unknown>} input
   * @returns {Promise<Record<string, unknown>>}
   */
  async function applyLifecycleTransition(input) {
    const extensionId = /** @type {string} */ (input.extensionId);
    const extensionType = /** @type {"skill"|"mcp"|"plugin"} */ (input.extensionType);
    const operation = /** @type {string} */ (input.operation);
    const requestedPermissions = normalizePermissions(
      /** @type {readonly string[]|undefined} */(input.requestedPermissions),
    );
    const currentState = extensionStates.get(extensionId);
    const previousPermissions = normalizePermissions(
      /** @type {readonly string[]|undefined} */(currentState?.permissions),
    );
    if (
      currentState &&
      currentState.extensionType !== extensionType
    ) {
      return {
        status: "rejected",
        extensionId,
        extensionType,
        operation,
        trustLevel: currentState.trustLevel,
        lifecycleState: currentState.lifecycleState,
        permissionDelta: createPermissionDelta(previousPermissions, previousPermissions),
        reason: "Extension type does not match installed state",
      };
    }

    const existingTrust = /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
      currentState?.trustLevel
    );
    const trustLevel =
      /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
        input.trustLevel
      ) ??
      existingTrust ??
      "sandboxed";

    const lifecycleDecision = normalizePolicyDecision(
      evaluateLifecycle
        ? await evaluateLifecycle(input, currentState)
        : undefined,
    );

    if (!lifecycleDecision.allowed) {
      return {
        status: "rejected",
        extensionId,
        extensionType,
        operation,
        trustLevel,
        lifecycleState:
          currentState?.lifecycleState ??
          (trustLevel === "blocked" ? "blocked" : "installed"),
        permissionDelta: createPermissionDelta(previousPermissions, previousPermissions),
        reason: lifecycleDecision.reason ?? "Extension lifecycle policy denied",
      };
    }

    /** @type {"installed"|"enabled"|"disabled"|"removed"|"blocked"} */
    let nextLifecycleState = currentState?.lifecycleState ?? "installed";
    /** @type {"applied"|"rejected"} */
    let status = "applied";
    /** @type {string|undefined} */
    let reason = undefined;

    if (operation === "install") {
      nextLifecycleState = input.metadata?.status === "pending_install" ? "pending_install" : (trustLevel === "blocked" ? "blocked" : "installed");
    } else if (operation === "enable") {
      if (trustLevel === "blocked") {
        status = "rejected";
        reason = "Blocked extensions cannot be enabled";
      } else {
        nextLifecycleState = "enabled";
      }
    } else if (operation === "disable") {
      if (!currentState || currentState.lifecycleState === "removed") {
        status = "rejected";
        reason = "Extension is not installed";
      } else {
        nextLifecycleState = "disabled";
      }
    } else if (operation === "upgrade" || operation === "rollback") {
      if (!currentState || currentState.lifecycleState === "removed") {
        status = "rejected";
        reason = "Extension is not installed";
      } else if (trustLevel === "blocked") {
        nextLifecycleState = "blocked";
      } else if (currentState.lifecycleState === "blocked") {
        nextLifecycleState = "disabled";
      } else {
        nextLifecycleState = currentState.lifecycleState;
      }
    } else if (operation === "remove") {
      nextLifecycleState = "removed";
    } else if (operation === "retrust") {
      if (!currentState || currentState.lifecycleState === "removed") {
        status = "rejected";
        reason = "Extension is not installed";
      } else if (trustLevel === "blocked") {
        nextLifecycleState = "blocked";
      } else if (currentState.lifecycleState === "blocked") {
        nextLifecycleState = "disabled";
      } else {
        nextLifecycleState = currentState.lifecycleState;
      }
    } else {
      throw new RuntimeExecutionError("Unknown extension lifecycle operation", {
        operation,
      });
    }

    let nextPermissions = requestedPermissions;
    if (
      operation !== "install" &&
      operation !== "upgrade" &&
      operation !== "rollback"
    ) {
      nextPermissions = previousPermissions;
    }

    const permissionDelta = createPermissionDelta(previousPermissions, nextPermissions);

    if (status === "applied") {
      const nextState = validateState({
        extensionId,
        extensionType,
        trustLevel,
        lifecycleState: nextLifecycleState,
        permissions: nextPermissions,
        ...((input.capabilities ?? currentState?.capabilities)
          ? { capabilities: input.capabilities ?? currentState?.capabilities }
          : {}),
      });
      extensionStates.set(extensionId, nextState);
    }

    const output = {
      status,
      extensionId,
      extensionType,
      operation,
      trustLevel,
      lifecycleState: nextLifecycleState,
      permissionDelta,
    };
    if (reason !== undefined) {
      output.reason = reason;
    }

    return output;
  }

  /**
   * @param {Record<string, unknown>} input
   * @returns {Promise<Record<string, unknown>>}
   */
  async function executeExtensionCapability(input) {
    const extensionId = /** @type {string} */ (input.extensionId);
    const extensionType = /** @type {"skill"|"mcp"|"plugin"} */ (input.extensionType);
    const capabilityId = /** @type {string} */ (input.capabilityId);
    const currentState = extensionStates.get(extensionId);
    const requestedTrustLevel =
      /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
        input.trustLevel
      );
    const persistedTrustLevel =
      /** @type {"trusted"|"reviewed"|"sandboxed"|"blocked"|undefined} */ (
        currentState?.trustLevel
      ) ??
      "sandboxed";
    const trustLevel = persistedTrustLevel;

    const base = {
      extensionId,
      extensionType,
      capabilityId,
      trustLevel,
    };

    if (!currentState || currentState.lifecycleState === "removed") {
      return {
        ...base,
        status: "failed",
        error: Object.freeze({
          code: "POLAR_EXTENSION_NOT_INSTALLED",
          message: "Extension is not installed",
        }),
      };
    }

    if (currentState.extensionType !== extensionType) {
      return {
        ...base,
        status: "failed",
        error: Object.freeze({
          code: "POLAR_EXTENSION_TYPE_MISMATCH",
          message: "Extension type does not match installed state",
          expected: currentState.extensionType,
          received: extensionType,
        }),
      };
    }

    if (
      requestedTrustLevel !== undefined &&
      requestedTrustLevel !== persistedTrustLevel
    ) {
      return {
        ...base,
        status: "failed",
        error: Object.freeze({
          code: "POLAR_EXTENSION_TRUST_LEVEL_MISMATCH",
          message: "Requested trust level does not match installed state",
          expected: persistedTrustLevel,
          received: requestedTrustLevel,
        }),
      };
    }

    if (trustLevel === "blocked" || currentState.lifecycleState === "blocked") {
      return {
        ...base,
        status: "failed",
        error: Object.freeze({
          code: "POLAR_EXTENSION_BLOCKED",
          message: "Blocked extension cannot execute",
        }),
      };
    }

    if (currentState.lifecycleState !== "enabled") {
      return {
        ...base,
        status: "failed",
        error: Object.freeze({
          code: "POLAR_EXTENSION_NOT_ENABLED",
          message: "Extension must be enabled before execution",
        }),
      };
    }

    const capabilityScope = input.capabilityScope;
    if (!capabilityScope || !isPlainObject(capabilityScope) || !isPlainObject(capabilityScope.allowed)) {
      return {
        ...base,
        status: "failed",
        error: Object.freeze({
          code: "POLAR_EXTENSION_POLICY_DENIED",
          message: "Execution blocked: empty or invalid capability scope",
        }),
      };
    }

    const { allowed = {}, constraints = {} } = capabilityScope;
    const allowedCaps = allowed[extensionId];

    if (!allowedCaps || (Array.isArray(allowedCaps) && !allowedCaps.includes(capabilityId) && !allowedCaps.includes("*"))) {
      return {
        ...base,
        status: "failed",
        error: Object.freeze({
          code: "POLAR_EXTENSION_POLICY_DENIED",
          message: `Execution blocked: capability ${capabilityId} from extension ${extensionId} is not in session scope`,
        }),
      };
    }

    const capabilityMetadata = (Array.isArray(currentState?.capabilities) ? currentState.capabilities : [])
      .find(c => c.capabilityId === capabilityId) || { riskLevel: 'unknown', sideEffects: 'unknown', dataEgress: 'unknown' };

    const executionDecision = normalizePolicyDecision(
      evaluateExecution
        ? await evaluateExecution(input, { ...currentState, capabilityMetadata }, approvalStore)
        : undefined,
    );
    if (!executionDecision.allowed) {
      return {
        ...base,
        status: "failed",
        error: Object.freeze({
          code: "POLAR_EXTENSION_POLICY_DENIED",
          message:
            executionDecision.reason ?? "Extension execution policy denied",
        }),
      };
    }

    const extensionAdapter =
      extensionRegistry && extensionRegistry.get(extensionId);
    if (
      typeof extensionAdapter !== "object" ||
      extensionAdapter === null ||
      typeof extensionAdapter.executeCapability !== "function"
    ) {
      return {
        ...base,
        status: "failed",
        error: Object.freeze({
          code: "POLAR_EXTENSION_ADAPTER_MISSING",
          message: "Extension adapter is not configured",
        }),
      };
    }

    try {
      const adapterRequest = {
        extensionId,
        extensionType,
        capabilityId,
        sessionId: input.sessionId,
        userId: input.userId,
        capabilityScope: input.capabilityScope,
        input: input.input,
        trustLevel,
      };
      if (Object.prototype.hasOwnProperty.call(input, "metadata")) {
        adapterRequest.metadata = input.metadata;
      }

      const output = await extensionAdapter.executeCapability(adapterRequest);

      return {
        ...base,
        status: "completed",
        output,
      };
    } catch (error) {
      return {
        ...base,
        status: "failed",
        error: Object.freeze({
          code: "POLAR_RUNTIME_EXECUTION_ERROR",
          message: "Extension capability execution failed",
          cause: error instanceof Error ? error.message : String(error),
        }),
      };
    }
  }

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async applyLifecycle(request) {
      const parsed = parseRequest(request, lifecycleRequestSchema);
      const input = {
        extensionId: parsed.extensionId,
        extensionType: parsed.extensionType,
        operation: parsed.operation,
      };

      if (parsed.trustLevel !== undefined) {
        input.trustLevel = parsed.trustLevel;
      }
      if (parsed.sourceUri !== undefined) {
        input.sourceUri = parsed.sourceUri;
      }
      if (parsed.requestedPermissions !== undefined) {
        input.requestedPermissions = parsed.requestedPermissions;
      }
      if (parsed.approvalTicket !== undefined) {
        input.approvalTicket = parsed.approvalTicket;
      }
      if (parsed.capabilities !== undefined) {
        input.capabilities = parsed.capabilities;
      }
      if (parsed.metadata !== undefined) {
        input.metadata = parsed.metadata;
      }

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: EXTENSION_LIFECYCLE_ACTION.actionId,
          version: EXTENSION_LIFECYCLE_ACTION.version,
          input,
        },
        applyLifecycleTransition,
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async execute(request) {
      const parsed = parseRequest(request, executeRequestSchema);
      const input = {
        extensionId: parsed.extensionId,
        extensionType: parsed.extensionType,
        capabilityId: parsed.capabilityId,
        sessionId: parsed.sessionId,
        userId: parsed.userId,
        capabilityScope: parsed.capabilityScope,
        input: parsed.input,
      };

      if (parsed.trustLevel !== undefined) {
        input.trustLevel = parsed.trustLevel;
      }
      if (parsed.metadata !== undefined) {
        input.metadata = parsed.metadata;
      }

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: EXTENSION_EXECUTE_ACTION.actionId,
          version: EXTENSION_EXECUTE_ACTION.version,
          input,
        },
        executeExtensionCapability,
      );
    },

    /**
     * @param {string} extensionId
     * @returns {Record<string, unknown>|undefined}
     */
    getState(extensionId) {
      const state = extensionStates.get(extensionId);
      if (!state) {
        return undefined;
      }

      return Object.freeze({ ...state });
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listStates() {
      return Object.freeze(
        [...extensionStates.values()]
          .map((state) => Object.freeze({ ...state }))
          .sort((left, right) => left.extensionId.localeCompare(right.extensionId)),
      );
    },
  });
}
