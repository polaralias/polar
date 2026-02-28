import crypto from 'crypto';
import { validateForwardSkills, validateModelOverride, computeCapabilityScope } from './capability-scope.mjs';
import { classifyUserMessage, applyUserTurn, selectReplyAnchor, detectOfferInText, setOpenOffer, computeRepairDecision, handleRepairSelection } from './routing-policy-engine.mjs';
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
    approvalStore,
    gateway, // ControlPlaneGateway for config
    now = Date.now
}) {
    const PENDING_WORKFLOWS = new Map();
    const WORKFLOW_TTL_MS = 30 * 60 * 1000;
    const WORKFLOW_MAX_SIZE = 100;

    const SESSION_THREADS = new Map();
    const THREAD_TTL_MS = 60 * 60 * 1000;
    const PENDING_REPAIRS = new Map();
    const REPAIR_TTL_MS = 5 * 60 * 1000;
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
        for (const [id, entry] of PENDING_REPAIRS) {
            if (currentTime - entry.createdAt > REPAIR_TTL_MS) {
                PENDING_REPAIRS.delete(id);
            }
        }
    }, 5 * 60 * 1000);

    /**
     * Compute risk summary for a list of workflow steps.
     */
    function evaluateWorkflowRisk(steps) {
        let maxRisk = 'read';
        let maxEffects = 'none';
        let maxEgress = 'none';
        let hasDelegation = false;
        const requirements = [];

        for (const step of steps) {
            if (step.capabilityId === 'delegate_to_agent') {
                hasDelegation = true;
                requirements.push({ capabilityId: 'delegate_to_agent', extensionId: 'system', riskLevel: 'write', sideEffects: 'internal' });
                continue;
            }
            if (step.capabilityId === 'complete_task') continue;

            const state = extensionGateway.getState(step.extensionId);
            const cap = (state?.capabilities || []).find(c => c.capabilityId === step.capabilityId);

            if (cap) {
                // Risk Level: read < write < destructive
                if (cap.riskLevel === 'destructive') maxRisk = 'destructive';
                else if (cap.riskLevel === 'write' && maxRisk === 'read') maxRisk = 'write';

                // Side Effects: none < internal < external
                if (cap.sideEffects === 'external') maxEffects = 'external';
                else if (cap.sideEffects === 'internal' && maxEffects === 'none') maxEffects = 'internal';

                // Data Egress: none < network
                if (cap.dataEgress === 'network') maxEgress = 'network';

                if (cap.sideEffects === 'external' || cap.riskLevel === 'destructive' || cap.dataEgress === 'network') {
                    requirements.push({
                        extensionId: step.extensionId,
                        capabilityId: step.capabilityId,
                        riskLevel: cap.riskLevel,
                        sideEffects: cap.sideEffects,
                        dataEgress: cap.dataEgress
                    });
                }
            } else {
                // If metadata missing, assume write/internal for safety
                if (maxRisk === 'read') maxRisk = 'write';
                if (maxEffects === 'none') maxEffects = 'internal';
            }
        }

        return {
            riskLevel: maxRisk,
            sideEffects: maxEffects,
            dataEgress: maxEgress,
            hasDelegation,
            requirements
        };
    }

    /**
     * Check if requirements are already covered by valid grants.
     */
    function checkGrants(requirements, principal) {
        return requirements.filter(req => {
            const match = approvalStore.findMatchingGrant(principal, {
                extensionId: req.extensionId,
                capabilityId: req.capabilityId,
                userId: principal.userId,
                sessionId: principal.sessionId
            });
            return !match;
        });
    }

    const methods = {
        async orchestrate(envelope) {
            const { sessionId, userId, text, messageId, metadata = {} } = envelope;
            const polarSessionId = sessionId;

            let sessionState = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
            let routingRecommendation = null;
            let currentTurnAnchor = null;
            let currentAnchorMessageId = null;

            if (text) {
                const classification = classifyUserMessage({ text, sessionState });
                sessionState = applyUserTurn({ sessionState, classification, rawText: text, now });
                SESSION_THREADS.set(polarSessionId, sessionState);

                // Check if repair is needed (ambiguous short follow-up with multiple open offers)
                const repairDecision = computeRepairDecision(sessionState, classification, text);
                if (repairDecision) {
                    // Attempt LLM-assisted phrasing (optional — code picks candidates, LLM only phrases)
                    let repairedQuestion = repairDecision.question;
                    let repairedLabels = null;
                    try {
                        const labelA = repairDecision.options[0].label;
                        const labelB = repairDecision.options[1].label;
                        const phrasingResult = await providerGateway.generate({
                            executionType: 'handoff',
                            providerId,
                            model,
                            system: 'You are a disambiguation assistant. You must respond with ONLY a valid JSON object, no markdown, no explanation.',
                            messages: [],
                            prompt: `The user said: "${text}"\nTwo possible topics exist:\n  A: "${labelA}"\n  B: "${labelB}"\n\nWrite a short, friendly disambiguation question and relabel the options clearly.\nRespond with ONLY this JSON shape:\n{"question": "...", "labelA": "...", "labelB": "..."}`
                        });
                        if (phrasingResult?.text) {
                            const rawJson = phrasingResult.text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
                            const parsed = JSON.parse(rawJson);
                            if (parsed.question && typeof parsed.question === 'string'
                                && parsed.labelA && typeof parsed.labelA === 'string'
                                && parsed.labelB && typeof parsed.labelB === 'string') {
                                repairedQuestion = parsed.question;
                                repairedLabels = { A: parsed.labelA, B: parsed.labelB };
                            }
                        }
                    } catch {
                        // LLM phrasing failed — use canned fallback (deterministic)
                    }

                    // Apply LLM labels if valid
                    if (repairedLabels) {
                        repairDecision.options[0].label = repairedLabels.A;
                        repairDecision.options[1].label = repairedLabels.B;
                    }
                    repairDecision.question = repairedQuestion;

                    PENDING_REPAIRS.set(repairDecision.correlationId, {
                        ...repairDecision,
                        createdAt: now(),
                        sessionId: polarSessionId
                    });
                    return {
                        status: 'repair_question',
                        type: 'repair_question',
                        question: repairDecision.question,
                        correlationId: repairDecision.correlationId,
                        options: repairDecision.options
                    };
                }

                const anchor = selectReplyAnchor({ sessionState, classification });
                currentTurnAnchor = anchor.useInlineReply;
                currentAnchorMessageId = anchor.anchorMessageId || null;

                if (classification.type === "accept_offer") {
                    routingRecommendation = `[ROUTING_HINT] User accepted an offer on thread: ${classification.targetThreadId}. Continue with the offered action.`;
                } else if (classification.type === "reject_offer") {
                    routingRecommendation = `[ROUTING_HINT] User declined an offer on thread: ${classification.targetThreadId}. Acknowledge and move on.`;
                } else if (classification.type === "status_nudge") {
                    routingRecommendation = `[ROUTING_HINT] This is a status nudge. Answer from the context of thread: ${classification.targetThreadId}`;
                } else if (classification.type === "override") {
                    routingRecommendation = `[ROUTING_HINT] This is an override/steering message. Priority: Handle in current active thread.`;
                } else if (classification.type === "answer_to_pending") {
                    routingRecommendation = `[ROUTING_HINT] This is an explicit slot fill for thread: ${classification.targetThreadId}. No need to clarify intent.`;
                } else if (classification.type === "error_inquiry") {
                    const ed = classification.errorDetail || {};
                    routingRecommendation = `[ROUTING_HINT] User is asking about a recent error. Thread: ${classification.targetThreadId}. Error: ${ed.capabilityId || 'unknown'} on ${ed.extensionId || 'unknown'}. Output: ${(ed.output || '').slice(0, 200)}. Explain what went wrong.`;
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
For complex flows, deep reviews, long-running tasks, or writing assignments, you should consider delegating to a sub-agent.
When delegating, explicitly forward skills/MCP servers to the sub-agent so they can complete the task securely.

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
Propose workflows via <polar_action> blocks. Only use established templates. Arbitrary step chains are not supported.

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
                const actionMatch = responseText.match(/<polar_action>([\s\S]*?)<\/polar_action>/);
                const stateMatch = responseText.match(/<thread_state>([\s\S]*?)<\/thread_state>/);
                const assistantMessageId = `msg_a_${crypto.randomUUID()}`;

                const cleanText = responseText
                    .replace(/<polar_action>[\s\S]*?<\/polar_action>/, '')
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

                // Detect offers in assistant response and set open offer on active thread
                if (cleanText) {
                    const offerDetection = detectOfferInText(cleanText);
                    if (offerDetection.isOffer) {
                        let st = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
                        const activeThread = st.threads.find(t => t.id === st.activeThreadId);
                        if (activeThread) {
                            setOpenOffer(activeThread, {
                                offerType: offerDetection.offerType,
                                target: offerDetection.offerText,
                                askedAtMessageId: assistantMessageId
                            }, now());
                            SESSION_THREADS.set(polarSessionId, st);
                        }
                    }
                }

                if (stateMatch) {
                    try {
                        const stateUpdate = JSON.parse(stateMatch[1].trim());
                        let st = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
                        // RESTRICTED: only active thread, model cannot switch threads
                        const threadRef = st.threads.find(t => t.id === st.activeThreadId);
                        if (threadRef) {
                            // Only 'done' and 'waiting_for_user' — model cannot set in_progress/failed/blocked
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
                            // Allowlisted slot keys only — no arbitrary injection
                            const ALLOWED_SLOT_KEYS = ['location', 'query', 'date', 'time', 'subject', 'recipient', 'latest_answer'];
                            if (stateUpdate.slots && typeof stateUpdate.slots === 'object') {
                                for (const [key, val] of Object.entries(stateUpdate.slots)) {
                                    if (ALLOWED_SLOT_KEYS.includes(key)) {
                                        threadRef.slots[key] = val;
                                    }
                                }
                            }
                            threadRef.lastActivityTs = now();
                        }
                        SESSION_THREADS.set(polarSessionId, st);
                    } catch (e) { }
                }

                if (actionMatch) {
                    const proposal = parseModelProposal(actionMatch[0]);
                    if (!proposal || proposal.error) return { status: 'error', text: "⚠️ Failed to parse action proposal" };

                    const workflowSteps = expandTemplate(proposal.templateId, proposal.args);
                    const risk = evaluateWorkflowRisk(workflowSteps);
                    const principal = { userId, sessionId: polarSessionId };
                    const pendingRequirements = checkGrants(risk.requirements, principal);

                    const requiresManualApproval = pendingRequirements.length > 0 || risk.hasDelegation;
                    const workflowId = crypto.randomUUID();
                    const ownerThreadId = sessionState.activeThreadId;
                    PENDING_WORKFLOWS.set(workflowId, {
                        steps: workflowSteps,
                        createdAt: now(),
                        polarSessionId,
                        userId, // Store for grant issuance
                        multiAgentConfig,
                        threadId: ownerThreadId, // canonical thread→workflow link
                        risk: { ...risk, requirements: pendingRequirements }
                    });

                    // Auto-run rules: if no manual approval required, execute immediately
                    if (!requiresManualApproval) {
                        return methods.executeWorkflow(workflowId, { isAutoRun: true });
                    }

                    // Mark the owner thread as awaiting approval
                    let st = SESSION_THREADS.get(polarSessionId);
                    if (st && ownerThreadId) {
                        const thread = st.threads.find(t => t.id === ownerThreadId);
                        if (thread) {
                            thread.status = 'workflow_proposed';
                            thread.awaitingApproval = { workflowId, proposedAtMessageId: assistantMessageId };
                            thread.lastActivityTs = now();
                        }
                    }

                    return {
                        status: 'workflow_proposed',
                        text: cleanText,
                        workflowId,
                        steps: workflowSteps,
                        risk: {
                            level: risk.riskLevel,
                            sideEffects: risk.sideEffects,
                            dataEgress: risk.dataEgress,
                            requirements: pendingRequirements
                        },
                        useInlineReply: currentTurnAnchor ?? false,
                        anchorMessageId: currentAnchorMessageId
                    };
                }

                return {
                    status: 'completed',
                    assistantMessageId,
                    text: cleanText || responseText,
                    useInlineReply: currentTurnAnchor ?? false,
                    anchorMessageId: currentAnchorMessageId
                };
            }
            return { status: 'error', text: "No generation results." };
        },

        async executeWorkflow(workflowId, options = {}) {
            const entry = PENDING_WORKFLOWS.get(workflowId);
            if (!entry) return { status: 'error', text: "Workflow not found" };

            const { steps: workflowSteps, polarSessionId, userId, multiAgentConfig, threadId: ownerThreadId, risk } = entry;
            PENDING_WORKFLOWS.delete(workflowId);

            // If this was a manual approval, issue grants for the requirements
            if (!options.isAutoRun && risk?.requirements && risk.requirements.length > 0) {
                const principal = { userId, sessionId: polarSessionId };
                const capabilities = risk.requirements.map(req => ({
                    extensionId: req.extensionId,
                    capabilityId: req.capabilityId
                }));
                const maxTtl = 3600 * 24; // 24h default for plan approval
                approvalStore.issueGrant(principal, {
                    capabilities,
                    riskLevel: risk.riskLevel === 'destructive' ? 'destructive' : 'write',
                    reason: 'User approved multi-step plan'
                }, maxTtl, 'Plan Approval');
            }

            // Resolve the target thread — use stored threadId, never rely on activeThreadId drift
            const runId = `run_${crypto.randomUUID()}`;
            let st = SESSION_THREADS.get(polarSessionId);
            const targetThreadId = ownerThreadId || st?.activeThreadId;

            // Mark thread as in-flight and ensure it's active
            if (st && targetThreadId) {
                const thread = st.threads.find(t => t.id === targetThreadId);
                if (thread) {
                    thread.status = 'in_progress';
                    thread.inFlight = { runId, workflowId, startedAt: now() };
                    delete thread.awaitingApproval;
                    thread.lastActivityTs = now();
                }
                // Force active thread to the workflow's thread
                st.activeThreadId = targetThreadId;
            }

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

                // Compute capability scope before validation — this is what extension-gateway enforces
                let activeDelegation = msgActiveDelegation;
                let capabilityScope = computeCapabilityScope({
                    sessionProfile: profile,
                    multiAgentConfig,
                    activeDelegation,
                    installedExtensions: extensionGateway.listStates()
                });

                const validation = validateSteps(workflowSteps, { capabilityScope });
                if (!validation.ok) {
                    // Validation failure: clear inFlight, set lastError
                    st = SESSION_THREADS.get(polarSessionId);
                    if (st && targetThreadId) {
                        const thread = st.threads.find(t => t.id === targetThreadId);
                        if (thread) {
                            thread.lastError = {
                                runId, workflowId, threadId: targetThreadId,
                                extensionId: 'orchestrator', capabilityId: 'validateSteps',
                                output: validation.errors.join(', ').slice(0, 300),
                                messageId: `msg_err_${crypto.randomUUID()}`, timestampMs: now()
                            };
                            thread.status = 'failed';
                            delete thread.inFlight;
                        }
                    }
                    return { status: 'error', text: "Workflow blocked: " + validation.errors.join(", ") };
                }

                const toolResults = [];

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
                        // Recompute capability scope after delegation change
                        capabilityScope = computeCapabilityScope({
                            sessionProfile: profile,
                            multiAgentConfig,
                            activeDelegation,
                            installedExtensions: extensionGateway.listStates()
                        });
                        const output = `Successfully delegated to ${parsedArgs.agentId}.` + (rejectedSkills.length ? ` Clamped: ${rejectedSkills.join(", ")}` : "");
                        toolResults.push({ tool: capabilityId, status: "delegated", output });

                        await chatManagementGateway.appendMessage({
                            sessionId: polarSessionId, userId: "system", role: "system",
                            text: `[DELEGATION ACTIVE] ${JSON.stringify(activeDelegation)}`, timestampMs: now()
                        });
                        continue;
                    }

                    if (capabilityId === "complete_task") {
                        activeDelegation = null;
                        // Recompute capability scope after delegation cleared
                        capabilityScope = computeCapabilityScope({
                            sessionProfile: profile,
                            multiAgentConfig,
                            activeDelegation,
                            installedExtensions: extensionGateway.listStates()
                        });
                        toolResults.push({ tool: capabilityId, status: "completed", output: "Task completed." });
                        await chatManagementGateway.appendMessage({ sessionId: polarSessionId, userId: "system", role: "system", text: `[DELEGATION CLEARED]`, timestampMs: now() });
                        continue;
                    }

                    const output = await extensionGateway.execute({
                        extensionId, extensionType, capabilityId, sessionId: polarSessionId, userId: "unknown", input: parsedArgs,
                        capabilityScope
                    });
                    const stepStatus = output?.status || "completed";
                    toolResults.push({ tool: capabilityId, status: stepStatus, output: output?.output || output?.error || "Done." });

                    // Record lastError on owning thread if step failed
                    if (stepStatus === 'failed' || stepStatus === 'error') {
                        st = SESSION_THREADS.get(polarSessionId);
                        if (st && targetThreadId) {
                            const thread = st.threads.find(t => t.id === targetThreadId);
                            if (thread) {
                                thread.lastError = {
                                    runId, workflowId, threadId: targetThreadId,
                                    extensionId, capabilityId,
                                    output: (output?.error || output?.output || 'Unknown error').slice(0, 300),
                                    messageId: `msg_err_${crypto.randomUUID()}`, timestampMs: now()
                                };
                                thread.status = 'failed';
                                delete thread.inFlight;
                            }
                        }
                    }
                }

                // Post-loop: clear inFlight on owning thread, set final status
                st = SESSION_THREADS.get(polarSessionId);
                const anyFailed = toolResults.some(r => r.status === 'failed' || r.status === 'error');
                if (st && targetThreadId) {
                    const thread = st.threads.find(t => t.id === targetThreadId);
                    if (thread) {
                        delete thread.inFlight;
                        if (anyFailed && !thread.lastError) {
                            const failedStep = toolResults.find(r => r.status === 'failed' || r.status === 'error');
                            thread.lastError = {
                                runId, workflowId, threadId: targetThreadId,
                                extensionId: failedStep?.tool || 'unknown',
                                capabilityId: failedStep?.tool || 'unknown',
                                output: (failedStep?.output || 'Execution failed').slice(0, 300),
                                messageId: `msg_err_${crypto.randomUUID()}`, timestampMs: now()
                            };
                            thread.status = 'failed';
                        } else if (!anyFailed) {
                            thread.status = 'in_progress'; // workflow done, thread continues
                        }
                        thread.lastActivityTs = now();
                    }
                }

                const deterministicHeader = "### 🛠️ Execution Results\n" + toolResults.map(r => (r.status === "failed" || r.status === "error" ? "❌ " : "✅ ") + `**${r.tool}**: ${typeof r.output === 'string' ? r.output.slice(0, 100) : 'Done.'}`).join("\n") + "\n\n";
                await chatManagementGateway.appendMessage({ sessionId: polarSessionId, userId: "system", role: "system", text: `[TOOL RESULTS] threadId=${targetThreadId} runId=${runId}\n${JSON.stringify(toolResults, null, 2)}`, timestampMs: now() });

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
                const cleanText = responseText.replace(/<polar_action>[\s\S]*?<\/polar_action>/, '').replace(/<thread_state>[\s\S]*?<\/thread_state>/, '').trim();

                const assistantMessageId = `msg_ast_${crypto.randomUUID()}`;
                await chatManagementGateway.appendMessage({
                    sessionId: polarSessionId, userId: "assistant", role: "assistant",
                    text: cleanText, messageId: assistantMessageId, timestampMs: now()
                });

                const sessionStateForReply = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
                return {
                    status: 'completed',
                    text: deterministicHeader + cleanText,
                    assistantMessageId,
                    useInlineReply: selectReplyAnchor({
                        sessionState: sessionStateForReply,
                        classification: { type: 'status_nudge', targetThreadId: targetThreadId }
                    }).useInlineReply
                };
            } catch (err) {
                // Crash path: record lastError on the owning thread (using stored threadId)
                st = SESSION_THREADS.get(polarSessionId);
                if (st && targetThreadId) {
                    const thread = st.threads.find(t => t.id === targetThreadId);
                    if (thread) {
                        thread.lastError = {
                            runId, workflowId, threadId: targetThreadId,
                            extensionId: 'orchestrator', capabilityId: 'executeWorkflow',
                            output: err.message?.slice(0, 300) || 'Unknown crash',
                            messageId: `msg_err_${crypto.randomUUID()}`, timestampMs: now()
                        };
                        thread.status = 'failed';
                        delete thread.inFlight;
                        thread.lastActivityTs = now();
                    }
                    // Keep failed thread active — don't let next message spawn a greeting
                    st.activeThreadId = targetThreadId;
                }
                return { status: 'error', text: `Crashed: ${err.message}`, internalMessageId: thread?.lastError?.messageId };
            }
        },

        updateMessageChannelId(sessionId, messageId, channelMessageId) {
            let st = SESSION_THREADS.get(sessionId);
            if (!st) return;
            for (const t of st.threads) {
                if (t.pendingQuestion?.askedAtMessageId === messageId) {
                    t.pendingQuestion.channelMessageId = channelMessageId;
                }
                if (t.lastError?.messageId === messageId) {
                    t.lastError.channelMessageId = channelMessageId;
                }
            }
        },

        async rejectWorkflow(workflowId) {
            const entry = PENDING_WORKFLOWS.get(workflowId);
            if (entry) {
                // Clear awaitingApproval on the owning thread
                const st = SESSION_THREADS.get(entry.polarSessionId);
                if (st && entry.threadId) {
                    const thread = st.threads.find(t => t.id === entry.threadId);
                    if (thread) {
                        thread.status = 'in_progress';
                        delete thread.awaitingApproval;
                        thread.lastActivityTs = now();
                    }
                }
            }
            PENDING_WORKFLOWS.delete(workflowId);
            return { status: 'rejected' };
        },

        /**
         * Handle a repair selection event (button click: A or B).
         * Deterministic — no LLM call needed.
         * @param {{ sessionId: string, selection: 'A'|'B', correlationId: string }} event
         * @returns {{ status: string, selectedThreadId?: string }}
         */
        async handleRepairSelectionEvent({ sessionId, selection, correlationId }) {
            const repairContext = PENDING_REPAIRS.get(correlationId);
            if (!repairContext) {
                return { status: 'error', text: 'Repair context not found or expired.' };
            }

            if (repairContext.sessionId !== sessionId) {
                return { status: 'error', text: 'Session mismatch for repair selection.' };
            }

            if (selection !== 'A' && selection !== 'B') {
                return { status: 'error', text: 'Invalid selection. Must be A or B.' };
            }

            let sessionState = SESSION_THREADS.get(sessionId) || { threads: [], activeThreadId: null };
            sessionState = handleRepairSelection(sessionState, selection, correlationId, repairContext, now());
            SESSION_THREADS.set(sessionId, sessionState);
            PENDING_REPAIRS.delete(correlationId);

            const selectedOption = repairContext.options.find(o => o.id === selection);
            return {
                status: 'completed',
                text: `Got it — continuing with: ${selectedOption?.label || selection}`,
                selectedThreadId: selectedOption?.threadId,
                useInlineReply: false
            };
        }
    };

    return Object.freeze(methods);
}
