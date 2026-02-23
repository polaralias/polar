import { ContractValidationError } from "./runtime-contracts.mjs";

const ENVIRONMENT_PROFILE_IDS = new Set(["dev", "staging", "prod"]);

export const ENVIRONMENT_PROFILES = Object.freeze({
  dev: Object.freeze({
    id: "dev",
    contractStrictness: "observe",
    defaultModelLane: "worker",
    auditSamplingRate: 1,
    permitInteractiveDebugActions: true,
  }),
  staging: Object.freeze({
    id: "staging",
    contractStrictness: "enforce",
    defaultModelLane: "worker",
    auditSamplingRate: 1,
    permitInteractiveDebugActions: false,
  }),
  prod: Object.freeze({
    id: "prod",
    contractStrictness: "hardened",
    defaultModelLane: "local",
    auditSamplingRate: 1,
    permitInteractiveDebugActions: false,
  }),
});

/**
 * @param {unknown} value
 * @returns {"dev"|"staging"|"prod"}
 */
export function parseEnvironmentProfileId(value) {
  if (typeof value !== "string" || !ENVIRONMENT_PROFILE_IDS.has(value)) {
    throw new ContractValidationError("Invalid environment profile id", {
      expected: ["dev", "staging", "prod"],
      received: value,
    });
  }

  return /** @type {"dev"|"staging"|"prod"} */ (value);
}

/**
 * @param {unknown} value
 * @returns {Readonly<{
 *   id: "dev"|"staging"|"prod",
 *   contractStrictness: "observe"|"enforce"|"hardened",
 *   defaultModelLane: "local"|"worker"|"brain",
 *   auditSamplingRate: number,
 *   permitInteractiveDebugActions: boolean
 * }>}
 */
export function getEnvironmentProfile(value) {
  const profileId = parseEnvironmentProfileId(value);
  return ENVIRONMENT_PROFILES[profileId];
}
