import { SkillManifest, PermissionDiff } from './schemas.js';


// Simple deep equality check for our JSON-serializable objects
function isDeepEqual(a: any, b: any): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

export function calculatePermissionDiff(
    oldManifest: SkillManifest,
    newManifest: SkillManifest
): PermissionDiff {
    const diff: PermissionDiff = {
        added: [],
        removed: [],
        changed: [],
    };

    const oldCaps = oldManifest.requestedCapabilities || [];
    const newCaps = newManifest.requestedCapabilities || [];

    // Identify Added
    for (const newCap of newCaps) {
        // A capability is "added" if no equivalent capability exists in the old set.
        // Equivalence here means strictly equal action and resource. 
        // Note: usage description/justification might change, but that's not a permission *scope* change per se, 
        // though strictly speaking we might want to flag it. 
        // For Stage 7, let's stick to functional permission: action + resource.

        const exists = oldCaps.some(
            (oldCap) =>
                oldCap.action === newCap.action &&
                isDeepEqual(oldCap.resource, newCap.resource)
        );

        if (!exists) {
            diff.added.push(newCap as any);
        }
    }

    // Identify Removed
    for (const oldCap of oldCaps) {
        const exists = newCaps.some(
            (newCap) =>
                newCap.action === oldCap.action &&
                isDeepEqual(newCap.resource, oldCap.resource)
        );

        if (!exists) {
            diff.removed.push(oldCap as any);
        }
    }

    // Identify Changed (Scope widening/narrowing)
    // This is tricky with the "added/removed" logic above. 
    // If we treat every distinct (action, resource) pair as unique, then "changing" a resource 
    // from "read /tmp" to "read /" is actually: remove "read /tmp", add "read /".
    // This is safer and clearer than trying to guess if two different capabilities are "versions" of each other.
    // So for now, 'changed' might be empty or used for other metadata like worker templates inputs/outputs.

    // Let's check Worker Templates for changes
    // This is less critical for security permissions but important for functionality.
    // We'll leave it simple for now: distinct capabilities = add/remove.

    return diff;
}
