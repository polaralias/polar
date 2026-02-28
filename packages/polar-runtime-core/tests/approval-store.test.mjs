import assert from 'node:assert';
import { test, describe, it, beforeEach } from 'node:test';
import { createApprovalStore } from '../src/approval-store.mjs';

describe('ApprovalStore', () => {
    let store;

    beforeEach(() => {
        store = createApprovalStore();
    });

    it('should issue and find a matching grant', () => {
        const principal = { userId: 'user-1' };
        const scope = {
            capabilities: [{ extensionId: 'skill.weather', capabilityId: 'get_weather' }]
        };
        const grantId = store.issueGrant(principal, scope, 3600, 'testing');

        assert.ok(grantId);

        const match = store.findMatchingGrant(principal, {
            extensionId: 'skill.weather',
            capabilityId: 'get_weather',
            userId: 'user-1'
        });

        assert.ok(match);
        assert.strictEqual(match.grantId, grantId);
    });

    it('should match wildcard extensionId', () => {
        const principal = { userId: 'user-1' };
        const scope = {
            capabilities: [{ extensionId: '*', capabilityId: 'read_logs' }]
        };
        store.issueGrant(principal, scope, 3600, 'testing');

        const match = store.findMatchingGrant(principal, {
            extensionId: 'skill.system',
            capabilityId: 'read_logs',
            userId: 'user-1'
        });

        assert.ok(match);
    });

    it('should match wildcard capabilityId', () => {
        const principal = { userId: 'user-1' };
        const scope = {
            capabilities: [{ extensionId: 'skill.weather', capabilityId: '*' }]
        };
        store.issueGrant(principal, scope, 3600, 'testing');

        const match = store.findMatchingGrant(principal, {
            extensionId: 'skill.weather',
            capabilityId: 'some_random_cap',
            userId: 'user-1'
        });

        assert.ok(match);
    });

    it('should not match different userId', () => {
        const principal = { userId: 'user-1' };
        const scope = {
            capabilities: [{ extensionId: '*', capabilityId: '*' }]
        };
        store.issueGrant(principal, scope, 3600, 'testing');

        const match = store.findMatchingGrant({ userId: 'user-2' }, {
            extensionId: 'skill.weather',
            capabilityId: 'get_weather',
            userId: 'user-2'
        });

        assert.strictEqual(match, null);
    });

    it('should respect TTL', async () => {
        const principal = { userId: 'user-1' };
        const scope = {
            capabilities: [{ extensionId: '*', capabilityId: '*' }]
        };
        // Issue grant with 0 TTL (expires immediately if cleanup runs)
        // Wait, issueGrant uses Date.now() + (ttlSeconds * 1000)
        store.issueGrant(principal, scope, -1, 'expired');

        const match = store.findMatchingGrant(principal, {
            extensionId: 'skill.weather',
            capabilityId: 'get_weather',
            userId: 'user-1'
        });

        assert.strictEqual(match, null);
    });

    it('should revoke grants', () => {
        const principal = { userId: 'user-1' };
        const scope = {
            capabilities: [{ extensionId: '*', capabilityId: '*' }]
        };
        const grantId = store.issueGrant(principal, scope, 3600, 'testing');

        store.revokeGrant(grantId);

        const match = store.findMatchingGrant(principal, {
            extensionId: 'skill.weather',
            capabilityId: 'get_weather',
            userId: 'user-1'
        });

        assert.strictEqual(match, null);
    });

    it('should enforce session/workspace principal scoping when present on grant', () => {
        const principal = { userId: 'user-1', sessionId: 'session-1', workspaceId: 'workspace-1' };
        const scope = {
            capabilities: [{ extensionId: 'skill.email', capabilityId: 'send_email' }]
        };
        store.issueGrant(principal, scope, 3600, 'testing');

        const sameScope = store.findMatchingGrant(principal, {
            extensionId: 'skill.email',
            capabilityId: 'send_email',
            userId: 'user-1',
            sessionId: 'session-1',
            workspaceId: 'workspace-1'
        });
        assert.ok(sameScope);

        const wrongSession = store.findMatchingGrant(principal, {
            extensionId: 'skill.email',
            capabilityId: 'send_email',
            userId: 'user-1',
            sessionId: 'session-2',
            workspaceId: 'workspace-1'
        });
        assert.strictEqual(wrongSession, null);

        const wrongWorkspace = store.findMatchingGrant(principal, {
            extensionId: 'skill.email',
            capabilityId: 'send_email',
            userId: 'user-1',
            sessionId: 'session-1',
            workspaceId: 'workspace-2'
        });
        assert.strictEqual(wrongWorkspace, null);
    });

    it('should match grants deterministically by capability + targets + constraints', () => {
        const principal = { userId: 'user-1' };
        const scope = {
            capabilities: [{ extensionId: 'skill.email', capabilityId: 'send_email' }],
            targets: ['mailbox:primary'],
            constraints: { domain: 'example.com', maxRecipients: 1 }
        };
        store.issueGrant(principal, scope, 3600, 'testing');

        const match = store.findMatchingGrant(principal, {
            extensionId: 'skill.email',
            capabilityId: 'send_email',
            userId: 'user-1',
            targets: ['mailbox:primary'],
            constraints: { domain: 'example.com', maxRecipients: 1 }
        });
        assert.ok(match);

        const missingTargets = store.findMatchingGrant(principal, {
            extensionId: 'skill.email',
            capabilityId: 'send_email',
            userId: 'user-1',
            constraints: { domain: 'example.com', maxRecipients: 1 }
        });
        assert.strictEqual(missingTargets, null);

        const wrongTarget = store.findMatchingGrant(principal, {
            extensionId: 'skill.email',
            capabilityId: 'send_email',
            userId: 'user-1',
            targets: ['mailbox:secondary'],
            constraints: { domain: 'example.com', maxRecipients: 1 }
        });
        assert.strictEqual(wrongTarget, null);

        const wrongConstraints = store.findMatchingGrant(principal, {
            extensionId: 'skill.email',
            capabilityId: 'send_email',
            userId: 'user-1',
            targets: ['mailbox:primary'],
            constraints: { domain: 'example.com', maxRecipients: 2 }
        });
        assert.strictEqual(wrongConstraints, null);
    });

    it('should store risk level from explicit typed argument, not from untyped scope payload', () => {
        const principal = { userId: 'user-1' };
        const scope = {
            capabilities: [{ extensionId: 'skill.email', capabilityId: 'send_email' }],
            riskLevel: 'destructive' // should be ignored
        };

        const grantId = store.issueGrant(principal, scope, 3600, 'testing');
        const stored = store._listGrants().find(g => g.grantId === grantId);
        assert.strictEqual(stored.riskLevel, 'write');

        const destructiveGrantId = store.issueGrant(
            principal,
            { capabilities: [{ extensionId: 'skill.email', capabilityId: 'delete_email' }] },
            3600,
            'destructive test',
            {},
            'destructive'
        );
        const destructiveStored = store._listGrants().find(g => g.grantId === destructiveGrantId);
        assert.strictEqual(destructiveStored.riskLevel, 'destructive');
    });
});
