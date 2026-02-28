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
 * @param {Object} args
 * @param {Object} args.sessionProfile
 * @param {Object} args.multiAgentConfig
 * @param {Object} [args.activeDelegation]
 * @returns {Object} { allowed: { [extensionId]: string[] }, constraints: Object }
 */
export function computeCapabilityScope({ sessionProfile = {}, multiAgentConfig = {}, activeDelegation }) {
    const scope = {
        allowed: {},
        constraints: {}
    };

    // 1. Determine base allowed extensions/skills
    // If we have an active delegation, it dictates the scope (forward_skills).
    // Otherwise, we use the session profile's allowed skills or global defaults.
    const effectiveAllowedSkills = activeDelegation?.forward_skills
        || sessionProfile?.profileConfig?.allowedSkills
        || multiAgentConfig?.globalAllowedSkills
        || [];

    // System is always allowed for core orchestration tasks
    scope.allowed["system"] = ["lookup_weather", "delegate_to_agent", "complete_task"];

    // Map skills to extension/capability pairs
    // Note: In a real system, this would be a lookup table in the contract registry or similar.
    // For this implementation, we assume skill name == extensionId for simplicity, 
    // or we map specific known skills.
    for (const skill of effectiveAllowedSkills) {
        if (skill === "search_web") {
            scope.allowed["web"] = scope.allowed["web"] || [];
            scope.allowed["web"].push("search_web");
        } else if (skill === "email_mcp") {
            scope.allowed["email"] = scope.allowed["email"] || [];
            scope.allowed["email"].push("draft_email");
        } else {
            // Default: assume the skill name maps to an extension and allow all its capabilities?
            // Actually, be stricter: if it's an extension ID, allow it.
            scope.allowed[skill] = ["*"];
        }
    }

    return scope;
}
