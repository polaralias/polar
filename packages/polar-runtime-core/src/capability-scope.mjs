/**
 * Validates requested forward_skills against a server-side allowlist.
 * @param {Object} args
 * @param {string[]} args.forwardSkills
 * @param {Object} args.sessionProfile
 * @param {Object} args.multiAgentConfig
 * @returns {{ allowedSkills: string[], rejectedSkills: string[], isBlocked: boolean }}
 */
export function validateForwardSkills({ forwardSkills = [], sessionProfile = {}, multiAgentConfig = {} }) {
    // 1. Resolve effective allowlist
    // Order: Profile Specific > Global Config > Strict Default (Empty)
    const serverAllowlist = sessionProfile?.profileConfig?.allowedSkills
        || multiAgentConfig?.globalAllowedSkills
        || [];

    const allowedSet = new Set(serverAllowlist);
    const allowedSkills = [];
    const rejectedSkills = [];

    for (const skill of forwardSkills) {
        if (allowedSet.has(skill)) {
            allowedSkills.push(skill);
        } else {
            rejectedSkills.push(skill);
        }
    }

    // 2. Safe defaults: block delegation if no skills are allowed, 
    // unless the policy explicitly allows "delegate with no tools".
    const allowEmptySkills = multiAgentConfig?.allowEmptySkillsDelegation === true;
    const isBlocked = allowedSkills.length === 0 && forwardSkills.length > 0 && !allowEmptySkills;

    return { allowedSkills, rejectedSkills, isBlocked };
}

/**
 * Validates model override request.
 * @param {Object} args
 * @param {string} [args.modelOverride]
 * @param {Object} args.multiAgentConfig
 * @param {Object} args.basePolicy
 * @returns {{ providerId: string, modelId: string, rejectedReason?: string }}
 */
export function validateModelOverride({ modelOverride, multiAgentConfig = {}, basePolicy = {} }) {
    const allowlistedModels = multiAgentConfig.allowlistedModels || [
        "gpt-4.1-mini", "claude-sonnet-4-6", "gemini-3.1-pro-preview"
    ];

    if (!modelOverride) {
        return {
            providerId: basePolicy.providerId || "openai",
            modelId: basePolicy.modelId || "gpt-4.1-mini"
        };
    }

    // 1. Allowlist clamping
    if (!allowlistedModels.includes(modelOverride)) {
        return {
            providerId: basePolicy.providerId || "openai",
            modelId: basePolicy.modelId || "gpt-4.1-mini",
            rejectedReason: `Model "${modelOverride}" is not in the server allowlist.`
        };
    }

    // 2. Budget clamping (placeholder for actual budget check if needed, 
    // for now we just verify it exists in a recognized provider mapping)
    let providerId = basePolicy.providerId || "openai";
    if (modelOverride.startsWith("claude")) providerId = "anthropic";
    else if (modelOverride.startsWith("gemini")) providerId = "google";
    else if (modelOverride.startsWith("gpt")) providerId = "openai";
    else if (modelOverride.startsWith("deepseek")) providerId = "deepseek";

    return { providerId, modelId: modelOverride };
}
/**
 * Computes a strict capability scope for tool execution.
 * Only explicitly enabled extensions grant capabilities.
 * @param {Object} args
 * @param {Object} args.sessionProfile
 * @param {Object} args.multiAgentConfig
 * @param {Object} [args.activeDelegation]
 * @param {Array<Object>} [args.installedExtensions] - List of states from extensionGateway
 * @returns {{ allowed: Record<string, string[]>, constraints: Object, rejectedSkills: string[] }}
 */
export function computeCapabilityScope({ sessionProfile = {}, multiAgentConfig = {}, activeDelegation, installedExtensions = [] }) {
    const scope = {
        allowed: {},
        constraints: {},
    };
    const rejectedSkills = [];

    // System is always allowed for core orchestration tasks
    scope.allowed["system"] = ["lookup_weather", "delegate_to_agent", "complete_task"];

    // 1. Determine base allowed skills/behaviors
    const effectiveAllowedSkills = activeDelegation?.forward_skills
        || sessionProfile?.profileConfig?.allowedSkills
        || multiAgentConfig?.globalAllowedSkills
        || [];

    // 2. Discover capabilities from installed extensions that match allowed skills
    // In this model, a "skill" name in the allowlist corresponds to a skill's extensionId.
    for (const skill of effectiveAllowedSkills) {
        const extension = installedExtensions.find(e => e.extensionId === skill && e.lifecycleState === 'enabled');
        if (extension) {
            // If the extension is enabled, allow all its capabilities (or strictly what's in manifest)
            const allowedCaps = (Array.isArray(extension.capabilities) ? extension.capabilities : [])
                .map(c => typeof c === 'string' ? c : c.capabilityId)
                .filter(Boolean);

            scope.allowed[extension.extensionId] = allowedCaps;
        } else {
            // Keep hardcoded fallback for legacy system tools if needed, or just reject
            rejectedSkills.push(skill);
        }
    }

    scope.rejectedSkills = rejectedSkills;
    return scope;
}
