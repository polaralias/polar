import { RuntimeExecutionError } from "../../polar-domain/src/index.mjs";

/**
 * SkillRegistry manages metadata overrides and tracked blocked skills.
 * It ensures that every capability in a skill has valid risk metadata before it can be enabled.
 * 
 * @returns {ReturnType<typeof createSkillRegistry>}
 */
export function createSkillRegistry() {
    // extensionId -> Map<capabilityId, { riskLevel, sideEffects, dataEgress, explanation }>
    const metadataOverrides = new Map();
    // extensionId -> Set<capabilityId> (IDs of capabilities that are missing required metadata)
    const blockedSkills = new Map();
    // extensionId -> Object (proposed manifest waiting for approval)
    const proposedManifests = new Map();

    return Object.freeze({
        /**
         * Store a proposed manifest for a skill.
         */
        propose(extensionId, manifest) {
            proposedManifests.set(extensionId, Object.freeze({
                ...manifest,
                proposedAt: Date.now()
            }));
        },

        /**
         * Get the proposed manifest for a skill.
         */
        getProposed(extensionId) {
            return proposedManifests.get(extensionId);
        },

        /**
         * Remove a proposed manifest (e.g. after approval or rejection).
         */
        clearProposed(extensionId) {
            proposedManifests.delete(extensionId);
        },

        /**
         * List all skills with pending manifests.
         */
        listPending() {
            return Array.from(proposedManifests.entries()).map(([extensionId, manifest]) => ({
                extensionId,
                manifest
            }));
        },

        /**
         * Submit an operator-supplied metadata override for a specific capability.
         * Requires an explanation for why the classification was chosen.
         * 
         * @param {{
         *   extensionId: string,
         *   capabilityId: string,
         *   metadata: {
         *     riskLevel: 'read'|'write'|'destructive',
         *     sideEffects: 'none'|'internal'|'external',
         *     dataEgress?: 'none'|'network',
         *     explanation: string
         *   }
         * }} request
         */
        submitOverride({ extensionId, capabilityId, metadata }) {
            if (!extensionId || !capabilityId) {
                throw new RuntimeExecutionError("extensionId and capabilityId are required for metadata override");
            }
            if (!metadata || typeof metadata.explanation !== 'string' || metadata.explanation.length < 5) {
                throw new RuntimeExecutionError("Metadata override requires an explanation (min 5 chars)");
            }
            if (!['read', 'write', 'destructive'].includes(metadata.riskLevel)) {
                throw new RuntimeExecutionError(`Invalid riskLevel: ${metadata.riskLevel}`);
            }
            if (!['none', 'internal', 'external'].includes(metadata.sideEffects)) {
                throw new RuntimeExecutionError(`Invalid sideEffects: ${metadata.sideEffects}`);
            }

            if (!metadataOverrides.has(extensionId)) {
                metadataOverrides.set(extensionId, new Map());
            }

            const extensionOverrides = metadataOverrides.get(extensionId);
            extensionOverrides.set(capabilityId, Object.freeze({
                riskLevel: metadata.riskLevel,
                sideEffects: metadata.sideEffects,
                dataEgress: metadata.dataEgress || 'unknown',
                explanation: metadata.explanation,
                updatedAt: Date.now()
            }));

            // If this was a missing field that's now resolved, we might be able to unblock.
            // However, unblocking depends on ALL capabilities being resolved, which is checked during install/enable.
            const missing = blockedSkills.get(extensionId);
            if (Array.isArray(missing)) {
                const refreshed = missing.filter(m => m.capabilityId !== capabilityId);
                if (refreshed.length === 0) {
                    blockedSkills.delete(extensionId);
                } else {
                    blockedSkills.set(extensionId, Object.freeze(refreshed));
                }
            }
        },

        /**
         * Retrieve the persistent override for a capability.
         */
        getOverride(extensionId, capabilityId) {
            return metadataOverrides.get(extensionId)?.get(capabilityId);
        },

        /**
         * Record that a skill is blocked due to missing metadata.
         * @param {string} extensionId
         * @param {Array<{ capabilityId: string, missingFields: string[] }>} missingMetadata
         */
        markBlocked(extensionId, missingMetadata) {
            blockedSkills.set(extensionId, Object.freeze([...missingMetadata]));
        },

        /**
         * Clear blocked status.
         */
        unblock(extensionId) {
            blockedSkills.delete(extensionId);
        },

        /**
         * List blocked skills and their missing fields.
         */
        listBlocked() {
            return Array.from(blockedSkills.entries()).map(([extensionId, missingMetadata]) => ({
                extensionId,
                missingMetadata,
            }));
        },

        /**
         * Check if a skill is currently blocked.
         */
        isBlocked(extensionId) {
            return blockedSkills.has(extensionId);
        },

        /**
         * Validate and enrich capabilities with metadata from the registry.
         * 
         * @param {string} extensionId
         * @param {Array<Record<string, any>>} capabilities
         * @returns {{ enriched: Array<Record<string, any>>, missingMetadata: Array<{ capabilityId: string, missingFields: string[] }> }}
         */
        processMetadata(extensionId, capabilities) {
            const missingMetadata = [];
            const enriched = capabilities.map(cap => {
                const override = metadataOverrides.get(extensionId)?.get(cap.capabilityId);
                const riskLevel = override?.riskLevel || cap.riskLevel || 'unknown';
                const sideEffects = override?.sideEffects || cap.sideEffects || 'unknown';
                const dataEgress = override?.dataEgress || cap.dataEgress || 'unknown';

                if (riskLevel === 'unknown' || sideEffects === 'unknown') {
                    missingMetadata.push({
                        capabilityId: cap.capabilityId,
                        missingFields: [
                            ...(riskLevel === 'unknown' ? ['riskLevel'] : []),
                            ...(sideEffects === 'unknown' ? ['sideEffects'] : [])
                        ]
                    });
                }

                return {
                    ...cap,
                    riskLevel,
                    sideEffects,
                    dataEgress,
                    metadataSource: override ? 'operator' : 'manifest'
                };
            });

            return { enriched, missingMetadata };
        }
    });
}
