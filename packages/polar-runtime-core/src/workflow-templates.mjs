// packages/polar-runtime-core/src/workflow-templates.mjs

export const WORKFLOW_TEMPLATES = {
    lookup_weather: {
        id: "lookup_weather",
        description: "Get current weather for a location",
        schema: {
            required: ["location"],
            optional: []
        },
        steps: (args) => [
            {
                extensionId: "system",
                extensionType: "core",
                capabilityId: "lookup_weather",
                args: { location: args.location }
            }
        ]
    },
    search_web: {
        id: "search_web",
        description: "Search the public web",
        schema: {
            required: ["query"],
            optional: []
        },
        steps: (args) => [
            {
                extensionId: "web",
                extensionType: "mcp",
                capabilityId: "search_web",
                args: { query: args.query }
            }
        ]
    },
    draft_email: {
        id: "draft_email",
        description: "Draft an email",
        schema: {
            required: ["to", "subject", "body"],
            optional: []
        },
        steps: (args) => [
            {
                extensionId: "email",
                extensionType: "mcp",
                capabilityId: "draft_email",
                args: { to: args.to, subject: args.subject, body: args.body }
            }
        ]
    },
    delegate_to_agent: {
        id: "delegate_to_agent",
        description: "Handoff task to a sub-agent",
        schema: {
            required: ["agentId", "task_instructions"],
            optional: ["forward_skills", "model_override"]
        },
        steps: (args) => [
            {
                extensionId: "system",
                extensionType: "core",
                capabilityId: "delegate_to_agent",
                args: {
                    agentId: args.agentId,
                    task_instructions: args.task_instructions,
                    forward_skills: args.forward_skills || [],
                    model_override: args.model_override
                }
            }
        ]
    },
    complete_task: {
        id: "complete_task",
        description: "Complete active sub-agent task",
        schema: {
            required: [],
            optional: []
        },
        steps: () => [
            {
                extensionId: "system",
                extensionType: "core",
                capabilityId: "complete_task",
                args: {}
            }
        ]
    },
    send_email: {
        id: "send_email",
        description: "Send an email immediately",
        schema: {
            required: ["to", "subject", "body"],
            optional: []
        },
        steps: (args) => [
            {
                extensionId: "email",
                extensionType: "mcp",
                capabilityId: "send_email",
                args: { to: args.to, subject: args.subject, body: args.body }
            }
        ]
    }
};
