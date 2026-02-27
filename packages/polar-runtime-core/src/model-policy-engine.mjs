/**
 * Model Policy Engine
 * Standardizes the resolution of a "Model Lane" (e.g., "local", "brain")
 * to a concrete provider and model implementation.
 */
export function createModelPolicyEngine() {
    // Standard Lane Defaults - can be overridden by user configuration
    const LANE_DEFAULTS = {
        'local': { providerId: 'openai', model: 'gpt-4o-mini' }, // Fast, cheap
        'worker': { providerId: 'openai', model: 'gpt-4o' },      // Balanced
        'brain': { providerId: 'anthropic', model: 'claude-3-7-sonnet-20250219' }, // High intelligence
        'strategy': { providerId: 'anthropic', model: 'claude-3-7-sonnet-20250219' },
        'extraction': { providerId: 'openai', model: 'gpt-4o-mini' }
    };

    return Object.freeze({
        /**
         * Resolves a lane or model to a concrete provider/model pair.
         * @param {{ modelLane?: string, model?: string, providerId?: string }} request
         */
        resolve(request) {
            const { modelLane, model, providerId } = request;

            // 1. Explicit Provider/Model takes precedence
            if (providerId && model) {
                return { providerId, model };
            }

            // 2. Resolve via Lane
            if (modelLane && LANE_DEFAULTS[modelLane]) {
                const laneDefault = LANE_DEFAULTS[modelLane];
                return {
                    providerId: providerId || laneDefault.providerId,
                    model: model || laneDefault.model
                };
            }

            // 3. Fallback to default lane if nothing specified
            const defaultLane = LANE_DEFAULTS['worker'];
            return {
                providerId: providerId || defaultLane.providerId,
                model: model || defaultLane.model
            };
        }
    });
}
