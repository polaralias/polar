import crypto from 'node:crypto';

/**
 * @typedef {Object} ApprovalGrant
 * @property {string} grantId
 * @property {{ userId: string, sessionId?: string, workspaceId?: string }} principal
 * @property {{
 *   capabilities: { extensionId: string, capabilityId: string }[],
 *   targets?: string[],
 *   constraints?: Record<string, any>
 * }} scope
 * @property {'write'|'destructive'} riskLevel
 * @property {number} ttlSeconds
 * @property {number} createdAt
 * @property {number} expiresAt
 * @property {string} reason
 * @property {Record<string, any>} audit
 */

export function createApprovalStore() {
    /** @type {Map<string, ApprovalGrant>} */
    const grants = new Map();

    function cleanupExpired() {
        const now = Date.now();
        for (const [id, grant] of grants.entries()) {
            if (grant.expiresAt <= now) {
                grants.delete(id);
            }
        }
    }

    return {
        /**
         * @param {{ userId: string, sessionId?: string, workspaceId?: string }} principal
         * @param {ApprovalGrant['scope']} scope
         * @param {number} ttlSeconds
         * @param {string} reason
         * @param {Record<string, any>} [audit]
         * @returns {string}
         */
        issueGrant(principal, scope, ttlSeconds, reason, audit = {}) {
            const now = Date.now();
            const grantId = crypto.randomUUID();
            const grant = {
                grantId,
                principal,
                scope: {
                    capabilities: scope.capabilities || [],
                    targets: scope.targets || [],
                    constraints: scope.constraints || {},
                },
                riskLevel: scope.riskLevel || 'write',
                ttlSeconds,
                createdAt: now,
                expiresAt: now + (ttlSeconds * 1000),
                reason,
                audit,
            };
            grants.set(grantId, grant);
            return grantId;
        },

        /**
         * @param {{ userId: string, sessionId?: string, workspaceId?: string }} principal
         * @param {{ extensionId: string, capabilityId: string, userId: string, sessionId?: string, workspaceId?: string }} request
         * @returns {ApprovalGrant|null}
         */
        findMatchingGrant(principal, request) {
            cleanupExpired();
            const { extensionId, capabilityId, userId, sessionId, workspaceId } = request;

            for (const grant of grants.values()) {
                // Check principal match
                if (grant.principal.userId !== userId) continue;

                // If grant has a specific sessionId, it must match
                if (grant.principal.sessionId && grant.principal.sessionId !== sessionId) continue;

                // If grant has a specific workspaceId, it must match
                if (grant.principal.workspaceId && grant.principal.workspaceId !== workspaceId) continue;

                // Check capability match
                const capMatch = grant.scope.capabilities.some(c =>
                    (c.extensionId === extensionId || c.extensionId === '*') &&
                    (c.capabilityId === capabilityId || c.capabilityId === '*')
                );

                if (capMatch) {
                    // In PR1 we just match based on capability identity.
                    // Future PRs will handle targets and constraints.
                    return grant;
                }
            }
            return null;
        },

        /**
         * @param {string} grantId
         */
        revokeGrant(grantId) {
            grants.delete(grantId);
        },

        cleanupExpired,

        /**
         * @returns {ApprovalGrant[]}
         */
        _listGrants() {
            return [...grants.values()];
        }
    };
}
