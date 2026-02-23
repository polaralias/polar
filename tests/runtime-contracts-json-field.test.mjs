import test from "node:test";
import assert from "node:assert/strict";

import {
  createStrictObjectSchema,
  jsonField,
} from "../packages/polar-domain/src/index.mjs";

function createJsonSchema() {
  return createStrictObjectSchema({
    schemaId: "json.field.schema",
    fields: {
      payload: jsonField(),
    },
  });
}

test("jsonField accepts strict JSON values", () => {
  const schema = createJsonSchema();
  const result = schema.validate({
    payload: {
      ok: true,
      count: 3,
      text: "hello",
      nested: [1, "two", null, { deep: false }],
    },
  });

  assert.equal(result.ok, true);
});

test("jsonField rejects undefined and non-json values", () => {
  const schema = createJsonSchema();

  const undefinedPayload = schema.validate({
    payload: undefined,
  });
  const functionPayload = schema.validate({
    payload: {
      run() {},
    },
  });
  const nonFinitePayload = schema.validate({
    payload: Number.NaN,
  });

  assert.equal(undefinedPayload.ok, false);
  assert.equal(functionPayload.ok, false);
  assert.equal(nonFinitePayload.ok, false);
});

