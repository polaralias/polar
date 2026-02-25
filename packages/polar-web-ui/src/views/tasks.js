import { fetchApi } from '../api.js';

function getStatusBadge(status) {
  const map = {
    open: 'info',
    active: 'processing',
    completed: 'success',
    failed: 'failed',
    cancelled: 'error'
  };
  return `<span class="badge ${map[status] || 'info'}">${status}</span>`;
}

export async function renderTasks(container) {
  try {
    const res = await fetchApi('listTasks');
    const tasks = res.tasks || [];

    let html = `
      <div class="card fade-in">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <h3 class="card-title" style="margin: 0; color: #fff; font-size: 16px;">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: var(--accent-color)"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
            Active Task Board
            <span class="badge info" style="margin-left: 12px; font-size: 11px;">${tasks.length} Tracked</span>
          </h3>
          <div style="display: flex; gap: 8px;">
            <input type="text" placeholder="Filter tasks..." style="background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); color: #fff; padding: 8px 12px; border-radius: 8px; font-family: var(--font-family); font-size: 13px; outline: none; transition: border-color var(--transition-fast);">
          </div>
        </div>
        
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Task ID</th>
                <th>Run Status</th>
                <th>Owner Target</th>
                <th>Automation Summary</th>
                <th style="text-align: right;">Last Event Time</th>
              </tr>
            </thead>
            <tbody>
              ${tasks.length === 0 ? `
                <tr>
                  <td colspan="5" style="padding: 48px; text-align: center;">
                     <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="color: var(--text-muted); opacity: 0.5; margin-bottom: 12px;"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                     <div style="color: var(--text-main); font-size: 16px; font-weight: 500;">No Tasks Found</div>
                     <div style="color: var(--text-muted); font-size: 14px; margin-top: 4px;">There are no active automation or system tasks linked to the board.</div>
                  </td>
                </tr>
              ` : ''}
              ${tasks.map(task => `
                <tr style="cursor: pointer;">
                  <td><code style="background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05); color: var(--accent-color);">${task.taskId.substring(0, 8)}...</code></td>
                  <td>${getStatusBadge(task.status)}</td>
                  <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <div style="width: 24px; height: 24px; border-radius: 50%; background: ${task.ownerType === 'agent' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(236, 72, 153, 0.2)'}; display: flex; align-items: center; justify-content: center; color: ${task.ownerType === 'agent' ? 'var(--accent-color)' : 'var(--secondary-glow)'}; font-size: 10px; border: 1px solid ${task.ownerType === 'agent' ? 'rgba(99, 102, 241, 0.5)' : 'rgba(236, 72, 153, 0.5)'};">
                        ${task.ownerType === 'agent' ? '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>' : '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>'}
                      </div>
                      <span style="font-weight: 500;">${task.ownerType || 'unassigned'}</span>
                    </div>
                  </td>
                  <td>
                     <div style="max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.5;">
                        ${task.summary || '<em style="color: var(--text-muted); font-size: 13px;">No automation payload summary provided</em>'}
                     </div>
                  </td>
                  <td style="color: var(--text-muted); text-align: right; font-variant-numeric: tabular-nums;">${new Date(task.updatedAtMs).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="error-view fade-in">Failed to load Tasks: ${err.message}</div>`;
  }
}
