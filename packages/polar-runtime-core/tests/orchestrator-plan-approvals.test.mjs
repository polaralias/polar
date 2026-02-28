import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { createOrchestrator } from '../src/orchestrator.mjs';
import { createApprovalStore } from '../src/approval-store.mjs';
import { WORKFLOW_TEMPLATES } from '../src/workflow-templates.mjs';

describe('Orchestrator: Plan Approvals', () => {
    let orchestrator;
    let approvalStore;
    let extensionStates;
    let executeRequests;
    const originalSetInterval = globalThis.setInterval;

    before(() => {
        globalThis.setInterval = (callback, interval, ...args) => {
            const timer = originalSetInterval(callback, interval, ...args);
            if (timer && typeof timer.unref === 'function') {
                timer.unref();
            }
            return timer;
        };
    });

    after(() => {
        globalThis.setInterval = originalSetInterval;
    });

    const mockProfile = {
        profileConfig: {
            allowedSkills: ['email'],
            modelPolicy: { providerId: 'test', modelId: 'test-model' },
            systemPrompt: 'Test system prompt'
        }
    };

    const setupOrchestrator = (actionToEmit, options = {}) => {
        const {
            sendEmailRiskLevel = 'write',
            sendEmailSideEffects = 'external'
        } = options;

        executeRequests = [];
        extensionStates = new Map([
            ['email', {
                extensionId: 'email',
                lifecycleState: 'enabled',
                capabilities: [
                    { capabilityId: 'draft_email', riskLevel: 'write', sideEffects: 'internal' },
                    { capabilityId: 'send_email', riskLevel: sendEmailRiskLevel, sideEffects: sendEmailSideEffects }
                ]
            }]
        ]);

        approvalStore = createApprovalStore();

        const mockExtensionGateway = {
            getState: (id) => extensionStates.get(id),
            listStates: () => Array.from(extensionStates.values()),
            execute: async (request) => {
                executeRequests.push(request);
                return { status: 'completed', output: 'Done.' };
            },
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

    it('Destructive actions require explicit approval every run by default', async () => {
        setupOrchestrator(
            { template: 'send_email', args: { to: 'bob', subject: 'hi', body: 'hello' } },
            { sendEmailRiskLevel: 'destructive', sendEmailSideEffects: 'external' }
        );

        const firstProposal = await orchestrator.orchestrate({
            sessionId: 's1', userId: 'u1', text: 'Delete and send immediately'
        });
        assert.strictEqual(firstProposal.status, 'workflow_proposed');
        assert.strictEqual(firstProposal.risk.level, 'destructive');

        const firstExecute = await orchestrator.executeWorkflow(firstProposal.workflowId);
        assert.strictEqual(firstExecute.status, 'completed');

        // Destructive approvals should not produce reusable grants by default.
        assert.strictEqual(approvalStore._listGrants().length, 0);

        const secondProposal = await orchestrator.orchestrate({
            sessionId: 's1', userId: 'u1', text: 'Do it again'
        });
        assert.strictEqual(secondProposal.status, 'workflow_proposed');
        assert.strictEqual(secondProposal.risk.level, 'destructive');
    });

    it('Plan approval runs multi-step external workflow without per-step prompts', async () => {
        const templateId = 'send_email_twice_for_test';
        const previousTemplate = WORKFLOW_TEMPLATES[templateId];
        WORKFLOW_TEMPLATES[templateId] = {
            id: templateId,
            description: 'Test-only multi-step external workflow',
            schema: {
                required: ['toA', 'subjectA', 'bodyA', 'toB', 'subjectB', 'bodyB'],
                optional: []
            },
            steps: (args) => [
                {
                    extensionId: 'email',
                    extensionType: 'mcp',
                    capabilityId: 'send_email',
                    args: { to: args.toA, subject: args.subjectA, body: args.bodyA }
                },
                {
                    extensionId: 'email',
                    extensionType: 'mcp',
                    capabilityId: 'send_email',
                    args: { to: args.toB, subject: args.subjectB, body: args.bodyB }
                }
            ]
        };

        try {
            setupOrchestrator({
                template: templateId,
                args: {
                    toA: 'a@example.com',
                    subjectA: 'One',
                    bodyA: 'Body one',
                    toB: 'b@example.com',
                    subjectB: 'Two',
                    bodyB: 'Body two'
                }
            });

            const proposal = await orchestrator.orchestrate({
                sessionId: 's1', userId: 'u1', text: 'Send two emails'
            });
            assert.strictEqual(proposal.status, 'workflow_proposed');
            assert.strictEqual(proposal.risk.sideEffects, 'external');
            assert.strictEqual(proposal.risk.requirements.length, 2);

            const executeResult = await orchestrator.executeWorkflow(proposal.workflowId);
            assert.strictEqual(executeResult.status, 'completed');
            assert.strictEqual(executeRequests.length, 2);
        } finally {
            if (previousTemplate) {
                WORKFLOW_TEMPLATES[templateId] = previousTemplate;
            } else {
                delete WORKFLOW_TEMPLATES[templateId];
            }
        }
    });
});
