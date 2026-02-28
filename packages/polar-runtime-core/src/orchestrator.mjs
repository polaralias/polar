import crypto from 'crypto';
import { validateForwardSkills, validateModelOverride, computeCapabilityScope } from './capability-scope.mjs';
import { classifyUserMessage, applyUserTurn, selectReplyAnchor } from './routing-policy-engine.mjs';
import { parseModelProposal, expandTemplate, validateSteps } from './workflow-engine.mjs';

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
    const PENDING_WORKFLOWS = new Map();
    const WORKFLOW_TTL_MS = 30 * 60 * 1000;
    const WORKFLOW_MAX_SIZE = 100;

    const SESSION_THREADS = new Map();
    const THREAD_TTL_MS = 60 * 60 * 1000;

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
        async orchestrate(envelope) {
            const { sessionId, userId, text, messageId, metadata = {} } = envelope;
            const polarSessionId = sessionId;

            let sessionState = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
            let routingRecommendation = null;
            let currentTurnAnchor = null;

            if (text) {
                const classification = classifyUserMessage({ text, sessionState });
                sessionState = applyUserTurn({ sessionState, classification, rawText: text, now });
                SESSION_THREADS.set(polarSessionId, sessionState);

                const anchor = selectReplyAnchor({ sessionState, classification });
                currentTurnAnchor = anchor.useInlineReply;

                if (classification.type === "status_nudge") {
                    routingRecommendation = `[ROUTING_HINT] This is a status nudge. Answer from the context of thread: ${classification.targetThreadId}`;
                } else if (classification.type === "override") {
                    routingRecommendation = `[ROUTING_HINT] This is an override/steering message. Priority: Handle in current active thread.`;
                } else if (classification.type === "answer_to_pending") {
                    routingRecommendation = `[ROUTING_HINT] This is an explicit slot fill for thread: ${classification.targetThreadId}. No need to clarify intent.`;
                }
            }

            const profile = await profileResolutionGateway.resolve({ sessionId: polarSessionId });
            const policy = profile.profileConfig?.modelPolicy || {};
            const providerId = policy.providerId || "openai";
            const model = policy.modelId || "gpt-4.1-mini";

            let systemPrompt = profile.profileConfig?.systemPrompt || "You are a helpful Polar AI assistant. Be concise and friendly.";

            let multiAgentConfig;
            try {
                const configResult = await gateway.getConfig({ resourceType: 'multi_agent', resourceId: 'default' });
                if (configResult.status === 'found' && configResult.record?.config) {
                    multiAgentConfig = configResult.record.config;
                }
            } catch { }

            if (!multiAgentConfig) {
                multiAgentConfig = {
                    allowlistedModels: [
                        "gpt-4.1-mini", "gpt-4.1-nano", "claude-sonnet-4-6", "claude-haiku-4-5",
                        "gemini-3.1-pro-preview", "gemini-3-flash-preview", "deepseek-reasoner", "deepseek-chat"
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
    "agentId": "@writer_agent",
    "model_override": "gpt-4.1-mini",
    "task_instructions": "Review inbox...",
    "forward_skills": ["email_mcp", "search_web"]
  }
}

[WORKFLOW CAPABILITY ENGINE]
Propose workflows via <polar_action> blocks. You MUST only use established templates. Arbitrary step chains are not supported.

Available Templates:
- lookup_weather(location)
- search_web(query)
- draft_email(to, subject, body)
- delegate_to_agent(agentId, task_instructions, forward_skills?, model_override?)

Example:
<polar_action>
{
  "template": "lookup_weather",
  "args": { "location": "Swansea" }
}
</polar_action>

For returning control after a task, use template "complete_task".

[CONVERSATION ROUTER & THREAD STATE]
The backend manages state machine deterministically. You may optionally output a <thread_state> block to suggest slot values or suggest a status change.
If you need to ask a question to fill a slot, suggest "pending_question", "slot_key", and "expected_type" (yes_no, location, date_time, freeform).

Example:
<thread_state>
{
  "status": "waiting_for_user",
  "pending_question": "Which city?",
  "slot_key": "location",
  "expected_type": "location"
}
</thread_state>

Current Session Threads:
${JSON.stringify(sessionState, null, 2)}
${routingRecommendation || ""}`;

            await chatManagementGateway.appendMessage({
                sessionId: polarSessionId,
                userId: userId.toString(),
                messageId: messageId || `msg_u_${crypto.randomUUID()}`,
                role: "user",
                text,
                timestampMs: now()
            });

            const historyData = await chatManagementGateway.getSessionHistory({
                sessionId: polarSessionId,
                limit: profile.profileConfig?.contextWindow || 20
            });

            let messages = historyData?.items ? historyData.items.map(m => ({ role: m.role, content: m.text })) : [];

            const result = await providerGateway.generate({
                executionType: "handoff",
                providerId,
                model,
                system: systemPrompt,
                messages: messages.length > 0 && messages[messages.length - 1].role === 'user' ? messages.slice(0, -1) : messages,
                prompt: text || "Process user message."
            });

            if (result && result.text) {
                const responseText = result.text;
                const actionMatch = responseText.match(/<polar_action>([\s\S]*?)<\/polar_action>/) || responseText.match(/<polar_workflow>([\s\S]*?)<\/polar_workflow>/);
                const stateMatch = responseText.match(/<thread_state>([\s\S]*?)<\/thread_state>/);
                const assistantMessageId = `msg_a_${crypto.randomUUID()}`;

                const cleanText = responseText
                    .replace(/<polar_action>[\s\S]*?<\/polar_action>/, '')
                    .replace(/<polar_workflow>[\s\S]*?<\/polar_workflow>/, '')
                    .replace(/<thread_state>[\s\S]*?<\/thread_state>/, '')
                    .trim();

                if (cleanText) {
                    await chatManagementGateway.appendMessage({
                        sessionId: polarSessionId,
                        userId: "assistant",
                        messageId: assistantMessageId,
                        role: "assistant",
                        text: cleanText,
                        timestampMs: now()
                    });
                }

                if (stateMatch) {
                    try {
                        const stateUpdate = JSON.parse(stateMatch[1].trim());
                        let st = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
                        const threadRef = st.threads.find(t => t.id === (stateUpdate.activeThreadId || st.activeThreadId));
                        if (threadRef) {
                            if (stateUpdate.status === "done") {
                                threadRef.status = "done";
                                delete threadRef.pendingQuestion;
                            } else if (stateUpdate.status === "waiting_for_user" && (stateUpdate.pending_question || stateUpdate.pendingQuestion)) {
                                threadRef.status = "waiting_for_user";
                                threadRef.pendingQuestion = {
                                    key: stateUpdate.slot_key || stateUpdate.slotKey || "latest_answer",
                                    expectedType: stateUpdate.expected_type || stateUpdate.expectedType || "freeform",
                                    text: stateUpdate.pending_question || stateUpdate.pendingQuestion,
                                    askedAtMessageId: assistantMessageId
                                };
                            }
                            if (stateUpdate.slots) Object.assign(threadRef.slots, stateUpdate.slots);
                            threadRef.lastActivityTs = now();
                        }
                        SESSION_THREADS.set(polarSessionId, st);
                    } catch (e) { }
                }

                if (actionMatch) {
                    const proposal = parseModelProposal(actionMatch[0]);
                    if (!proposal || proposal.error) return { status: 'error', text: "⚠️ Failed to parse action proposal" };

                    const workflowSteps = expandTemplate(proposal.templateId, proposal.args);
                    const workflowId = crypto.randomUUID();
                    PENDING_WORKFLOWS.set(workflowId, { steps: workflowSteps, createdAt: now(), polarSessionId, multiAgentConfig });

                    let st = SESSION_THREADS.get(polarSessionId);
                    if (st && st.activeThreadId) {
                        const thread = st.threads.find(t => t.id === st.activeThreadId);
                        if (thread) { thread.status = 'workflow_proposed'; thread.lastActivityTs = now(); }
                    }

                    return {
                        status: 'workflow_proposed',
                        text: cleanText,
                        workflowId,
                        steps: workflowSteps,
                        useInlineReply: selectReplyAnchor({ sessionState: st, classification: { type: 'new_request' } }).useInlineReply
                    };
                }

                return {
                    status: 'completed',
                    text: cleanText || responseText,
                    useInlineReply: selectReplyAnchor({ sessionState: SESSION_THREADS.get(polarSessionId), classification: { type: 'filler' } }).useInlineReply
                };
            }
            return { status: 'error', text: "No generation results." };
        },

        async executeWorkflow(workflowId) {
            const entry = PENDING_WORKFLOWS.get(workflowId);
            if (!entry) return { status: 'error', text: "Workflow not found" };

            const { steps: workflowSteps, polarSessionId, multiAgentConfig } = entry;
            PENDING_WORKFLOWS.delete(workflowId);

            try {
                const profile = await profileResolutionGateway.resolve({ sessionId: polarSessionId });
                const baseAllowedSkills = profile.profileConfig?.allowedSkills || multiAgentConfig?.globalAllowedSkills || [];
                const historyData = await chatManagementGateway.getSessionHistory({ sessionId: polarSessionId, limit: 15 });

                let msgActiveDelegation = null;
                if (historyData?.items) {
                    for (const msg of [...historyData.items].reverse()) {
                        if (msg.role === 'user') break;
                        if (msg.role === 'system' && msg.text.startsWith('[DELEGATION CLEARED]')) break;
                        if (msg.role === 'system' && msg.text.startsWith('[DELEGATION ACTIVE]')) {
                            try { msgActiveDelegation = JSON.parse(msg.text.replace('[DELEGATION ACTIVE]', '').trim()); break; } catch (e) { }
                        }
                    }
                }

                const validation = validateSteps(workflowSteps, { allowedExtensionIds: ["system", ...(msgActiveDelegation?.forward_skills || baseAllowedSkills)] });
                if (!validation.ok) return { status: 'error', text: "Workflow blocked: " + validation.errors.join(", ") };

                const toolResults = [];
                let activeDelegation = msgActiveDelegation;
                const capabilityScope = computeCapabilityScope({ sessionProfile: profile, multiAgentConfig, activeDelegation });

                for (const step of workflowSteps) {
                    const { capabilityId, extensionId, args: parsedArgs = {}, extensionType = "mcp" } = step;

                    if (capabilityId === "delegate_to_agent") {
                        const { allowedSkills, rejectedSkills, isBlocked } = validateForwardSkills({ forwardSkills: parsedArgs.forward_skills || [], sessionProfile: profile, multiAgentConfig });
                        const { providerId, modelId, rejectedReason } = validateModelOverride({ modelOverride: parsedArgs.model_override, multiAgentConfig, basePolicy: profile.profileConfig?.modelPolicy || {} });

                        if (isBlocked) {
                            toolResults.push({ tool: capabilityId, status: "error", output: "Delegation blocked by security policy." });
                            continue;
                        }

                        activeDelegation = { ...parsedArgs, forward_skills: allowedSkills, model_override: modelId, pinnedProvider: providerId };
                        const output = `Successfully delegated to ${parsedArgs.agentId}.` + (rejectedSkills.length ? ` Clamped: ${rejectedSkills.join(", ")}` : "");
                        toolResults.push({ tool: capabilityId, status: "delegated", output });

                        await chatManagementGateway.appendMessage({
                            sessionId: polarSessionId, userId: "system", role: "system",
                            text: `[DELEGATION ACTIVE] ${JSON.stringify(activeDelegation)}`, timestampMs: now()
                        });
                        continue;
                    }

                    if (capabilityId === "complete_task") {
                        toolResults.push({ tool: capabilityId, status: "completed", output: "Task completed." });
                        await chatManagementGateway.appendMessage({ sessionId: polarSessionId, userId: "system", role: "system", text: `[DELEGATION CLEARED]`, timestampMs: now() });
                        continue;
                    }

                    const output = await extensionGateway.execute({
                        extensionId, extensionType, capabilityId, sessionId: polarSessionId, userId: "unknown", input: parsedArgs,
                        capabilityScope
                    });
                    toolResults.push({ tool: capabilityId, status: output?.status || "completed", output: output?.output || output?.error || "Done." });
                }

                const deterministicHeader = "### 🛠️ Execution Results\n" + toolResults.map(r => (r.status === "failed" || r.status === "error" ? "❌ " : "✅ ") + `**${r.tool}**: ${typeof r.output === 'string' ? r.output.slice(0, 100) : 'Done.'}`).join("\n") + "\n\n";
                await chatManagementGateway.appendMessage({ sessionId: polarSessionId, userId: "system", role: "system", text: `[TOOL RESULTS]\n${JSON.stringify(toolResults, null, 2)}`, timestampMs: now() });

                const finalSystemPrompt = activeDelegation ? `You are sub-agent ${activeDelegation.agentId}. Task: ${activeDelegation.task_instructions}. Skills: ${activeDelegation.forward_skills?.join(", ")}` : profile.profileConfig?.systemPrompt;
                const finalResult = await providerGateway.generate({
                    executionType: "handoff",
                    providerId: activeDelegation?.pinnedProvider || profile.profileConfig?.modelPolicy?.providerId || "openai",
                    model: activeDelegation?.model_override || profile.profileConfig?.modelPolicy?.modelId || "gpt-4.1-mini",
                    system: finalSystemPrompt,
                    messages: historyData?.items ? historyData.items.map(m => ({ role: m.role, content: m.text })) : [],
                    prompt: `Analyze these execution results and summarize for the user. Do NOT hide any failures listed in the header.\n\n${deterministicHeader}`
                });

                const responseText = finalResult?.text || "Execution complete.";
                const cleanText = responseText.replace(/<polar_workflow>[\s\S]*?<\/polar_workflow>/, '').replace(/<thread_state>[\s\S]*?<\/thread_state>/, '').trim();

                await chatManagementGateway.appendMessage({ sessionId: polarSessionId, userId: "assistant", role: "assistant", text: cleanText, timestampMs: now() });
                return { status: 'completed', text: deterministicHeader + cleanText, useInlineReply: selectReplyAnchor({ sessionState: SESSION_THREADS.get(polarSessionId), classification: { type: 'filler' } }).useInlineReply };
            } catch (err) { return { status: 'error', text: `Crashed: ${err.message}` }; }
        },

        async rejectWorkflow(workflowId) {
            PENDING_WORKFLOWS.delete(workflowId);
            return { status: 'rejected' };
        }
    });
}
