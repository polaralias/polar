import { fetchApi } from '../api.js';

export async function renderChat(container) {
    const sessionId = localStorage.getItem('polar_ui_session') || crypto.randomUUID();
    localStorage.setItem('polar_ui_session', sessionId);

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

    const completedReactions = new Set();

    // Append to UI
    function addBubble(role, htmlContent, meta = {}) {
        const div = document.createElement('div');
        div.style.maxWidth = '80%';
        div.style.padding = '12px 16px';
        div.style.borderRadius = '8px';
        div.style.lineHeight = '1.5';
        div.style.position = 'relative';

        if (role === 'user') {
            // New user message: clear old completed reactions
            completedReactions.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });
            completedReactions.clear();

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

        if (meta.reaction) {
            const reactionDiv = document.createElement('div');
            reactionDiv.id = `reaction-${crypto.randomUUID()}`;
            reactionDiv.innerText = meta.reaction;
            reactionDiv.style.position = 'absolute';
            reactionDiv.style.bottom = '-10px';
            reactionDiv.style.left = '10px';
            reactionDiv.style.fontSize = '14px';
            reactionDiv.style.background = '#1a1a2e';
            reactionDiv.style.borderRadius = '10px';
            reactionDiv.style.padding = '2px 6px';
            reactionDiv.style.border = '1px solid var(--card-border)';
            div.appendChild(reactionDiv);
            if (meta.done) completedReactions.add(reactionDiv.id);
        }

        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        return div;
    }

    async function processOrchestratorResponse(result) {
        if (!result) return;

        if (result.error) {
            addBubble('system', '<span style="color:var(--danger)">❌ Error: ' + result.error + '</span>');
            return;
        }

        if (result.text) {
            const isCompleted = result.status === 'completed';
            addBubble('assistant', result.text.replace(/\n/g, '<br>'), {
                reaction: isCompleted ? '✅' : (result.status === 'workflow_proposed' ? '⚡' : ''),
                done: isCompleted
            });
        }

        if (result.status === 'workflow_proposed' && result.workflowId) {
            const workflowId = result.workflowId;
            const steps = result.steps || [];

            let wfHtml = `<strong>⚡ Proposed Execution Workflow:</strong><br><ul style="margin-top: 8px; padding-left: 16px; opacity: 0.8">`;
            steps.forEach(s => {
                wfHtml += `<li><code>${s.capabilityId}</code> (from ${s.extensionId})</li>`;
            });
            wfHtml += `</ul><div style="margin-top: 12px; display:flex; gap:8px;">
                <button id="wf-approve-btn-${workflowId}" class="action-btn outline" style="font-size: 12px; padding: 6px 12px; color: var(--primary-glow); border-color: var(--primary-glow)">Execute</button>
                <button id="wf-reject-btn-${workflowId}" class="action-btn outline" style="font-size: 12px; padding: 6px 12px; color: var(--danger); border-color: var(--danger)">Reject</button>
            </div>`;

            const wfDiv = addBubble('assistant', wfHtml);

            wfDiv.querySelector(`#wf-approve-btn-${workflowId}`).addEventListener('click', async () => {
                wfDiv.querySelectorAll('button').forEach(b => b.remove());
                addBubble('system', 'Executing Workflow Tools...');

                const execIndicator = addBubble('assistant', '<span class="pulsing">⚡ Executing & Summarizing...</span>');
                try {
                    const execResult = await fetchApi('executeWorkflow', { workflowId });
                    execIndicator.remove();
                    await processOrchestratorResponse(execResult);
                } catch (e) {
                    execIndicator.remove();
                    addBubble('system', '<span style="color:var(--danger)">Error: ' + e.message + '</span>');
                }
            });

            wfDiv.querySelector(`#wf-reject-btn-${workflowId}`).addEventListener('click', async () => {
                wfDiv.querySelectorAll('button').forEach(b => b.remove());
                addBubble('system', 'Workflow Rejected.');
                try {
                    await fetchApi('rejectWorkflow', { workflowId });
                } catch (e) {
                    console.error("Failed to reject workflow", e);
                }
            });
        }
    }

    async function handleOrchestratorTurn(text = null, messageId = null, replyToMessageId = null) {
        try {
            const generatingIndicator = addBubble('assistant', '<span class="pulsing">🧠 Thinking...</span>');

            const payload = {
                sessionId,
                userId: "ui-user",
                text: text || "",
                messageId: messageId || crypto.randomUUID(),
                replyToMessageId: replyToMessageId || undefined,
                channelMetadata: {
                    source: "polar-web-ui",
                    userAgent: navigator.userAgent
                }
            };

            const result = await fetchApi('orchestrate', payload);
            generatingIndicator.remove();

            await processOrchestratorResponse(result);

        } catch (e) {
            addBubble('system', '<span style="color:var(--danger)">Error talking to Control Plane: ' + e.message + '</span>');
        }
    }

    inputForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = textarea.value.trim();
        if (!text) return;

        textarea.value = '';
        addBubble('user', text);

        const messageId = crypto.randomUUID();
        await handleOrchestratorTurn(text, messageId);
    });

    // Populate existing history on load? Let's just say hello for now:
    addBubble('system', 'Polar Headless Web Chat Initialized (Session: ' + sessionId + ').');
}
