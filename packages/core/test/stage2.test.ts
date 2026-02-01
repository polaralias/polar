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
