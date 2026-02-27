import crypto from 'crypto';

/**
 * @typedef {Object} PolarEnvelope
 * @property {string} sessionId
 * @property {string} userId
 * @property {string} text
 * @property {string} [messageId]
 * @property {Object} [metadata]
 */

/**
 * Orchestrator core logic - transport agnostic.
 */
export function createOrchestrator({
    profileResolutionGateway,
    chatManagementGateway,
    providerGateway,
    extensionGateway,
    gateway, // ControlPlaneGateway for config
    now = Date.now
}) {
    // In-memory workflow storage for demo/v1, should move to a state store if needed
    const PENDING_WORKFLOWS = new Map();
    const WORKFLOW_TTL_MS = 30 * 60 * 1000;
    const WORKFLOW_MAX_SIZE = 100;

    // Thread State Storage: sessionId -> { threads: [], activeThreadId: null }
    const SESSION_THREADS = new Map();
    const THREAD_TTL_MS = 60 * 60 * 1000; // 1 hour

    // Periodic cleanup
    setInterval(() => {
        const currentTime = now();
        for (const [id, entry] of PENDING_WORKFLOWS) {
            if (currentTime - entry.createdAt > WORKFLOW_TTL_MS) {
                PENDING_WORKFLOWS.delete(id);
            }
        }
        for (const [id, entry] of SESSION_THREADS) {
            const lastActivity = entry.threads.reduce((max, t) => Math.max(max, t.lastActivityTs || 0), 0);
            if (currentTime - lastActivity > THREAD_TTL_MS && entry.threads.length > 0) {
                SESSION_THREADS.delete(id);
            }
        }
    }, 5 * 60 * 1000);

    return Object.freeze({
        /**
         * Orchestrate a single conversation turn.
         * @param {PolarEnvelope} envelope
         */
        async orchestrate(envelope) {
            const { sessionId, userId, text, messageId, metadata = {} } = envelope;
            const polarSessionId = sessionId;

            // 0. Deterministic Pre-Routing
            const sessionState = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
            let routingRecommendation = null;

            if (text) {
                const normalized = text.toLowerCase().trim().replace(/[?!.]+$/, '');
                const statusNudges = ["any luck", "update", "status", "anyone there", "any news", "hello", "hi", "hey"];
                const overrides = ["actually", "ignore", "stop", "cancel", "instead", "forget", "wait"];

                if (statusNudges.includes(normalized) || statusNudges.some(n => normalized.startsWith(n + " "))) {
                    const target = [...sessionState.threads].reverse().find(t => t.status === 'in_progress' || t.status === 'blocked' || t.status === 'waiting_for_user');
                    if (target) routingRecommendation = `[ROUTING_HINT] This is a status nudge. Attach to thread: ${target.id} (${target.intent})`;
                } else if (overrides.some(o => normalized.startsWith(o))) {
                    routingRecommendation = `[ROUTING_HINT] This is an override/steering message. Priority: Attach to active thread and pivot.`;
                } else {
                    // Try to match pending questions in threads
                    const waitingThread = sessionState.threads.find(t => t.status === 'waiting_for_user' && t.pending_question);
                    if (waitingThread && normalized.length < 50) { // Short answers are likely slot fillers
                        routingRecommendation = `[ROUTING_HINT] This looks like a direct answer to a pending question in thread: ${waitingThread.id}.`;
                    }
                }
            }

            // 1. Resolve Profile
            const profile = await profileResolutionGateway.resolve({ sessionId: polarSessionId });

            // 2. Resolve Model Policy
            const policy = profile.profileConfig?.modelPolicy || {};
            const providerId = policy.providerId || "openai";
            // BUG-013 fix: Use consistent default model name
            const model = policy.modelId || "gpt-4.1-mini";

            let systemPrompt = profile.profileConfig?.systemPrompt || "You are a helpful Polar AI assistant. Be concise and friendly.";

            // 3. Load Multi-Agent Config
            let multiAgentConfig;
            try {
                const configResult = await gateway.getConfig({ resourceType: 'multi_agent', resourceId: 'default' });
                if (configResult.status === 'found' && configResult.record?.config) {
                    multiAgentConfig = configResult.record.config;
                }
            } catch {
                // Config not found, use minimal defaults
            }

            if (!multiAgentConfig) {
                // Fallback defaults
                multiAgentConfig = {
                    allowlistedModels: [
                        "gpt-4.1-mini",
                        "gpt-4.1-nano",
                        "claude-sonnet-4-6",
                        "claude-haiku-4-5",
                        "gemini-3.1-pro-preview",
                        "gemini-3-flash-preview",
                        "deepseek-reasoner",
                        "deepseek-chat"
                    ],
                    availableProfiles: [
                        {
                            agentId: "@writer_agent",
                            description: "Specialized for writing tasks, document creation, and styling.",
                            pinnedModel: "claude-sonnet-4-6",
                            pinnedProvider: "anthropic"
                        },
                        {
                            agentId: "@research_agent",
                            description: "Specialized for deep reviews, long-running research, and synthesis.",
                            pinnedModel: null,
                            pinnedProvider: null
                        }
                    ]
                };
            }

            systemPrompt += `\n\n[MULTI-AGENT ORCHESTRATION ENGINE]
You are the Primary Orchestrator. You handle simple queries natively.
If the user asks for complex flows, deep reviews, long-running tasks, or writing assignments, YOU MUST DELEGATE to a sub-agent.
When delegating, you explicitly forward skills/MCP servers to the sub-agent so they can complete the task securely.

Available pre-configured sub-agents:
${JSON.stringify(multiAgentConfig.availableProfiles, null, 2)}

Models allowlist (use these if spinning up a dynamic sub-agent or unpinned profile):
${JSON.stringify(multiAgentConfig.allowlistedModels, null, 2)}

To delegate to a sub-agent, propose a workflow step using the tool "delegate_to_agent":
{
  "tool": "delegate_to_agent",
  "args": {
    "agentId": "@writer_agent", // or "dynamic" for an ad-hoc specialized agent
    "model_override": "gpt-4.1-mini", // Pick the smartest model from the allowlist for complex tasks if unpinned
    "task_instructions": "Review the inbox and summarize urgent emails.",
    "forward_skills": ["email_mcp", "search_web"] // Programmatic capabilities to give the sub-agent
  }
}
If delegating, do not do the work yourself. The sub-agent will communicate directly with the user to save tokens.

[WORKFLOW CAPABILITY ENGINE]
You have the ability to propose deterministic workflows.
If the user's request requires executing tools or delegating, DO NOT just reply with text.
Instead, explicitly propose a workflow by outputting a JSON block wrapped exactly in <polar_workflow>...</polar_workflow> tags.
The JSON must be an array of step objects, where each step has "extensionId", "extensionType" (e.g. "mcp" or "skill"), "capabilityId" (the tool name), and "args" (object).
For delegation, use capabilityId: "delegate_to_agent", extensionId: "system", extensionType: "core".
For sub-agent task completion, use capabilityId: "complete_task", extensionId: "system", extensionType: "core".
Always explain your plan to the user briefly before outputting the <polar_workflow> block.

[CONVERSATION ROUTER & THREAD STATE]
You are a stateful orchestrator. You manage multiple "micro-threads" within a single chat.
Current Session Threads:
${JSON.stringify(sessionState, null, 2)}

${routingRecommendation || ""}

Routing Rules (Priority Order):
1. **Override/steering**: If user says "Actually...", "Stop", "Ignore that", attach to active thread and pivot.
2. **Answer to pending**: If user message fits the "pending_question" slot of a thread, attach and proceed.
3. **Status/progress**: If user says "Any luck?", "Update?", attach to the last in-progress thread and provide status.
4. **New request**: Create a new thread.

Output your internal state updates in a <thread_state> block (JSON):
{
  "activeThreadId": "uuid",
  "threads": [
    {
      "id": "uuid",
      "intent": "string",
      "slots": { "key": "value" },
      "status": "waiting_for_user" | "in_progress" | "blocked" | "done",
      "pending_question": "string (optional)",
      "summary": "1-3 line description"
    }
  ],
  "useInlineReply": boolean // Set to true ONLY if responding to older messages or multiple threads are active/ambiguous.
}
Do not repeat the threads if they haven't changed, but ALWAYS update "lastActivityTs" implicitly by returning the JSON.`;

            // 4. Append User Message
            await chatManagementGateway.appendMessage({
                sessionId: polarSessionId,
                userId: userId.toString(),
                messageId: messageId || `msg_u_${crypto.randomUUID()}`,
                role: "user",
                text,
                timestampMs: now()
            });

            // 5. Apply Retention
            try {
                await chatManagementGateway.applyRetentionPolicy({
                    sessionId: polarSessionId,
                    retentionDays: profile.profileConfig?.retentionDays || 30
                });
            } catch { }

            // 6. Fetch History
            const contextWindowLimit = profile.profileConfig?.contextWindow || 20;
            const historyData = await chatManagementGateway.getSessionHistory({
                sessionId: polarSessionId,
                limit: 500
            });

            let messages = [];
            if (historyData?.items) {
                messages = historyData.items.map(m => ({
                    role: m.role,
                    content: m.text
                }));

                if (messages.length > contextWindowLimit) {
                    messages = messages.slice(messages.length - contextWindowLimit);
                }
            }

            // 7. Generate Output
            const result = await providerGateway.generate({
                executionType: "handoff",
                providerId,
                model,
                system: systemPrompt,
                messages: messages.length > 0 && messages[messages.length - 1].role === 'user'
                    ? messages.slice(0, -1)
                    : messages,
                prompt: text || "Process user message."
            });

            if (result && result.text) {
                const responseText = result.text;
                const workflowMatch = responseText.match(/<polar_workflow>([\s\S]*?)<\/polar_workflow>/);
                const stateMatch = responseText.match(/<thread_state>([\s\S]*?)<\/thread_state>/);

                let useInlineReply = false;
                if (stateMatch) {
                    try {
                        const stateUpdate = JSON.parse(stateMatch[1].trim());
                        useInlineReply = stateUpdate.useInlineReply === true;

                        // Update SESSION_THREADS
                        const currentState = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
                        if (stateUpdate.threads) {
                            stateUpdate.threads.forEach(t => t.lastActivityTs = now());
                        }
                        SESSION_THREADS.set(polarSessionId, {
                            ...currentState,
                            ...stateUpdate
                        });
                    } catch (e) {
                        console.warn("Failed to parse thread_state update", e);
                    }
                }

                const cleanText = responseText
                    .replace(/<polar_workflow>[\s\S]*?<\/polar_workflow>/, '')
                    .replace(/<thread_state>[\s\S]*?<\/thread_state>/, '')
                    .trim();

                if (workflowMatch) {
                    const workflowJsonString = workflowMatch[1].trim();

                    if (cleanText) {
                        await chatManagementGateway.appendMessage({
                            sessionId: polarSessionId,
                            userId: "assistant",
                            messageId: `msg_a_${crypto.randomUUID()}`,
                            role: "assistant",
                            text: cleanText,
                            timestampMs: now()
                        });
                    }

                    try {
                        const workflowSteps = JSON.parse(workflowJsonString);
                        const workflowId = crypto.randomUUID();

                        if (PENDING_WORKFLOWS.size >= WORKFLOW_MAX_SIZE) {
                            let oldestKey = null;
                            let oldestTime = Infinity;
                            for (const [id, entry] of PENDING_WORKFLOWS) {
                                if (entry.createdAt < oldestTime) {
                                    oldestTime = entry.createdAt;
                                    oldestKey = id;
                                }
                            }
                            if (oldestKey) PENDING_WORKFLOWS.delete(oldestKey);
                        }

                        PENDING_WORKFLOWS.set(workflowId, {
                            steps: workflowSteps,
                            createdAt: now(),
                            polarSessionId,
                            multiAgentConfig // Keep for later use in execution
                        });

                        return {
                            status: 'workflow_proposed',
                            text: cleanText,
                            workflowId,
                            steps: workflowSteps,
                            useInlineReply
                        };
                    } catch (jsonErr) {
                        return {
                            status: 'error',
                            text: "⚠️ Failed to parse workflow: invalid JSON.",
                            error: jsonErr.message
                        };
                    }
                } else {
                    await chatManagementGateway.appendMessage({
                        sessionId: polarSessionId,
                        userId: "assistant",
                        messageId: `msg_a_${crypto.randomUUID()}`,
                        role: "assistant",
                        text: cleanText || responseText,
                        timestampMs: now()
                    });
                    return {
                        status: 'completed',
                        text: cleanText || responseText,
                        useInlineReply
                    };
                }
            }

            return { status: 'error', text: "Wait, I didn't generate any text." };
        },

        async executeWorkflow(workflowId) {
            const entry = PENDING_WORKFLOWS.get(workflowId);
            if (!entry) return { status: 'error', text: "Workflow expired or not found!" };

            const { steps: workflowSteps, polarSessionId, multiAgentConfig } = entry;
            PENDING_WORKFLOWS.delete(workflowId);

            try {
                const toolResults = [];
                let activeDelegation = null;

                for (const step of workflowSteps) {
                    const { capabilityId, extensionId, args: parsedArgs = {}, extensionType = "mcp" } = step;

                    if (capabilityId === "delegate_to_agent") {
                        activeDelegation = parsedArgs;
                        toolResults.push({
                            tool: capabilityId,
                            status: "delegated",
                            output: `Successfully spun up sub-agent ${parsedArgs.agentId}.`
                        });

                        await chatManagementGateway.appendMessage({
                            sessionId: polarSessionId,
                            userId: "system",
                            messageId: `msg_sys_${crypto.randomUUID()}_delegation`,
                            role: "system",
                            text: `[DELEGATION ACTIVE] ${JSON.stringify(parsedArgs)}`,
                            timestampMs: now()
                        });
                        continue;
                    }

                    if (capabilityId === "complete_task") {
                        toolResults.push({
                            tool: capabilityId,
                            status: "completed",
                            output: "Handed control back to Primary Orchestrator."
                        });

                        await chatManagementGateway.appendMessage({
                            sessionId: polarSessionId,
                            userId: "system",
                            messageId: `msg_sys_${crypto.randomUUID()}_delegation_clear`,
                            role: "system",
                            text: `[DELEGATION CLEARED]`,
                            timestampMs: now()
                        });
                        continue;
                    }

                    try {
                        const output = await extensionGateway.execute({
                            extensionId,
                            extensionType,
                            capabilityId,
                            sessionId: polarSessionId,
                            userId: "unknown",
                            input: parsedArgs,
                            capabilityScope: {}
                        });

                        toolResults.push({
                            tool: capabilityId,
                            status: output?.status || "completed",
                            output: output?.output || output?.error || "Silent completion."
                        });
                    } catch (err) {
                        toolResults.push({
                            tool: capabilityId,
                            status: "error",
                            error: err.message
                        });
                    }
                }

                await chatManagementGateway.appendMessage({
                    sessionId: polarSessionId,
                    userId: "system",
                    messageId: `msg_sys_${crypto.randomUUID()}`,
                    role: "system",
                    text: `[TOOL RESULTS]\n${JSON.stringify(toolResults, null, 2)}`,
                    timestampMs: now()
                });

                // Final summary loop
                const profile = await profileResolutionGateway.resolve({ sessionId: polarSessionId });
                const policy = profile.profileConfig?.modelPolicy || {};

                const historyData = await chatManagementGateway.getSessionHistory({ sessionId: polarSessionId, limit: 15 });
                let messages = historyData?.items ? historyData.items.map(m => ({ role: m.role, content: m.text })) : [];

                if (!activeDelegation && historyData?.items) {
                    const reversed = [...historyData.items].reverse();
                    for (const msg of reversed) {
                        if (msg.role === 'user' && !msg.text.includes('[TOOL RESULTS]')) break;
                        if (msg.role === 'system' && msg.text.startsWith('[DELEGATION CLEARED]')) break;
                        if (msg.role === 'system' && msg.text.startsWith('[DELEGATION ACTIVE]')) {
                            try { activeDelegation = JSON.parse(msg.text.replace('[DELEGATION ACTIVE]', '').trim()); break; } catch (e) { }
                        }
                    }
                }

                let finalProviderId = policy.providerId || "openai";
                let finalModelId = policy.modelId || "gpt-4.1-mini";
                let finalSystemPrompt = profile.profileConfig?.systemPrompt || "";

                if (activeDelegation) {
                    finalModelId = activeDelegation.model_override || finalModelId;
                    if (activeDelegation.pinnedProvider) {
                        finalProviderId = activeDelegation.pinnedProvider;
                    } else {
                        const agentProfile = multiAgentConfig?.availableProfiles?.find(p => p.agentId === activeDelegation.agentId);
                        if (agentProfile?.pinnedProvider) finalProviderId = agentProfile.pinnedProvider;
                    }

                    finalSystemPrompt = `You are a specialized sub-agent: ${activeDelegation.agentId}.
Your primary instructions for this isolated task: ${activeDelegation.task_instructions}
You have been explicitly forwarded the following strict capabilities: ${activeDelegation.forward_skills?.join(", ") || "None"}.
Execute your task safely, communicating directly with the user. If you need tools, propose them via <polar_workflow>.`;
                }

                const finalResult = await providerGateway.generate({
                    executionType: "handoff",
                    providerId: finalProviderId,
                    model: finalModelId,
                    system: finalSystemPrompt,
                    messages,
                    prompt: "Summarize the tool results and respond to the user."
                });

                if (finalResult && finalResult.text) {
                    const responseText = finalResult.text;
                    const workflowMatch = responseText.match(/<polar_workflow>([\s\S]*?)<\/polar_workflow>/);
                    const stateMatch = responseText.match(/<thread_state>([\s\S]*?)<\/thread_state>/);

                    let useInlineReply = false;
                    if (stateMatch) {
                        try {
                            const stateUpdate = JSON.parse(stateMatch[1].trim());
                            useInlineReply = stateUpdate.useInlineReply === true;

                            const currentState = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
                            if (stateUpdate.threads) {
                                stateUpdate.threads.forEach(t => t.lastActivityTs = now());
                            }
                            SESSION_THREADS.set(polarSessionId, {
                                ...currentState,
                                ...stateUpdate
                            });
                        } catch (e) {
                            console.warn("Failed to parse thread_state update in workflow summary", e);
                        }
                    }

                    const cleanText = responseText
                        .replace(/<polar_workflow>[\s\S]*?<\/polar_workflow>/, '')
                        .replace(/<thread_state>[\s\S]*?<\/thread_state>/, '')
                        .trim();

                    if (workflowMatch) {
                        // Support recursive workflows from summary
                        const workflowJsonString = workflowMatch[1].trim();
                        try {
                            const workflowSteps = JSON.parse(workflowJsonString);
                            const nextWorkflowId = crypto.randomUUID();
                            PENDING_WORKFLOWS.set(nextWorkflowId, {
                                steps: workflowSteps,
                                createdAt: now(),
                                polarSessionId,
                                multiAgentConfig
                            });

                            if (cleanText) {
                                await chatManagementGateway.appendMessage({
                                    sessionId: polarSessionId,
                                    userId: "assistant",
                                    messageId: `msg_a_${crypto.randomUUID()}`,
                                    role: "assistant",
                                    text: cleanText,
                                    timestampMs: now()
                                });
                            }

                            return {
                                status: 'workflow_proposed',
                                text: cleanText,
                                workflowId: nextWorkflowId,
                                steps: workflowSteps,
                                useInlineReply
                            };
                        } catch (e) { }
                    }

                    await chatManagementGateway.appendMessage({
                        sessionId: polarSessionId,
                        userId: "assistant",
                        messageId: `msg_a_${crypto.randomUUID()}`,
                        role: "assistant",
                        text: cleanText || responseText,
                        timestampMs: now()
                    });
                    return { status: 'completed', text: cleanText || responseText, useInlineReply };
                }

                return { status: 'completed', text: "Tools executed successfully." };
            } catch (execErr) {
                return { status: 'error', text: `Workflow execution crashed: ${execErr.message}` };
            }
        },

        async rejectWorkflow(workflowId) {
            PENDING_WORKFLOWS.delete(workflowId);
            return { status: 'rejected' };
        }
    });

}
