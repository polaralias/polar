import { fetchApi } from '../api.js';

export async function renderTelemetry(container) {
  try {
    const alertsReq = await fetchApi('listTelemetryAlerts', { maxResults: 100 }).catch(() => ({ alerts: [] }));
    const usageReq = await fetchApi('listUsageTelemetry', { maxResults: 20 })
      .catch(() => ({ events: [], summary: {} }));

    const alerts = alertsReq.alerts || [];
    const usage = usageReq.events || [];
    const summary = usageReq.summary || {};

    let html = `
      <div class="grid grid-cols-2 fade-in" style="gap: 32px;">
        <div class="card" style="display: flex; flex-direction: column;">
          <h3 class="card-title" style="color: #fff; font-size: 16px;">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: var(--danger)"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            Alert Workflow Routing & Notifications
            <span class="${alerts.length > 0 ? 'badge danger' : 'badge success'}" style="margin-left: auto;">${alerts.length} Active</span>
          </h3>
          
          <div style="flex: 1; overflow-y: auto; margin-top: 16px; padding-right: 8px;">
            ${alerts.length === 0 ? `
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--success); opacity: 0.8; padding: 40px 0;">
                <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <p style="margin-top: 12px; color: var(--text-muted); font-size: 14px;">All clear. No active alerts across routing/model usage paths.</p>
              </div>
            ` : ''}
            
            <div style="display: flex; flex-direction: column; gap: 12px;">
              ${alerts.map(a => `
                <div class="glass-box" style="display: flex; flex-direction: column; gap: 8px; border-left: 3px solid ${a.severity === 'critical' ? 'var(--danger)' : 'var(--warning)'}; transition: transform var(--transition-fast);">
                  <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <span class="badge ${a.severity === 'critical' ? 'failed' : 'pending'}">${a.severity.toUpperCase()}</span>
                      <strong style="font-size: 15px; color: #fff;">${a.type}</strong>
                    </div>
                    <small style="color: var(--text-muted); white-space: nowrap;">${new Date(a.createdAtMs).toLocaleTimeString()}</small>
                  </div>
                  <p style="color: var(--text-muted); font-size: 14px; margin-top: 4px; line-height: 1.5;">${a.description || 'N/A'}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        
        <div class="card" style="display: flex; flex-direction: column;">
          <h3 class="card-title" style="color: #fff; font-size: 16px;">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: var(--accent-color)"><path stroke-linecap="round" stroke-linejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path></svg>
            Token Estimates & Usage Stream
          </h3>
          
          <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; margin-top: 16px;">
            <div class="glass-box">
               <div style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing: 0.5px;">Calls</div>
               <div style="font-size:28px; font-weight:700; color: #fff; margin-top: 4px;">${summary.totalOperations || 0}</div>
            </div>
            <div class="glass-box">
               <div style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing: 0.5px;">Fallbacks</div>
               <div style="font-size:28px; font-weight:700; color:var(--warning); margin-top: 4px;">${summary.totalFallbacks || 0}</div>
            </div>
            <div class="glass-box">
               <div style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing: 0.5px;">Est Cost</div>
               <div style="font-size:28px; font-weight:700; color:var(--success); margin-top: 4px;">$${(summary.totalEstimatedCostUsd || 0).toFixed(3)}</div>
            </div>
          </div>
          
          <div style="overflow-x: auto; flex: 1;">
            <table class="data-table" style="min-width: 100%;">
              <thead>
                <tr>
                  <th>Operation</th>
                  <th>Provider Target</th>
                  <th>Status</th>
                  <th style="text-align: right;">Dur (ms)</th>
                </tr>
              </thead>
              <tbody>
                ${usage.length === 0 ? '<tr><td colspan="4" style="text-align:center; padding: 24px; color: var(--text-muted);">No recent usage telemetry visible.</td></tr>' : ''}
                ${usage.map(u => `
                  <tr>
                    <td style="font-family: var(--font-display); font-weight: 500;">${u.operation}</td>
                    <td>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        ${u.providerId} 
                        ${u.fallbackUsed ? '<span class="badge warning" style="font-size:10px; padding: 2px 6px;">Fallback</span>' : ''}
                      </div>
                    </td>
                    <td><span class="badge ${u.status === 'completed' ? 'success' : 'failed'}">${u.status}</span></td>
                    <td style="text-align: right; font-variant-numeric: tabular-nums;">${u.durationMs}ms</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="error-view fade-in">Failed to load Telemetry: ${err.message}</div>`;
  }
}
