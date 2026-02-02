import { describe, expect, it } from 'vitest';
import { matchesResourceConstraint, evaluatePolicy } from '../src/policy.js';
import { HttpResourceConstraint, HttpResource, PolicyStore } from '../src/schemas.js';

describe('Phase 2 Stage 1: Skills & Templates (Security Infrastructure)', () => {

    describe('HTTP Egress Constraints', () => {
        it('matches exact hostnames', () => {
            const constraint: HttpResourceConstraint = {
                type: 'http',
                allowHosts: ['api.github.com'],
            };
            const resource: HttpResource = {
                type: 'http',
                url: 'https://api.github.com/user',
            };
            const untrusted: HttpResource = {
                type: 'http',
                url: 'https://evil.com/payload',
            };

            expect(matchesResourceConstraint(constraint, resource)).toBe(true);
            expect(matchesResourceConstraint(constraint, untrusted)).toBe(false);
        });

        it('matches wildcard subdomains (*.github.com)', () => {
            const constraint: HttpResourceConstraint = {
                type: 'http',
                allowHosts: ['*.github.com'],
            };

            expect(matchesResourceConstraint(constraint, { type: 'http', url: 'https://api.github.com/user' })).toBe(true);
            expect(matchesResourceConstraint(constraint, { type: 'http', url: 'https://raw.github.com/file' })).toBe(true);
            expect(matchesResourceConstraint(constraint, { type: 'http', url: 'https://github.com/repo' })).toBe(true);
            expect(matchesResourceConstraint(constraint, { type: 'http', url: 'https://evilgithub.com' })).toBe(false);
        });

        it('enforces allowMethods', () => {
            const constraint: HttpResourceConstraint = {
                type: 'http',
                allowHosts: ['api.github.com'],
                allowMethods: ['GET'],
            };

            expect(matchesResourceConstraint(constraint, { type: 'http', url: 'https://api.github.com/user', method: 'GET' })).toBe(true);
            expect(matchesResourceConstraint(constraint, { type: 'http', url: 'https://api.github.com/user', method: 'POST' })).toBe(false);
        });
    });

    describe('Policy Evaluation with HTTP', () => {
        it('allows http requests when granted', () => {
            const policy: PolicyStore = {
                grants: [
                    {
                        id: 'grant-http',
                        subject: 'worker-1',
                        action: 'http.request',
                        resource: {
                            type: 'http',
                            allowHosts: ['*.github.com'],
                        }
                    }
                ],
                rules: [],
            };

            const decision = evaluatePolicy({
                subject: 'worker-1',
                action: 'http.request',
                resource: { type: 'http', url: 'https://api.github.com/user' }
            }, policy);

            expect(decision.allowed).toBe(true);
            expect(decision.capabilityConstraints?.resource.type).toBe('http');
            // Check narrowing
            const constraints = decision.capabilityConstraints?.resource as HttpResourceConstraint;
            expect(constraints.allowHosts).toContain('api.github.com');
        });
    });

    describe('Generic Connector Constraints', () => {
        it('matches connectorId and resourceIds', () => {
            const constraint = {
                type: 'connector' as const,
                connectorId: 'google.mail',
                constraints: { resourceIds: ['msg-123'] }
            };

            expect(matchesResourceConstraint(constraint, {
                type: 'connector',
                connectorId: 'google.mail',
                resourceId: 'msg-123'
            })).toBe(true);

            expect(matchesResourceConstraint(constraint, {
                type: 'connector',
                connectorId: 'google.mail',
                resourceId: 'msg-456'
            })).toBe(false);

            expect(matchesResourceConstraint(constraint, {
                type: 'connector',
                connectorId: 'github.repo',
                resourceId: 'msg-123'
            })).toBe(false);
        });

        it('allows narrowing for generic connectors', () => {
            const policy: PolicyStore = {
                grants: [
                    {
                        id: 'grant-mail',
                        subject: 'worker-1',
                        action: 'mail.read',
                        resource: {
                            type: 'connector',
                            connectorId: 'google.mail',
                            constraints: { resourceIds: ['msg-1', 'msg-2'] }
                        }
                    }
                ],
                rules: [],
            };

            const decision = evaluatePolicy({
                subject: 'worker-1',
                action: 'mail.read',
                resource: { type: 'connector', connectorId: 'google.mail', resourceId: 'msg-1' }
            }, policy);

            expect(decision.allowed).toBe(true);
            const constraints = decision.capabilityConstraints?.resource as any;
            expect(constraints.type).toBe('connector');
            expect(constraints.constraints.resourceIds).toContain('msg-1');
        });
    });

    describe('SKILL.md Parsing', () => {
        it('parses valid frontmatter and instructions', async () => {
            const { parseSkillMarkdown } = await import('../src/skills.js');
            const content = `---\nauthor: Antigravity\nversion: 1.0.0\n---\n# Instructions\nDo things.`;
            const parsed = parseSkillMarkdown(content);
            expect(parsed.metadata?.author).toBe('Antigravity');
            expect(parsed.metadata?.version).toBe('1.0.0');
            expect(parsed.instructions).toBe('# Instructions\nDo things.');
        });

        it('handles missing frontmatter', async () => {
            const { parseSkillMarkdown } = await import('../src/skills.js');
            const content = `# Just Instructions`;
            const parsed = parseSkillMarkdown(content);
            expect(parsed.metadata).toEqual({});
            expect(parsed.instructions).toBe('# Just Instructions');
        });
    });
});
