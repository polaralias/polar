import { fetchApi } from '../api.js';

export async function renderChat(container) {
    const sessionId = localStorage.getItem('polar_ui_session') || crypto.randomUUID();
    localStorage.setItem('polar_ui_session', sessionId);
    const REJECTION_FOLLOW_UP_TEXT = 'I can see that was rejected. What needs changing?';

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

        if (result.status === 'repair_question' && result.correlationId) {
            const optionA = (result.options || []).find((option) => option.id === 'A');
            const optionB = (result.options || []).find((option) => option.id === 'B');
            const safeCorrelationId = String(result.correlationId).replace(/[^a-zA-Z0-9_-]/g, '_');
            const questionText = result.question || 'I found multiple possible contexts. Which one should I continue?';
            const repairHtml = `
                <strong>Need clarification</strong><br>
                <span>${questionText.replace(/\n/g, '<br>')}</span>
                <div style="margin-top: 12px; display:flex; gap:8px;">
                    <button id="repair-select-btn-A-${safeCorrelationId}" class="action-btn outline" style="font-size: 12px; padding: 6px 12px;">🅰️ ${optionA?.label || 'Option A'}</button>
                    <button id="repair-select-btn-B-${safeCorrelationId}" class="action-btn outline" style="font-size: 12px; padding: 6px 12px;">🅱️ ${optionB?.label || 'Option B'}</button>
                </div>
            `;

            const repairDiv = addBubble('assistant', repairHtml, {
                reaction: '⚡',
                done: false
            });

            const disableRepairButtons = () => {
                repairDiv.querySelectorAll('button').forEach((button) => {
                    button.disabled = true;
                });
            };
            const clearRepairButtons = () => {
                repairDiv.querySelectorAll('button').forEach((button) => {
                    button.remove();
                });
            };

            repairDiv.querySelector(`#repair-select-btn-A-${safeCorrelationId}`)?.addEventListener('click', async () => {
                disableRepairButtons();
                try {
                    const selectionResult = await fetchApi('handleRepairSelection', {
                        sessionId,
                        selection: 'A',
                        correlationId: result.correlationId
                    });
                    clearRepairButtons();
                    await processOrchestratorResponse(selectionResult);
                } catch (e) {
                    clearRepairButtons();
                    addBubble('system', '<span style="color:var(--danger)">Error: ' + e.message + '</span>');
                }
            });

            repairDiv.querySelector(`#repair-select-btn-B-${safeCorrelationId}`)?.addEventListener('click', async () => {
                disableRepairButtons();
                try {
                    const selectionResult = await fetchApi('handleRepairSelection', {
                        sessionId,
                        selection: 'B',
                        correlationId: result.correlationId
                    });
                    clearRepairButtons();
                    await processOrchestratorResponse(selectionResult);
                } catch (e) {
                    clearRepairButtons();
                    addBubble('system', '<span style="color:var(--danger)">Error: ' + e.message + '</span>');
                }
            });

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
            if (result.proposalMode === 'dry_run_approval') {
                const safeWorkflowId = String(workflowId).replace(/[^a-zA-Z0-9_-]/g, '_');
                const previewSummary = typeof result.previewSummary === 'string'
                    ? `<div style="margin-top:8px; opacity:0.9; white-space:pre-wrap">${result.previewSummary}</div>`
                    : '';
                let wfHtml = `<strong>🟠 Dry Run Preview</strong><br><ul style="margin-top: 8px; padding-left: 16px; opacity: 0.8">`;
                steps.forEach(s => {
                    wfHtml += `<li><code>${s.capabilityId}</code> (from ${s.extensionId})</li>`;
                });
                wfHtml += `</ul>${previewSummary}<div style="margin-top: 12px; display:flex; gap:8px; flex-wrap:wrap;">
                    <button id="wf-approve-btn-${safeWorkflowId}" class="action-btn outline" style="font-size: 12px; padding: 6px 12px;">Approve</button>
                    <button id="wf-reject-btn-${safeWorkflowId}" class="action-btn outline" style="font-size: 12px; padding: 6px 12px; color: var(--danger); border-color: var(--danger)">Reject</button>
                    <button id="wf-details-btn-${safeWorkflowId}" class="action-btn outline" style="font-size: 12px; padding: 6px 12px;">Details</button>
                </div>
                <pre id="wf-details-payload-${safeWorkflowId}" style="display:none; margin-top:12px; max-height:280px; overflow:auto; white-space:pre-wrap;">${JSON.stringify(result.previewPayload || {}, null, 2)}</pre>`;

                const wfDiv = addBubble('assistant', wfHtml, {
                    reaction: '⚡',
                    done: false
                });
                const approveButton = wfDiv.querySelector(`#wf-approve-btn-${safeWorkflowId}`);
                const rejectButton = wfDiv.querySelector(`#wf-reject-btn-${safeWorkflowId}`);
                const detailsButton = wfDiv.querySelector(`#wf-details-btn-${safeWorkflowId}`);
                const detailsPayload = wfDiv.querySelector(`#wf-details-payload-${safeWorkflowId}`);

                const disableButtons = () => {
                    [approveButton, rejectButton, detailsButton].forEach((button) => {
                        if (button) {
                            button.disabled = true;
                        }
                    });
                };

                approveButton?.addEventListener('click', async () => {
                    disableButtons();
                    try {
                        const execResult = await fetchApi('executeWorkflow', { workflowId, approved: true });
                        wfDiv.querySelectorAll('button').forEach((button) => button.remove());
                        await processOrchestratorResponse(execResult);
                    } catch (e) {
                        addBubble('system', '<span style="color:var(--danger)">Approve failed: ' + e.message + '</span>');
                    }
                });

                rejectButton?.addEventListener('click', async () => {
                    disableButtons();
                    try {
                        await fetchApi('rejectWorkflow', { workflowId });
                        wfDiv.querySelectorAll('button').forEach((button) => button.remove());
                        addBubble('assistant', REJECTION_FOLLOW_UP_TEXT);
                    } catch (e) {
                        addBubble('system', '<span style="color:var(--danger)">Reject failed: ' + e.message + '</span>');
                    }
                });

                detailsButton?.addEventListener('click', () => {
                    if (!detailsPayload) return;
                    const isHidden = detailsPayload.style.display === 'none';
                    detailsPayload.style.display = isHidden ? 'block' : 'none';
                    detailsButton.textContent = isHidden ? 'Hide details' : 'Details';
                });
                return;
            }

            let wfHtml = `<strong>⚡ Proposed Execution Workflow:</strong><br><ul style="margin-top: 8px; padding-left: 16px; opacity: 0.8">`;
            steps.forEach(s => {
                wfHtml += `<li><code>${s.capabilityId}</code> (from ${s.extensionId})</li>`;
            });
            wfHtml += `</ul><div style="margin-top: 12px; display:flex; gap:8px;">
                <button id="wf-cancel-btn-${workflowId}" class="action-btn outline" style="font-size: 12px; padding: 6px 12px; color: var(--danger); border-color: var(--danger)">Cancel</button>
            </div>`;

            const wfDiv = addBubble('assistant', wfHtml);
            const cancelButton = wfDiv.querySelector(`#wf-cancel-btn-${workflowId}`);
            const execIndicator = addBubble('assistant', '<span class="pulsing">⚡ Executing workflow...</span>');

            const onFinish = () => {
                execIndicator.remove();
                if (cancelButton) {
                    cancelButton.remove();
                }
            };

            cancelButton?.addEventListener('click', async () => {
                cancelButton.disabled = true;
                try {
                    const cancelResult = await fetchApi('cancelWorkflow', { workflowId });
                    const cancelled =
                        cancelResult?.status === 'cancelled' ||
                        cancelResult?.status === 'cancellation_requested';
                    addBubble(
                        'system',
                        cancelled ? '🛑 Cancellation requested.' : '⚠️ Workflow was already complete.'
                    );
                } catch (e) {
                    addBubble('system', '<span style="color:var(--danger)">Cancel failed: ' + e.message + '</span>');
                }
            });

            try {
                const execResult = await fetchApi('executeWorkflow', { workflowId });
                onFinish();
                await processOrchestratorResponse(execResult);
            } catch (e) {
                onFinish();
                addBubble('system', '<span style="color:var(--danger)">Error: ' + e.message + '</span>');
            }
            return;
        }

        if (result.status === 'automation_created' && result.jobId) {
            const safeJobId = String(result.jobId).replace(/[^a-zA-Z0-9_-]/g, '_');
            const autoHtml = `
                <strong>🗓️ Automation Live</strong><br>
                <div style="margin-top:8px; opacity:0.85">Job ID: <code>${result.jobId}</code><br>Schedule: <code>${result.job?.schedule || result.proposal?.schedule || 'unknown'}</code></div>
                <div style="margin-top: 12px; display:flex; gap:8px;">
                    <button id="auto-delete-btn-${safeJobId}" class="action-btn outline" style="font-size: 12px; padding: 6px 12px; color: var(--danger); border-color: var(--danger)">Reject</button>
                </div>
            `;
            const autoDiv = addBubble('assistant', autoHtml);
            const deleteButton = autoDiv.querySelector(`#auto-delete-btn-${safeJobId}`);
            deleteButton?.addEventListener('click', async () => {
                deleteButton.disabled = true;
                try {
                    const deleted = await fetchApi('deleteAutomationJob', { id: result.jobId });
                    deleteButton.remove();
                    if (deleted?.status === 'deleted') {
                        addBubble('assistant', REJECTION_FOLLOW_UP_TEXT);
                    } else {
                        addBubble('system', '⚠️ Automation was already gone.');
                    }
                } catch (e) {
                    addBubble('system', '<span style="color:var(--danger)">Reject failed: ' + e.message + '</span>');
                }
            });
            return;
        }

        if (result.status === 'automation_proposed' && result.proposalId) {
            const safeProposalId = String(result.proposalId).replace(/[^a-zA-Z0-9_-]/g, '_');
            const autoHtml = `
                <strong>🗓️ Automation Proposal</strong><br>
                <div style="margin-top:8px; opacity:0.85">Schedule: <code>${result.proposal?.schedule || 'unknown'}</code><br>Prompt: <code>${result.proposal?.promptTemplate || 'unknown'}</code></div>
                <div style="margin-top: 12px; display:flex; gap:8px;">
                    <button id="auto-approve-btn-${safeProposalId}" class="action-btn outline" style="font-size: 12px; padding: 6px 12px;">Approve</button>
                    <button id="auto-reject-btn-${safeProposalId}" class="action-btn outline" style="font-size: 12px; padding: 6px 12px; color: var(--danger); border-color: var(--danger)">Reject</button>
                </div>
            `;
            const autoDiv = addBubble('assistant', autoHtml);
            const approveButton = autoDiv.querySelector(`#auto-approve-btn-${safeProposalId}`);
            const rejectButton = autoDiv.querySelector(`#auto-reject-btn-${safeProposalId}`);

            approveButton?.addEventListener('click', async () => {
                approveButton.disabled = true;
                rejectButton.disabled = true;
                try {
                    const proposalResult = await fetchApi('consumeAutomationProposal', { proposalId: result.proposalId });
                    if (proposalResult?.status !== 'found') {
                        addBubble('system', '⚠️ This automation proposal expired or was already handled.');
                        return;
                    }
                    const created = await fetchApi('createAutomationJob', {
                        ownerUserId: proposalResult.proposal.userId,
                        sessionId: proposalResult.proposal.sessionId,
                        schedule: proposalResult.proposal.schedule,
                        promptTemplate: proposalResult.proposal.promptTemplate,
                        limits: proposalResult.proposal.limits,
                        quietHours: proposalResult.proposal.quietHours,
                        enabled: true
                    });
                    autoDiv.querySelectorAll('button').forEach((button) => button.remove());
                    await processOrchestratorResponse({
                        status: 'automation_created',
                        jobId: created?.job?.id,
                        job: created?.job,
                        proposalId: result.proposalId,
                        proposal: result.proposal,
                        text: created?.status === 'created'
                            ? `Automation created.\nJob ID: ${created.job.id}\nSchedule: ${created.job.schedule}\nReject it if you want changes.`
                            : 'Automation approval succeeded, but job creation did not complete.'
                    });
                } catch (e) {
                    addBubble('system', '<span style="color:var(--danger)">Automation create failed: ' + e.message + '</span>');
                }
            });

            rejectButton?.addEventListener('click', async () => {
                approveButton.disabled = true;
                rejectButton.disabled = true;
                try {
                    await fetchApi('rejectAutomationProposal', { proposalId: result.proposalId });
                    autoDiv.querySelectorAll('button').forEach((button) => button.remove());
                    addBubble('assistant', REJECTION_FOLLOW_UP_TEXT);
                } catch (e) {
                    addBubble('system', '<span style="color:var(--danger)">Reject failed: ' + e.message + '</span>');
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
                metadata: {
                    executionType: "interactive",
                    ...(replyToMessageId ? { replyToMessageId } : {}),
                    source: "polar-web-ui",
                    userAgent: navigator.userAgent
                },
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
