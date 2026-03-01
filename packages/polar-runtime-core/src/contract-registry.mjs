import {
  ContractRegistryError,
  RISK_CLASSES,
  TRUST_CLASSES,
} from "@polar/domain";

const riskClasses = new Set(RISK_CLASSES);
const trustClasses = new Set(TRUST_CLASSES);

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * @param {string} actionId
 * @param {number} version
 * @returns {string}
 */
export function createContractKey(actionId, version) {
  return `${actionId}@${version}`;
}

/**
 * @param {unknown} contract
 */
function validateContract(contract) {
  if (typeof contract !== "object" || contract === null) {
    throw new ContractRegistryError("Contract definition must be an object");
  }

  const contractRecord = /** @type {Record<string, unknown>} */ (contract);
  const {
    actionId,
    version,
    inputSchema,
    outputSchema,
    riskClass,
    trustClass,
    timeoutMs,
    retryPolicy,
  } = contractRecord;

  if (typeof actionId !== "string" || actionId.length === 0) {
    throw new ContractRegistryError("Contract actionId must be a non-empty string");
  }

  if (!isPositiveInteger(version)) {
    throw new ContractRegistryError("Contract version must be a positive integer", {
      actionId,
      version,
    });
  }

  if (typeof inputSchema !== "object" || inputSchema === null || typeof inputSchema.validate !== "function") {
    throw new ContractRegistryError("Contract inputSchema must expose a validate(value) function", {
      actionId,
      version,
    });
  }

  if (typeof outputSchema !== "object" || outputSchema === null || typeof outputSchema.validate !== "function") {
    throw new ContractRegistryError("Contract outputSchema must expose a validate(value) function", {
      actionId,
      version,
    });
  }

  if (typeof riskClass !== "string" || !riskClasses.has(riskClass)) {
    throw new ContractRegistryError("Contract riskClass is invalid", {
      actionId,
      version,
      riskClass,
      allowed: RISK_CLASSES,
    });
  }

  if (typeof trustClass !== "string" || !trustClasses.has(trustClass)) {
    throw new ContractRegistryError("Contract trustClass is invalid", {
      actionId,
      version,
      trustClass,
      allowed: TRUST_CLASSES,
    });
  }

  if (!isPositiveInteger(timeoutMs)) {
    throw new ContractRegistryError("Contract timeoutMs must be a positive integer", {
      actionId,
      version,
      timeoutMs,
    });
  }

  const retryPolicyRecord =
    typeof retryPolicy === "object" && retryPolicy !== null
      ? /** @type {Record<string, unknown>} */ (retryPolicy)
      : undefined;
  const maxAttempts = retryPolicyRecord?.maxAttempts;
  if (!isPositiveInteger(maxAttempts)) {
    throw new ContractRegistryError(
      "Contract retryPolicy.maxAttempts must be a positive integer",
      {
        actionId,
        version,
        maxAttempts,
      },
    );
  }
}

/**
 * @typedef {import("@polar/domain").ActionContract} ActionContract
 */

/**
 * Creates a strict in-memory contract registry.
 */
export function createContractRegistry() {
  /** @type {Map<string, ActionContract>} */
  const contracts = new Map();

  return Object.freeze({
    /**
     * @param {ActionContract} contract
     */
    register(contract) {
      validateContract(contract);

      const contractKey = createContractKey(contract.actionId, contract.version);
      if (contracts.has(contractKey)) {
        throw new ContractRegistryError("Contract is already registered", {
          actionId: contract.actionId,
          version: contract.version,
        });
      }

      contracts.set(contractKey, Object.freeze({ ...contract }));
    },

    /**
     * @param {string} actionId
     * @param {number} version
     * @returns {ActionContract}
     */
    get(actionId, version) {
      const contractKey = createContractKey(actionId, version);
      const contract = contracts.get(contractKey);

      if (!contract) {
        throw new ContractRegistryError("Contract is not registered", {
          actionId,
          version,
        });
      }

      return contract;
    },

    /**
     * @param {string} actionId
     * @param {number} version
     * @returns {boolean}
     */
    has(actionId, version) {
      return contracts.has(createContractKey(actionId, version));
    },

    /**
     * @returns {readonly string[]}
     */
    list() {
      return Object.freeze([...contracts.keys()].sort((left, right) => left.localeCompare(right)));
    },
  });
}
