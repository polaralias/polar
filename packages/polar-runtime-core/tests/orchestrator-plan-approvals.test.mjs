import assert from 'node:assert';
import { createOrchestrator } from '../src/orchestrator.mjs';
import { createApprovalStore } from '../src/approval-store.mjs';

describe('Orchestrator: Plan Approvals', () => {
    let orchestrator;
    let approvalStore;
    let extensionStates;
    let lastActionResponse;

    const mockProfile = {
        profileConfig: {
            allowedSkills: ['email'],
            modelPolicy: { providerId: 'test', modelId: 'test-model' },
            systemPrompt: 'Test system prompt'
        }
    };

    const setupOrchestrator = (actionToEmit) => {
        extensionStates = new Map([
            ['email', {
                extensionId: 'email',
                lifecycleState: 'enabled',
                capabilities: [
                    { capabilityId: 'draft_email', riskLevel: 'write', sideEffects: 'internal' },
                    { capabilityId: 'send_email', riskLevel: 'write', sideEffects: 'external' }
                ]
            }]
        ]);

        approvalStore = createApprovalStore();

        const mockExtensionGateway = {
            getState: (id) => extensionStates.get(id),
            listStates: () => Array.from(extensionStates.values()),
            execute: async () => ({ status: 'completed', output: 'Done.' }),
            applyLifecycle: async () => ({ status: 'applied' })
        };

        const mockProviderGateway = {
            generate: async ({ prompt }) => {
                // If it's the primary orchestration turn (prompt is the user text)
                if (prompt !== 'Summarize these results.' && !prompt.includes('Analyze these execution results')) {
                    return { text: `Here is the plan:\n\n<polar_action>\n${JSON.stringify(actionToEmit)}\n</polar_action>` };
                }
                return { text: 'Execution complete summary.' };
            }
        };

        const mockChatGateway = {
            appendMessage: async () => { },
            getSessionHistory: async () => ({ items: [] })
        };

        const mockProfileGateway = {
            resolve: async () => mockProfile
        };

        const mockControlPlaneGateway = {
            getConfig: async () => ({ status: 'not_found' })
        };

        orchestrator = createOrchestrator({
            profileResolutionGateway: mockProfileGateway,
            chatManagementGateway: mockChatGateway,
            providerGateway: mockProviderGateway,
            extensionGateway: mockExtensionGateway,
            approvalStore,
            gateway: mockControlPlaneGateway,
            now: () => 1000
        });
    };

    it('Weather lookup (read) should auto-run without approval', async () => {
        setupOrchestrator({ template: 'lookup_weather', args: { location: 'Swansea' } });

        const result = await orchestrator.orchestrate({
            sessionId: 's1', userId: 'u1', text: 'How is the weather in Swansea?'
        });

        // status 'completed' means it auto-ran executeWorkflow
        assert.strictEqual(result.status, 'completed', `Expected completed status, got ${result.status}. Error: ${result.text}`);
        assert.ok(result.text.includes('Execution Results'));
    });

    it('Email draft (write internal) should auto-run without approval', async () => {
        setupOrchestrator({ template: 'draft_email', args: { to: 'bob', subject: 'hi', body: 'hello' } });

        const result = await orchestrator.orchestrate({
            sessionId: 's1', userId: 'u1', text: 'Draft an email to Bob'
        });

        assert.strictEqual(result.status, 'completed', `Expected completed status, got ${result.status}. Error: ${result.text}`);
        assert.ok(result.text.includes('draft_email'));
    });

    it('Email send (write external) should require approval', async () => {
        setupOrchestrator({ template: 'send_email', args: { to: 'bob', subject: 'hi', body: 'hello' } });

        const result = await orchestrator.orchestrate({
            sessionId: 's1', userId: 'u1', text: 'Send an email to Bob'
        });

        assert.strictEqual(result.status, 'workflow_proposed');
        assert.strictEqual(result.risk.level, 'write');
        assert.strictEqual(result.risk.sideEffects, 'external');
        assert.strictEqual(result.risk.requirements.length, 1);
        assert.strictEqual(result.risk.requirements[0].capabilityId, 'send_email');
    });

    it('Approving a plan should issue grants and execute', async () => {
        setupOrchestrator({ template: 'send_email', args: { to: 'bob', subject: 'hi', body: 'hello' } });

        const proposal = await orchestrator.orchestrate({
            sessionId: 's1', userId: 'u1', text: 'Send an email to Bob'
        });

        const executeResult = await orchestrator.executeWorkflow(proposal.workflowId);

        assert.strictEqual(executeResult.status, 'completed');

        // Verify grant was issued
        const grants = approvalStore._listGrants();
        assert.strictEqual(grants.length, 1);
        assert.strictEqual(grants[0].scope.capabilities[0].capabilityId, 'send_email');
    });

    it('Second run with existing grant should auto-run', async () => {
        setupOrchestrator({ template: 'send_email', args: { to: 'bob', subject: 'hi', body: 'hello' } });

        // Pre-issue a grant
        approvalStore.issueGrant({ userId: 'u1', sessionId: 's1' }, {
            capabilities: [{ extensionId: 'email', capabilityId: 'send_email' }]
        }, 3600, 'Existing grant');

        const result = await orchestrator.orchestrate({
            sessionId: 's1', userId: 'u1', text: 'Send another email to Bob'
        });

        // Should auto-run because of existing grant
        assert.strictEqual(result.status, 'completed');
    });
});
