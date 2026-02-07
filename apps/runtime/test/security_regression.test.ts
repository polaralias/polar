import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Set up temporary data directory before importing any runtime code
const tempDir = path.join(os.tmpdir(), `polar-test-${Date.now()}`);
process.env.RUNTIME_DATA_DIR = tempDir;

import { mintCapabilityToken, verifyCapabilityToken } from '@polar/core';

let getSubjectPolicyVersion: (subject: string) => Promise<number>;
let savePolicy: (policy: { grants: []; rules: []; policyVersions?: Record<string, number> }) => Promise<void>;
let isTokenRevoked: (jti: string) => Promise<boolean>;
let revokeToken: (jti: string, reason?: string) => Promise<void>;
let setEmergencyMode: (enabled: boolean, reason?: string) => Promise<{ mode: 'normal' | 'emergency' }>;
let getSystemStatus: () => Promise<{ mode: 'normal' | 'emergency' }>;

describe('Security Regression Tests', () => {
    let signingKey: Uint8Array;

    beforeAll(async () => {
        await fs.mkdir(tempDir, { recursive: true });
        // Generate a dummy signing key for tests
        const dummyKey = 'test-signing-key-1234567890123456';
        await fs.writeFile(path.join(tempDir, 'signing.key'), dummyKey);
        signingKey = new TextEncoder().encode(dummyKey);

        // Import runtime services after env var setup so config paths bind to tempDir.
        const policyStore = await import('../src/policyStore.js');
        const revocationStore = await import('../src/revocationStore.js');
        const systemStore = await import('../src/systemStore.js');

        getSubjectPolicyVersion = policyStore.getSubjectPolicyVersion;
        savePolicy = policyStore.savePolicy as unknown as (policy: { grants: []; rules: []; policyVersions?: Record<string, number> }) => Promise<void>;
        isTokenRevoked = revocationStore.isTokenRevoked;
        revokeToken = revocationStore.revokeToken;
        setEmergencyMode = systemStore.setEmergencyMode as unknown as (enabled: boolean, reason?: string) => Promise<{ mode: 'normal' | 'emergency' }>;
        getSystemStatus = systemStore.getSystemStatus as unknown as () => Promise<{ mode: 'normal' | 'emergency' }>;
    });

    beforeEach(async () => {
        await savePolicy({ grants: [], rules: [], policyVersions: {} });
        await fs.rm(path.join(tempDir, 'revoked_tokens.json'), { force: true });
        await fs.rm(path.join(tempDir, 'system_status.json'), { force: true });
    });

    afterAll(async () => {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    // Helper that implements the core of the introspection logic from index.ts
    async function introspect(token: string): Promise<{ active: boolean; error?: string }> {
        try {
            const payload = await verifyCapabilityToken(token, signingKey);

            // 1. Check policy version
            const currentVer = await getSubjectPolicyVersion(payload.sub);
            if (payload.pol_ver !== undefined && payload.pol_ver < currentVer) {
                return { active: false, error: 'Token revoked (policy version mismatch)' };
            }

            // 2. Check system status (Emergency Mode)
            const status = await getSystemStatus();
            if (status.mode === 'emergency') {
                // Line 877 in index.ts: returns { active: false, error: 'System is in EMERGENCY MODE' }
                return { active: false, error: 'System is in EMERGENCY MODE' };
            }

            // 3. Check JTI revocation
            if (await isTokenRevoked(payload.jti)) {
                return { active: false, error: 'Token revoked (JTI blocked)' };
            }

            return { active: true };
        } catch (err) {
            return { active: false, error: (err as Error).message };
        }
    }

    it('revocation-by-version: should invalidate tokens when policy version increases', async () => {
        const subject = 'test-skill';
        const initialVer = await getSubjectPolicyVersion(subject);

        const capability = {
            id: 'cap-version-test',
            subject,
            action: 'fs.read',
            resource: { type: 'fs' as const, path: '/foo' },
            expiresAt: Math.floor(Date.now() / 1000) + 60,
        };

        const token = await mintCapabilityToken(capability, signingKey, initialVer);

        // Should be active initially
        const res1 = await introspect(token);
        expect(res1.active).toBe(true);

        // Bump version by updating policy
        await savePolicy({
            grants: [],
            rules: [],
            policyVersions: { [subject]: initialVer + 1 },
        });

        // Should now be inactive
        const res2 = await introspect(token);
        expect(res2.active).toBe(false);
        expect(res2.error).toContain('policy version mismatch');
    });

    it('JTI revoke: should block specific token IDs', async () => {
        const subject = 'test-user';
        const jti = 'jti-to-be-revoked';

        const capability = {
            id: jti,
            subject,
            action: 'fs.read',
            resource: { type: 'fs' as const, path: '/bar' },
            expiresAt: Math.floor(Date.now() / 1000) + 60,
        };

        const token = await mintCapabilityToken(capability, signingKey, 0);

        // Should be active initially
        const res1 = await introspect(token);
        expect(res1.active).toBe(true);

        // Revoke the JTI
        await revokeToken(jti);

        // Should now be inactive
        const res2 = await introspect(token);
        expect(res2.active).toBe(false);
        expect(res2.error).toContain('JTI blocked');
    });

    it('emergency mode: should block actions globally', async () => {
        const subject = 'test-user-2';
        const capability = {
            id: 'cap-emergency-test',
            subject,
            action: 'fs.write',
            resource: { type: 'fs' as const, path: '/baz' },
            expiresAt: Math.floor(Date.now() / 1000) + 60,
        };

        const token = await mintCapabilityToken(capability, signingKey, 0);

        // Should be active initially
        const res1 = await introspect(token);
        expect(res1.active).toBe(true);

        // Enable emergency mode
        await setEmergencyMode(true, 'Regression testing');

        // Should now be inactive
        const res2 = await introspect(token);
        expect(res2.active).toBe(false);
        expect(res2.error).toContain('EMERGENCY MODE');

        // Restore normal mode
        await setEmergencyMode(false);
        const res3 = await introspect(token);
        expect(res3.active).toBe(true);
    });
});
