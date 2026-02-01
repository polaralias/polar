import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/policy.js';
import { mintCapabilityToken, verifyCapabilityToken } from '../src/tokens.js';
import type { PolicyStore, Capability } from '../src/schemas.js';

describe('Stage 1 Security Invariants', () => {
    const secretKey = new TextEncoder().encode('test-secret-key-that-is-long-enough');

    it('proves that exceeding granted scope is rejected by policy evaluation', () => {
        const policy: PolicyStore = {
            grants: [
                {
                    id: 'grant-1',
                    subject: 'agent-1',
                    action: 'fs.readFile',
                    resource: { type: 'fs', root: path.resolve('/data/safe') },
                },
            ],
            rules: [],
        };

        const inScope = evaluatePolicy({
            subject: 'agent-1',
            action: 'fs.readFile',
            resource: { type: 'fs', path: path.resolve('/data/safe/hello.txt') },
        }, policy);

        const outOfScope = evaluatePolicy({
            subject: 'agent-1',
            action: 'fs.readFile',
            resource: { type: 'fs', path: path.resolve('/data/unsafe/secret.txt') },
        }, policy);

        expect(inScope.allowed).toBe(true);
        expect(outOfScope.allowed).toBe(false);
    });

    it('proves that expired tokens are rejected', async () => {
        const now = Math.floor(Date.now() / 1000);
        const expiredCapability: Capability = {
            id: crypto.randomUUID(),
            subject: 'agent-1',
            action: 'fs.read',
            resource: { type: 'fs', paths: ['/foo'] },
            expiresAt: now - 100, // 100 seconds ago
        };

        const token = await mintCapabilityToken(expiredCapability, secretKey);

        await expect(verifyCapabilityToken(token, secretKey)).rejects.toThrow(/claim timestamp check failed/i);
    });

    it('proves that token signature mismatch is rejected', async () => {
        const now = Math.floor(Date.now() / 1000);
        const capability: Capability = {
            id: crypto.randomUUID(),
            subject: 'agent-1',
            action: 'fs.read',
            resource: { type: 'fs', paths: ['/foo'] },
            expiresAt: now + 1000,
        };

        const token = await mintCapabilityToken(capability, secretKey);
        const wrongKey = new TextEncoder().encode('wrong-secret-key-is-also-long-enough');

        await expect(verifyCapabilityToken(token, wrongKey)).rejects.toThrow();
    });

    it('proves that explicit deny rules override grants', () => {
        const policy: PolicyStore = {
            grants: [
                {
                    id: 'grant-1',
                    subject: 'agent-1',
                    action: 'fs.readFile',
                    resource: { type: 'fs', root: path.resolve('/data') },
                },
            ],
            rules: [
                {
                    id: 'rule-deny-secrets',
                    effect: 'deny',
                    subject: 'agent-1',
                    action: 'fs.readFile',
                    resource: { type: 'fs', paths: [path.resolve('/data/secrets.txt')] },
                },
            ],
        };

        const allowed = evaluatePolicy({
            subject: 'agent-1',
            action: 'fs.readFile',
            resource: { type: 'fs', path: path.resolve('/data/public.txt') },
        }, policy);

        const denied = evaluatePolicy({
            subject: 'agent-1',
            action: 'fs.readFile',
            resource: { type: 'fs', path: path.resolve('/data/secrets.txt') },
        }, policy);

        expect(allowed.allowed).toBe(true);
        expect(denied.allowed).toBe(false);
        expect(denied.reason).toMatch(/denied by policy rule/i);
    });
});
