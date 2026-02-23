import test from "node:test";
import assert from "node:assert/strict";

import {
  ContractValidationError,
  RuntimeExecutionError,
} from "../packages/polar-domain/src/index.mjs";
import {
  createContractRegistry,
  createMiddlewarePipeline,
  createProviderGateway,
  registerProviderOperationContracts,
} from "../packages/polar-runtime-core/src/index.mjs";

function createProvider(id, overrides = {}) {
  return Object.freeze({
    async generate(input) {
      return {
        providerId: input.providerId,
        model: input.model,
        text: `${id}:${input.prompt}`,
      };
    },
    async stream(input) {
      return {
        providerId: input.providerId,
        model: input.model,
        chunks: Object.freeze([`${id}:chunk:${input.prompt}`]),
      };
    },
    async embed(input) {
      return {
        providerId: input.providerId,
        model: input.model,
        vector: Object.freeze([input.text.length, 1]),
      };
    },
    ...overrides,
  });
}

function setupGateway(providers, middleware = []) {
  const registry = createContractRegistry();
  registerProviderOperationContracts(registry);
  const pipeline = createMiddlewarePipeline({
    contractRegistry: registry,
    middleware,
  });

  return createProviderGateway({
    middlewarePipeline: pipeline,
    providers,
  });
}

test("registerProviderOperationContracts registers provider actions once", () => {
  const registry = createContractRegistry();
  registerProviderOperationContracts(registry);
  registerProviderOperationContracts(registry);

  assert.deepEqual(registry.list(), [
    "provider.embed@1",
    "provider.generate@1",
    "provider.stream@1",
  ]);
});

test("generate uses configured provider through middleware pipeline", async () => {
  const events = [];
  const gateway = setupGateway(
    {
      primary: createProvider("primary"),
    },
    [
      {
        id: "events",
        before() {
          events.push("before");
        },
        after() {
          events.push("after");
        },
      },
    ],
  );

  const output = await gateway.generate({
    executionType: "tool",
    providerId: "primary",
    model: "model-1",
    prompt: "hello",
  });

  assert.deepEqual(output, {
    providerId: "primary",
    model: "model-1",
    text: "primary:hello",
  });
  assert.deepEqual(events, ["before", "after"]);
});

test("falls back to secondary provider when primary provider fails", async () => {
  const gateway = setupGateway({
    primary: createProvider("primary", {
      async generate() {
        throw new Error("primary down");
      },
    }),
    secondary: createProvider("secondary"),
  });

  const output = await gateway.generate({
    providerId: "primary",
    fallbackProviderIds: ["secondary"],
    model: "m-1",
    prompt: "hello",
  });

  assert.deepEqual(output, {
    providerId: "secondary",
    model: "m-1",
    text: "secondary:hello",
  });
});

test("returns deterministic aggregated error when all fallback providers fail", async () => {
  const gateway = setupGateway({
    primary: createProvider("primary", {
      async generate() {
        throw new Error("primary failed");
      },
    }),
    secondary: createProvider("secondary", {
      async generate() {
        throw new Error("secondary failed");
      },
    }),
  });

  await assert.rejects(
    async () =>
      gateway.generate({
        providerId: "primary",
        fallbackProviderIds: ["secondary"],
        model: "m-1",
        prompt: "hello",
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR" &&
      error.details.operation === "generate" &&
      Array.isArray(error.details.attempts) &&
      error.details.attempts.length === 2,
  );
});

test("supports stream and embed operations through typed contracts", async () => {
  const gateway = setupGateway({
    primary: createProvider("primary"),
  });

  const streamResult = await gateway.stream({
    providerId: "primary",
    model: "m-2",
    prompt: "hey",
  });
  assert.deepEqual(streamResult, {
    providerId: "primary",
    model: "m-2",
    chunks: ["primary:chunk:hey"],
  });

  const embedResult = await gateway.embed({
    providerId: "primary",
    model: "m-embed",
    text: "abc",
  });
  assert.deepEqual(embedResult, {
    providerId: "primary",
    model: "m-embed",
    vector: [3, 1],
  });
});

test("rejects invalid gateway input deterministically before provider execution", async () => {
  let executed = false;
  const gateway = setupGateway({
    primary: createProvider("primary", {
      async generate() {
        executed = true;
        return {
          providerId: "primary",
          model: "m",
          text: "hello",
        };
      },
    }),
  });

  await assert.rejects(
    async () =>
      gateway.generate({
        providerId: "primary",
        model: "m-1",
        prompt: "",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );

  assert.equal(executed, false);
});

test("rejects requests with unknown fields", async () => {
  const gateway = setupGateway({
    primary: createProvider("primary"),
  });

  await assert.rejects(
    async () =>
      gateway.embed({
        providerId: "primary",
        model: "m-1",
        text: "abc",
        unexpected: "nope",
      }),
    (error) =>
      error instanceof ContractValidationError &&
      error.code === "POLAR_CONTRACT_VALIDATION_ERROR",
  );
});

test("rejects missing provider adapter before execution", async () => {
  const gateway = setupGateway({
    primary: createProvider("primary"),
  });

  await assert.rejects(
    async () =>
      gateway.generate({
        providerId: "secondary",
        model: "m-1",
        prompt: "hello",
      }),
    (error) =>
      error instanceof RuntimeExecutionError &&
      error.code === "POLAR_RUNTIME_EXECUTION_ERROR",
  );
});
