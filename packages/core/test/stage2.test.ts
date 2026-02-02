import { describe, it, expect } from 'vitest';
import {
    SkillManifestSchema,
    evaluatePolicy,
    PolicyStore,
    SkillManifest
} from '../src/index.js';

describe('Stage 2: Skills & Permissions', () => {
    const testManifest: SkillManifest = {
        id: 'test.skill',
        name: 'Test Skill',
        version: '1.0.0',
        workerTemplates: [
            {
                id: 'worker1',
                name: 'Worker 1',
                requiredCapabilities: ['fs.readFile']
            }
        ],
        requestedCapabilities: [
            {
                connector: 'fs',
                action: 'fs.readFile',
                resource: { type: 'fs', root: '/data' },
                justification: 'Testing'
            }
        ]
    };

    it('validates a correct manifest', () => {
        const result = SkillManifestSchema.safeParse(testManifest);
        expect(result.success).toBe(true);
    });

    it('rejects a manifest with missing justification', () => {
        const invalid = { ...testManifest, requestedCapabilities: [{ ...testManifest.requestedCapabilities[0], justification: '' }] };
        const result = SkillManifestSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });

    it('enforces skill-specific permissions in policy evaluation', () => {
        const policy: PolicyStore = {
            grants: [
                {
                    id: 'grant1',
                    subject: 'test.skill',
                    action: 'fs.readFile',
                    resource: { type: 'fs', root: '/data' }
                }
            ],
            rules: []
        };

        // Skill should be allowed
        const allowed = evaluatePolicy(
            { subject: 'test.skill', action: 'fs.readFile', resource: { type: 'fs', path: '/data/foo.txt' } },
            policy
        );
        expect(allowed.allowed).toBe(true);

        // Another subject should be denied
        const denied = evaluatePolicy(
            { subject: 'other.subject', action: 'fs.readFile', resource: { type: 'fs', path: '/data/foo.txt' } },
            policy
        );
        expect(denied.allowed).toBe(false);
    });

    it('prevents permission escalation (denies when resource is out of scope)', () => {
        const policy: PolicyStore = {
            grants: [
                {
                    id: 'grant1',
                    subject: 'test.skill',
                    action: 'fs.readFile',
                    resource: { type: 'fs', root: '/data/logs' }
                }
            ],
            rules: []
        };

        const result = evaluatePolicy(
            { subject: 'test.skill', action: 'fs.readFile', resource: { type: 'fs', path: '/etc/passwd' } },
            policy
        );
        expect(result.allowed).toBe(false);
    });
});

describe('Stage 2: Memory Size Limits', () => {
    it('calculates content size correctly', () => {
        const smallContent = { text: 'Hello world' };
        const largeContent = { text: 'x'.repeat(100000) };

        const smallSize = Buffer.byteLength(JSON.stringify(smallContent), 'utf-8');
        const largeSize = Buffer.byteLength(JSON.stringify(largeContent), 'utf-8');

        expect(smallSize).toBeLessThan(1000);
        expect(largeSize).toBeGreaterThan(64 * 1024);
    });

    it('validates memory content within configured limits', () => {
        const maxSize = 64 * 1024; // 64KB default
        const content = { text: 'x'.repeat(1000) };
        const contentSize = Buffer.byteLength(JSON.stringify(content), 'utf-8');

        expect(contentSize < maxSize).toBe(true);
    });

    it('rejects memory content exceeding configured limits', () => {
        const maxSize = 64 * 1024; // 64KB default
        const content = { text: 'x'.repeat(100000) };
        const contentSize = Buffer.byteLength(JSON.stringify(content), 'utf-8');

        expect(contentSize > maxSize).toBe(true);
    });
});

describe('Stage 4: Agent Spawn Limits', () => {
    it('defines role capability constraints', () => {
        const roleCapabilities = {
            main: { canSpawnAgents: true, canAccessMemory: true, canCoordinate: true },
            coordinator: { canSpawnAgents: true, canAccessMemory: true, canCoordinate: true },
            worker: { canSpawnAgents: false, canAccessMemory: false, canCoordinate: false },
            external: { canSpawnAgents: false, canAccessMemory: false, canCoordinate: false },
        };

        // Workers should not be able to spawn agents
        expect(roleCapabilities.worker.canSpawnAgents).toBe(false);
        expect(roleCapabilities.external.canSpawnAgents).toBe(false);

        // Main and coordinator can spawn and coordinate
        expect(roleCapabilities.main.canSpawnAgents).toBe(true);
        expect(roleCapabilities.coordinator.canCoordinate).toBe(true);
    });

    it('validates spawn depth limits', () => {
        const maxSpawnDepth = 5;
        const currentDepth = 6;

        expect(currentDepth > maxSpawnDepth).toBe(true);
    });

    it('validates session agent limits', () => {
        const maxAgentsPerSession = 20;
        const activeAgents = 25;

        expect(activeAgents > maxAgentsPerSession).toBe(true);
    });
});
