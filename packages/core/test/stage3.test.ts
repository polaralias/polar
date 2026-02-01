import { describe, it, expect } from 'vitest';
import { evaluatePolicy, PolicyRequest } from '../src/policy.js';
import { PolicyStore, MemoryResource } from '../src/schemas.js';

describe('Stage 3: Memory Policy Evaluation', () => {
    const mockPolicy: PolicyStore = {
        grants: [
            {
                id: 'grant-1',
                subject: 'agent-1',
                action: 'read',
                resource: {
                    type: 'memory',
                    memoryType: 'session',
                    scopeIds: ['session-123'],
                },
            },
            {
                id: 'grant-2',
                subject: 'agent-1',
                action: 'propose',
                resource: {
                    type: 'memory',
                    memoryType: 'session',
                    scopeIds: ['session-123'],
                },
            },
        ],
        rules: [
            {
                id: 'rule-1',
                effect: 'deny',
                action: 'read',
                resource: {
                    type: 'memory',
                    memoryType: 'profile',
                },
                reason: 'Profile memory read is restricted',
            },
        ],
    };

    it('allows read for granted session memory', () => {
        const request: PolicyRequest = {
            subject: 'agent-1',
            action: 'read',
            resource: {
                type: 'memory',
                memoryType: 'session',
                scopeId: 'session-123',
            } as MemoryResource,
        };

        const decision = evaluatePolicy(request, mockPolicy);
        expect(decision.allowed).toBe(true);
        expect(decision.capabilityConstraints?.resource.type).toBe('memory');
        if (decision.capabilityConstraints?.resource.type === 'memory') {
            expect(decision.capabilityConstraints.resource.scopeIds).toContain('session-123');
        }
    });

    it('denies read for different scope', () => {
        const request: PolicyRequest = {
            subject: 'agent-1',
            action: 'read',
            resource: {
                type: 'memory',
                memoryType: 'session',
                scopeId: 'session-456',
            } as MemoryResource,
        };

        const decision = evaluatePolicy(request, mockPolicy);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('No matching grant');
    });

    it('denies read for restricted memory type (profile)', () => {
        const request: PolicyRequest = {
            subject: 'agent-1',
            action: 'read',
            resource: {
                type: 'memory',
                memoryType: 'profile',
                scopeId: 'user-1',
            } as MemoryResource,
        };

        const decision = evaluatePolicy(request, mockPolicy);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('Profile memory read is restricted');
    });

    it('allows propose for granted session memory', () => {
        const request: PolicyRequest = {
            subject: 'agent-1',
            action: 'propose',
            resource: {
                type: 'memory',
                memoryType: 'session',
                scopeId: 'session-123',
            } as MemoryResource,
        };

        const decision = evaluatePolicy(request, mockPolicy);
        expect(decision.allowed).toBe(true);
    });
});
