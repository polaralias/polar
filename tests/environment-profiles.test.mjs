import test from "node:test";
import assert from "node:assert/strict";

import {
  ENVIRONMENT_PROFILES,
  ContractValidationError,
  getEnvironmentProfile,
  parseEnvironmentProfileId,
} from "../packages/polar-domain/src/index.mjs";

test("returns typed environment profiles for supported ids", () => {
  const prod = getEnvironmentProfile("prod");
  assert.deepEqual(prod, ENVIRONMENT_PROFILES.prod);
  assert.equal(prod.contractStrictness, "hardened");
});

test("rejects unsupported environment profile ids", () => {
  assert.throws(
    () => parseEnvironmentProfileId("production"),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});
