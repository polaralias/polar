import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { RuntimeExecutionError } from '@polar/domain';

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

/**
 * @param {unknown} value
 * @returns {'write'|'destructive'}
 */
function normalizeRiskLevel(value) {
    if (value === 'write' || value === 'destructive') {
        return value;
    }
    throw new RuntimeExecutionError(`Invalid risk level: ${String(value)}`);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeTargets(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(v => typeof v === 'string' && v.length > 0);
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
function normalizeConstraints(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value;
}

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
         * @param {'write'|'destructive'} [riskLevel]
         * @returns {string}
         */
        issueGrant(principal, scope, ttlSeconds, reason, audit = {}, riskLevel = 'write') {
            const now = Date.now();
            const grantId = crypto.randomUUID();
            const grant = {
                grantId,
                principal,
                scope: {
                    capabilities: scope.capabilities || [],
                    targets: normalizeTargets(scope.targets),
                    constraints: normalizeConstraints(scope.constraints),
                },
                riskLevel: normalizeRiskLevel(riskLevel),
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
         * @param {{
         *   extensionId: string,
         *   capabilityId: string,
         *   userId?: string,
         *   sessionId?: string,
         *   workspaceId?: string,
         *   targets?: string[],
         *   constraints?: Record<string, any>
         * }} request
         * @returns {ApprovalGrant|null}
         */
        findMatchingGrant(principal, request) {
            cleanupExpired();
            const { extensionId, capabilityId } = request;
            const userId = request.userId || principal.userId;
            const sessionId = request.sessionId || principal.sessionId;
            const workspaceId = request.workspaceId || principal.workspaceId;
            const requestedTargets = normalizeTargets(request.targets);
            const requestedConstraints = normalizeConstraints(request.constraints);

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

                if (!capMatch) continue;

                // If grant has target constraints, request must be target-scoped and in-range.
                if (grant.scope.targets?.length) {
                    if (requestedTargets.length === 0) continue;
                    const targetSet = new Set(grant.scope.targets);
                    const allTargetsAllowed = requestedTargets.every(target => targetSet.has(target));
                    if (!allTargetsAllowed) continue;
                }

                // If grant has explicit constraints, request must satisfy them exactly.
                const constraintKeys = Object.keys(grant.scope.constraints || {});
                if (constraintKeys.length > 0) {
                    let matchesConstraints = true;
                    for (const key of constraintKeys) {
                        if (!Object.prototype.hasOwnProperty.call(requestedConstraints, key)) {
                            matchesConstraints = false;
                            break;
                        }
                        if (!isDeepStrictEqual(requestedConstraints[key], grant.scope.constraints[key])) {
                            matchesConstraints = false;
                            break;
                        }
                    }
                    if (!matchesConstraints) continue;
                }

                return grant;
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
