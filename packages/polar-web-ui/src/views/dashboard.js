import { fetchApi } from '../api.js';

export async function renderDashboard(container) {
  try {
    const health = await fetchApi('health');
    const alertsReq = await fetchApi('listTelemetryAlerts', { maxResults: 5 }).catch(() => ({ alerts: [] }));
    const usageReq = await fetchApi('listUsageTelemetry', { maxResults: 1 }).catch(() => ({ summary: {} }));

    const summary = usageReq.summary || {};

    container.innerHTML = `
      <div class="grid grid-cols-4 fade-in" style="animation-delay: 0.1s">
        <div class="card">
          <div class="card-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            Active Sessions
          </div>
          <div class="card-value success">${health.sessionCount || 0}</div>
        </div>
        <div class="card">
          <div class="card-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
            Tasks Managed
          </div>
          <div class="card-value info">${health.taskCount || 0}</div>
        </div>
        <div class="card">
          <div class="card-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            Usage Spend (Est)
          </div>
          <div class="card-value ${summary.totalEstimatedCostUsd > 10 ? 'warning' : 'success'}">$${(summary.totalEstimatedCostUsd || 0).toFixed(2)}</div>
        </div>
        <div class="card">
          <div class="card-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            Active Alerts
          </div>
          <div class="card-value ${alertsReq.alerts?.length > 0 ? 'danger' : 'success'}">${alertsReq.alerts?.length || 0}</div>
        </div>
      </div>
      
      <div class="grid grid-cols-2 fade-in" style="margin-top: 24px; animation-delay: 0.2s">
        <div class="card">
            <h3 class="card-title" style="font-size: 16px; margin-bottom: 24px; color: #fff;">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: var(--accent-color)"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
              Platform Health & Telemetry
            </h3>
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div class="glass-box" style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-size: 13px; color: var(--text-muted); font-weight: 600;">Core Contracts Enforced</div>
                        <div style="font-size: 20px; font-weight: 700;">${health.contractCount || 0}</div>
                    </div>
                    <span class="badge success">SECURED</span>
                </div>
                <div class="glass-box" style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-size: 13px; color: var(--text-muted); font-weight: 600;">Handoff Diagnostics Tracked</div>
                        <div style="font-size: 20px; font-weight: 700;">${health.handoffRoutingTelemetryCount || 0}</div>
                    </div>
                    <span class="badge info">ROUTING</span>
                </div>
                <div class="glass-box" style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-size: 13px; color: var(--text-muted); font-weight: 600;">Stored Memory Records</div>
                        <div style="font-size: 20px; font-weight: 700;">${health.recordCount || 0}</div>
                    </div>
                    <span class="badge success">PERSISTENT</span>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h3 class="card-title" style="font-size: 16px; margin-bottom: 24px; color: #fff;">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: var(--warning)"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
              Active Budget & Policy Rules
            </h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div style="padding: 16px; border-left: 3px solid var(--success); background: rgba(0,0,0,0.2); border-radius: 0 8px 8px 0;">
                    <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">Global Spend Quota (Development)</div>
                    <div style="font-size: 13px; color: var(--text-muted);">Enforcing strict local model fallback routing if spend exceeds $15.00/day.</div>
                    <div style="margin-top: 12px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                        <div style="width: ${(summary.totalEstimatedCostUsd / 15 * 100) || 5}%; height: 100%; background: var(--success);"></div>
                    </div>
                </div>
                <div style="padding: 16px; border-left: 3px solid var(--info); background: rgba(0,0,0,0.2); border-radius: 0 8px 8px 0;">
                    <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">Middleware Verification</div>
                    <div style="font-size: 13px; color: var(--text-muted);">All runtime boundaries and extensions are bound to strict schema validation. Bypass attempts are logged as <span class="badge danger" style="font-size:10px; padding:2px 4px;">CRITICAL</span>.</div>
                </div>
            </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="error-view fade-in">Failed to load Dashboard: ${err.message}</div>`;
  }
}
