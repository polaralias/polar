import test from "node:test";
import assert from "node:assert";

test("F5 Reliability Drills", async (t) => {
    await t.test("provider blackout failover: falls back deterministically on stream timeout/error", async () => {
        // We mock a setup with two providers: priority and generic fallback.
        // The priority provider will throw RuntimeExecutionError simulating a blackout.
        // We expect the pipeline to cleanly fallback to the secondary provider and log the attempt.

        let priorityCalled = false;
        let fallbackCalled = false;

        const mockPriorityProvider = {
            capabilities: {},
            async generate() {
                priorityCalled = true;
                throw new Error("Simulated priority timeout/blackout");
            },
            async stream() {
                priorityCalled = true;
                throw new Error("Simulated priority timeout/blackout");
            },
            async embed() { return {}; }
        };

        const mockFallbackProvider = {
            capabilities: {},
            async generate() {
                fallbackCalled = true;
                return { text: "Fallback success", providerId: "fallback-provider", model: "model-2" };
            },
            async stream() {
                fallbackCalled = true;
                return { chunks: ["Fallback", " success"], providerId: "fallback-provider", model: "model-2" };
            },
            async embed() { return {}; }
        };

        const providers = new Map([
            ["priority-provider", mockPriorityProvider],
            ["fallback-provider", mockFallbackProvider]
        ]);

        let telemetryRecorded = false;
        const { createProviderGateway, registerProviderOperationContracts } = await import("../packages/polar-runtime-core/src/provider-gateway.mjs");
        const { createContractRegistry } = await import("../packages/polar-runtime-core/src/contract-registry.mjs");
        const { createMiddlewarePipeline } = await import("../packages/polar-runtime-core/src/middleware-pipeline.mjs");
        const { createModelPolicyEngine } = await import("../packages/polar-runtime-core/src/model-policy-engine.mjs");

        const contractRegistry = createContractRegistry();
        registerProviderOperationContracts(contractRegistry);

        const providerGateway = createProviderGateway({
            registry: contractRegistry,
            middlewarePipeline: createMiddlewarePipeline({ contractRegistry }),
            telemetry: {},
            modelPolicyEngine: createModelPolicyEngine(),
            providers,
            usageTelemetryCollector: {
                recordOperation(event) {
                    telemetryRecorded = true;
                    assert.strictEqual(event.fallbackUsed, true);
                    assert.deepStrictEqual(event.attemptedProviderIds, ["priority-provider", "fallback-provider"]);
                }
            },
            now: () => Date.now(),
            defaultTimeoutMs: 100 // Test that config accepts the parameter
        });

        const result = await providerGateway.stream({
            providerId: "priority-provider",
            fallbackProviderIds: ["fallback-provider"],
            model: "model-1",
            prompt: "Hello"
        });

        assert.strictEqual(priorityCalled, true);
        assert.strictEqual(fallbackCalled, true);
        assert.strictEqual(telemetryRecorded, true);
        assert.strictEqual(result.providerId, "fallback-provider");
        assert.deepStrictEqual(result.chunks, ["Fallback", " success"]);
    });

    await t.test("audit/store degradation behavior: graceful fail-closed behavior when sink fails", async () => {
        // Tests that durable-lineage-store degrades properly without bringing down the orchestrator loop if designed as such,
        // or properly fails execution explicitly (fail-closed is current default).
        const { createMiddlewarePipeline } = await import("../packages/polar-runtime-core/src/middleware-pipeline.mjs");
        let auditSinkCalled = false;
        const failingAuditSink = {
            async recordOperation() {
                auditSinkCalled = true;
                throw new Error("Storage degradation");
            }
        };

        const { createContractRegistry } = await import("../packages/polar-runtime-core/src/contract-registry.mjs");
        const pipeline = createMiddlewarePipeline({
            contractRegistry: createContractRegistry(),
            auditSink: (event) => failingAuditSink.recordOperation(event)
        });

        await assert.rejects(
            async () => {
                await pipeline.run({
                    actionId: "test.action", version: 1, executionType: "tool", input: {}
                }, async () => ({ status: "ok" }));
            },
            (err) => {
                assert.ok(err.message.includes("Audit sink rejected event") || err.message.includes("Storage degradation"));
                return true;
            }
        );
        assert.strictEqual(auditSinkCalled, true);
    });

    await t.test("multi-agent loop panic containment: timeout prevents runaway capability execution", async () => {
        // Utilize the injection of defaultExecutionTimeoutMs from F5 on extension gateway
        const { createExtensionGateway } = await import("../packages/polar-runtime-core/src/extension-gateway.mjs");
        const { createMiddlewarePipeline } = await import("../packages/polar-runtime-core/src/middleware-pipeline.mjs");

        const mockAdapter = {
            async executeCapability() {
                // Will never return natively simulating an agent or tool stuck in a loop
                return new Promise(() => { });
            }
        };

        const extensionRegistry = {
            get() { return mockAdapter; }
        };

        const { createContractRegistry } = await import("../packages/polar-runtime-core/src/contract-registry.mjs");
        const { registerExtensionContracts } = await import("../packages/polar-runtime-core/src/extension-gateway.mjs");
        const contractRegistry = createContractRegistry();
        registerExtensionContracts(contractRegistry);

        const gateway = createExtensionGateway({
            middlewarePipeline: createMiddlewarePipeline({ contractRegistry }),
            extensionRegistry,
            initialStates: [{
                extensionId: "mock-ext",
                extensionType: "skill",
                trustLevel: "trusted",
                lifecycleState: "enabled",
                permissions: []
            }],
            defaultExecutionTimeoutMs: 50 // Short timeout for drill
        });

        const startTime = Date.now();
        const result = await gateway.execute({
            extensionId: "mock-ext",
            extensionType: "skill",
            capabilityId: "mock-cap",
            sessionId: "session-1",
            userId: "user-1",
            capabilityScope: { allowed: { "mock-ext": ["mock-cap"] } },
            input: {}
        });

        const elapsed = Date.now() - startTime;
        assert.strictEqual(result.status, "failed");
        assert.strictEqual(result.error.code, "POLAR_RUNTIME_EXECUTION_ERROR");
        assert.ok(result.error.cause.includes("timed out after 50ms"));
        assert.ok(elapsed >= 40 && elapsed <= 500); // Expect it terminated quickly due to timeout wrapper
    });
});
