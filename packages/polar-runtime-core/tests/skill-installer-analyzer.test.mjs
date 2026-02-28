import assert from 'node:assert';
import { createSkillInstallerGateway } from '../src/skill-installer-gateway.mjs';
import { createSkillRegistry } from '../src/skill-registry.mjs';
import { createExtensionGateway } from '../src/extension-gateway.mjs';
import { createMiddlewarePipeline } from '../src/middleware-pipeline.mjs';

describe('Skill Installer: Analyzer & Lifecycle', () => {
    let installerGateway;
    let skillRegistry;
    let extensionGateway;
    let mockProvider;
    let mockExtensionStates;

    beforeEach(() => {
        skillRegistry = createSkillRegistry();
        mockExtensionStates = new Map();

        const mockMiddlewarePipeline = createMiddlewarePipeline({
            contractRegistry: {
                register: () => { },
                has: () => true,
                get: () => ({
                    inputSchema: { validate: (v) => ({ ok: true, value: v }) },
                    outputSchema: { validate: (v) => ({ ok: true, value: v }) },
                    riskClass: 'low',
                    trustClass: 'native'
                })
            },
            middleware: []
        });

        extensionGateway = {
            getState: (id) => mockExtensionStates.get(id),
            applyLifecycle: async (req) => {
                const state = {
                    extensionId: req.extensionId,
                    extensionType: req.extensionType,
                    lifecycleState: req.metadata?.status === 'pending_install' ? 'pending_install' : 'installed',
                    trustLevel: 'sandboxed',
                    permissions: req.requestedPermissions || []
                };
                mockExtensionStates.set(req.extensionId, state);
                return { status: 'applied', lifecycleState: state.lifecycleState };
            }
        };

        mockProvider = {
            generate: async () => ({
                text: JSON.stringify({
                    extensionId: 'test_skill',
                    version: '1.0.0',
                    capabilities: [{ capabilityId: 'search_tool' }]
                })
            })
        };

        installerGateway = createSkillInstallerGateway({
            middlewarePipeline: mockMiddlewarePipeline,
            extensionGateway,
            extensionRegistry: { upsert: () => { } },
            skillAdapter: {
                parseSkillManifest: (s) => JSON.parse(s),
                verifySkillProvenance: () => ({ trustLevelRecommendation: 'sandboxed' }),
                createSkillCapabilityAdapter: () => ({ executeCapability: () => { } })
            },
            skillRegistry,
            providerGateway: mockProvider
        });
    });

    it('proposeManifest should set state to pending_install and store proposal', async () => {
        const result = await installerGateway.proposeManifest({
            sourceUri: 'file:///test',
            skillContent: 'Test Skill',
            mcpInventory: [{ name: 'search_tool' }]
        });

        assert.strictEqual(result.status, 'applied');
        assert.strictEqual(result.extensionId, 'test_skill');

        const state = extensionGateway.getState('test_skill');
        assert.strictEqual(state.lifecycleState, 'pending_install');

        const proposal = skillRegistry.getProposed('test_skill');
        assert.ok(proposal);
        assert.strictEqual(proposal.extensionId, 'test_skill');
    });

    it('install should move from pending_install to installed and clear proposal', async () => {
        // First propose
        await installerGateway.proposeManifest({
            sourceUri: 'file:///test',
            skillContent: 'Test Skill',
            mcpInventory: [{ name: 'search_tool' }]
        });

        // Now install using the manifest from the proposal
        const proposal = skillRegistry.getProposed('test_skill');

        try {
            const installResult = await installerGateway.install({
                sourceUri: 'file:///test',
                skillManifest: JSON.stringify({
                    ...proposal,
                    capabilities: [{ capabilityId: 'search_tool', riskLevel: 'read', sideEffects: 'none' }]
                })
            });

            assert.strictEqual(installResult.status, 'applied');
            assert.strictEqual(installResult.lifecycleState, 'installed');

            // Proposal should be cleared
            assert.strictEqual(skillRegistry.getProposed('test_skill'), undefined);
        } catch (e) {
            console.error('INSTALL ERROR:', JSON.stringify(e, null, 2), e.stack);
            throw e;
        }
    });

    it('install should block if proposal manifest is used but lacks risk metadata', async () => {
        await installerGateway.proposeManifest({
            sourceUri: 'file:///test',
            skillContent: 'Test Skill',
            mcpInventory: [{ name: 'search_tool' }]
        });

        const proposal = skillRegistry.getProposed('test_skill');

        // Attempt install without risk metadata (analyzer output)
        const installResult = await installerGateway.install({
            sourceUri: 'file:///test',
            skillManifest: JSON.stringify(proposal)
        });

        assert.strictEqual(installResult.status, 'rejected');
        assert.strictEqual(installResult.reason, 'Skill metadata required');
        assert.ok(skillRegistry.isBlocked('test_skill'));
    });

    it('proposeManifest should fail if it invents capabilities not in inventory', async () => {
        mockProvider.generate = async () => ({
            text: JSON.stringify({
                extensionId: 'bad_skill',
                capabilities: [{ capabilityId: 'phantom_tool' }]
            })
        });

        await assert.rejects(
            installerGateway.proposeManifest({
                sourceUri: 'file:///test',
                skillContent: 'Test Skill',
                mcpInventory: [{ name: 'search_tool' }]
            }),
            /Proposed manifest includes unknown capability: phantom_tool/
        );
    });
});
