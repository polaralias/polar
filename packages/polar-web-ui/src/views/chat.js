import { fetchApi } from '../api.js';

const MULTI_AGENT_CONFIG = {
    allowlistedModels: [
        "gpt-4o-mini",
        "gpt-4o",
        "claude-3-5-sonnet-latest",
        "claude-3-5-opus-latest",
        "gemini-2.5-flash",
        "gemini-2.5-pro"
    ],
    availableProfiles: [
        {
            agentId: "@writer_agent",
            description: "Specialized for writing tasks, document creation, and styling.",
            pinnedModel: "claude-3-5-sonnet-latest",
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

export async function renderChat(container) {
    const sessionId = localStorage.getItem('polar_ui_session') || crypto.randomUUID();
    localStorage.setItem('polar_ui_session', sessionId);

    let activeDelegation = null;
    let pendingWorkflow = null; // Store currently pending workflow blocks

    // Base UI Shell
    const html = `
      <div style="display: flex; flex-direction: column; height: calc(100vh - 140px);">
        <div id="chat-messages" style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid var(--card-border);">
           <!-- Messages go here -->
        </div>
        
        <form id="chat-input-form" style="margin-top: 16px; display: flex; gap: 12px; align-items: flex-end;">
            <textarea id="chat-textarea" placeholder="Send a message to Polar Orchestrator..." 
                      style="flex: 1; min-height: 50px; resize: none; border-radius: 8px; border: 1px solid var(--card-border); background: var(--card-bg); color: #fff; padding: 12px; font-family: var(--font-family);"
            ></textarea>
            <button type="submit" class="action-btn outline" style="height: 50px; white-space: nowrap;">Send</button>
        </form>
      </div>
    `;

    container.innerHTML = html;

    const messagesDiv = container.querySelector('#chat-messages');
    const inputForm = container.querySelector('#chat-input-form');
    const textarea = container.querySelector('#chat-textarea');

    // Make enter key submit
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            inputForm.dispatchEvent(new Event('submit'));
        }
    });

    // Append to UI
    function addBubble(role, htmlContent) {
        const div = document.createElement('div');
        div.style.maxWidth = '80%';
        div.style.padding = '12px 16px';
        div.style.borderRadius = '8px';
        div.style.lineHeight = '1.5';

        if (role === 'user') {
            div.style.alignSelf = 'flex-end';
            div.style.background = 'var(--primary-glow)';
            div.style.color = '#fff';
            div.style.border = '1px solid rgba(255,255,255,0.1)';
        } else if (role === 'system' || role === 'tool') {
            div.style.alignSelf = 'center';
            div.style.background = 'transparent';
            div.style.color = 'var(--text-muted)';
            div.style.fontSize = '12px';
            div.style.textAlign = 'center';
            div.style.maxWidth = '90%';
        } else {
            div.style.alignSelf = 'flex-start';
            div.style.background = 'rgba(255,255,255,0.05)';
            div.style.color = '#fff';
            div.style.border = '1px solid var(--card-border)';
        }

        div.innerHTML = htmlContent;
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        return div;
    }

    async function processOrchestrationLoop(initialUserMessage = null) {
        try {
            // Re-resolve profile rules logic (just in case they changed it in another tab)
            const profile = await fetchApi('resolveProfile', { sessionId });
            const policy = profile.profileConfig?.modelPolicy || {};

            let finalProviderId = policy.providerId || "openai";
            let finalModelId = policy.modelId || "gpt-4o-mini";
            let finalSystemPrompt = profile.profileConfig?.systemPrompt || "";

            // If we are spinning up a dynamic sub-agent loop
            if (activeDelegation) {
                finalModelId = activeDelegation.model_override || finalModelId;
                if (finalModelId.includes("claude")) finalProviderId = "anthropic";
                else if (finalModelId.includes("gemini")) finalProviderId = "google";

                finalSystemPrompt = `You are a specialized sub-agent: ${activeDelegation.agentId}.
Your primary instructions for this isolated task: ${activeDelegation.task_instructions}
You have been explicitly forwarded the following strict capabilities: ${activeDelegation.forward_skills?.join(", ") || "None"}.
Execute your task safely. If you need tools, propose them via <polar_workflow>.`;
            } else {
                // We are the Primary Orchestrator
                finalSystemPrompt += `\n\n[MULTI-AGENT ORCHESTRATION ENGINE]
You are the Primary Orchestrator. You handle simple queries natively.
If the user asks for complex flows, deep reviews, long-running tasks, or writing assignments, YOU MUST DELEGATE to a sub-agent.
When delegating, explicitly forward capabilities to the sub-agent.

Available pre-configured sub-agents:
${JSON.stringify(MULTI_AGENT_CONFIG.availableProfiles, null, 2)}

Models allowlist (use these if spinning up unpinned profile):
${JSON.stringify(MULTI_AGENT_CONFIG.allowlistedModels, null, 2)}

To delegate to a sub-agent, propose a workflow step using the tool "delegate_to_agent":
{
  "extensionId": "system",
  "extensionType": "core",
  "capabilityId": "delegate_to_agent",
  "args": {
    "agentId": "@writer_agent",
    "model_override": "claude-3-5-opus-latest",
    "task_instructions": "Review inbox...",
    "forward_skills": ["email_mcp"]
  }
}

[WORKFLOW CAPABILITY ENGINE]
You have the ability to propose deterministic workflows.
If the request requires executing tools or delegating, explicitly propose a workflow by outputting a JSON block wrapped exactly in <polar_workflow>...</polar_workflow> tags.
The JSON must be an array of step objects, where each step has "extensionId", "extensionType", "capabilityId", and "args".
For delegation, use capabilityId: "delegate_to_agent", extensionId: "system", extensionType: "core".
For sub-agent task completion, use capabilityId: "complete_task", extensionId: "system", extensionType: "core".
Always explain your plan to the user briefly before outputting the <polar_workflow> block.`;
            }

            // Sync History
            const historyData = await fetchApi('getSessionHistory', { sessionId, limit: 20 });
            let messages = historyData?.items ? historyData.items.map(m => ({ role: m.role, content: m.text })) : [];

            // Execute Generation
            const generatingIndicator = addBubble('assistant', '<span class="pulsing">Generating bounds...</span>');

            const result = await fetchApi('generateOutput', {
                executionType: "handoff",
                providerId: finalProviderId,
                model: finalModelId,
                system: finalSystemPrompt,
                messages: messages,
                prompt: ""
            });

            generatingIndicator.remove();

            if (result && result.text) {
                let responseText = result.text;
                const workflowMatch = responseText.match(/<polar_workflow>([\s\S]*?)<\/polar_workflow>/);

                if (workflowMatch) {
                    const workflowJsonString = workflowMatch[1].trim();
                    responseText = responseText.replace(workflowMatch[0], '').trim();

                    if (responseText) {
                        addBubble('assistant', responseText.replace(/\\n/g, '<br>'));
                        await fetchApi('appendMessage', {
                            sessionId,
                            userId: "assistant",
                            messageId: 'msg_a_' + Date.now(),
                            role: "assistant",
                            text: responseText,
                            timestampMs: Date.now()
                        });
                    }

                    try {
                        pendingWorkflow = JSON.parse(workflowJsonString);

                        // Render Workflow Box
                        let wfHtml = `<strong>⚡ Proposed Execution Workflow:</strong><br><ul style="margin-top: 8px; padding-left: 16px; opacity: 0.8">`;
                        pendingWorkflow.forEach(s => {
                            wfHtml += `<li><code>${s.capabilityId}</code> (from ${s.extensionId})</li>`;
                        });
                        wfHtml += `</ul><div style="margin-top: 12px; display:flex; gap:8px;">
                            <button id="wf-approve-btn" class="action-btn outline" style="font-size: 12px; padding: 6px 12px; color: var(--primary-glow); border-color: var(--primary-glow)">Execute</button>
                            <button id="wf-reject-btn" class="action-btn outline" style="font-size: 12px; padding: 6px 12px; color: var(--danger); border-color: var(--danger)">Reject</button>
                        </div>`;

                        const wfDiv = addBubble('assistant', wfHtml);

                        // Attach Listeners
                        wfDiv.querySelector('#wf-approve-btn').addEventListener('click', async () => {
                            wfDiv.querySelectorAll('button').forEach(b => b.remove()); // remove buttons
                            await executePendingWorkflow();
                        });
                        wfDiv.querySelector('#wf-reject-btn').addEventListener('click', () => {
                            wfDiv.querySelectorAll('button').forEach(b => b.remove()); // remove buttons
                            addBubble('system', 'Workflow Rejected.');
                            pendingWorkflow = null;
                        });

                    } catch (e) {
                        addBubble('system', 'Agent proposed invalid JSON workflow block.');
                    }
                } else {
                    addBubble('assistant', responseText.replace(/\\n/g, '<br>'));
                    await fetchApi('appendMessage', {
                        sessionId,
                        userId: "assistant", // Using system UUID in production
                        messageId: 'msg_a_' + Date.now(),
                        role: "assistant",
                        text: responseText,
                        timestampMs: Date.now()
                    });
                }
            }

        } catch (e) {
            addBubble('system', '<span style="color:var(--danger)">Error talking to Control Plane: ' + e.message + '</span>');
        }
    }


    async function executePendingWorkflow() {
        if (!pendingWorkflow) return;
        const stepsToRun = [...pendingWorkflow];
        pendingWorkflow = null;

        addBubble('system', 'Executing Workflow Tools...');
        const toolResults = [];

        for (const step of stepsToRun) {
            const capabilityId = step.capabilityId;
            const extensionId = step.extensionId;
            const extensionType = step.extensionType || "mcp";
            const parsedArgs = step.args || {};

            if (capabilityId === "delegate_to_agent") {
                activeDelegation = parsedArgs;
                toolResults.push({
                    tool: capabilityId,
                    status: "delegated",
                    output: `Successfully spun up sub-agent ${parsedArgs.agentId}.`
                });

                await fetchApi('appendMessage', {
                    sessionId, userId: "system", role: "system",
                    messageId: `msg_sys_${Date.now()}_delegation`,
                    text: `[DELEGATION ACTIVE] ${JSON.stringify(parsedArgs)}`,
                    timestampMs: Date.now()
                });
                addBubble('system', `🔄 Handoff to ${parsedArgs.agentId}...`);
                continue;
            }

            if (capabilityId === "complete_task") {
                toolResults.push({
                    tool: capabilityId,
                    status: "completed",
                    output: "Handed control back to Primary Orchestrator."
                });

                activeDelegation = null;
                await fetchApi('appendMessage', {
                    sessionId, userId: "system", role: "system",
                    messageId: `msg_sys_${Date.now()}_delegation_clear`,
                    text: `[DELEGATION CLEARED]`,
                    timestampMs: Date.now()
                });
                addBubble('system', `🔄 Returning control to Primary Orchestrator...`);
                continue;
            }

            try {
                // Execute Real Sandbox Call!
                const output = await fetchApi('executeExtension', {
                    extensionId: extensionId,
                    extensionType: extensionType,
                    capabilityId: capabilityId,
                    sessionId: sessionId,
                    userId: "ui-user",
                    capabilityScope: {},
                    input: parsedArgs
                });

                toolResults.push({
                    tool: capabilityId,
                    status: output?.status || "completed",
                    output: output?.output || output?.error || "Silent completion."
                });

                addBubble('tool', `✅ ${capabilityId} (${output?.status})`);

            } catch (err) {
                toolResults.push({ tool: capabilityId, status: "error", error: err.message });
                addBubble('tool', `❌ ${capabilityId} failed`);
            }
        }

        // Write Results to Memory
        await fetchApi('appendMessage', {
            sessionId: sessionId,
            userId: "system",
            messageId: `msg_sys_${Date.now()}`,
            role: "system",
            text: `[TOOL RESULTS]\n${JSON.stringify(toolResults, null, 2)}`,
            timestampMs: Date.now()
        });

        // Loop the AI back!
        addBubble('system', 'Parsing Execution Results...');
        await processOrchestrationLoop();
    }


    inputForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = textarea.value.trim();
        if (!text) return;

        // Reset
        textarea.value = '';
        addBubble('user', text);

        // Append to memory
        await fetchApi('appendMessage', {
            sessionId,
            userId: "ui-user",
            messageId: 'msg_u_' + Date.now(),
            role: "user",
            text: text,
            timestampMs: Date.now()
        });

        await processOrchestrationLoop();
    });

    // Populate existing history on load? Let's just say hello for now:
    addBubble('system', 'Polar Headless Web Chat Initialized (Session: ' + sessionId + ').');
}
