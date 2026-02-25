import { fetchApi } from '../api.js';

export async function renderScheduler(container) {
  try {
    const queueData = await fetchApi('listSchedulerEventQueue');
    const { processedEvents = [], retryEvents = [], deadLetterEvents = [] } = queueData;

    let html = `
      <div class="grid grid-cols-3 fade-in" style="gap: 24px; margin-bottom: 32px; animation-delay: 0.1s;">
        <div class="card" style="border-top: 4px solid var(--success);">
          <div class="card-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
            Processed Queue
          </div>
          <div class="card-value success">${processedEvents.length}</div>
        </div>
        <div class="card" style="border-top: 4px solid var(--warning);">
          <div class="card-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            Retry Queue (Backoff)
          </div>
          <div class="card-value warning">${retryEvents.length}</div>
        </div>
        <div class="card" style="border-top: 4px solid var(--danger);">
          <div class="card-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            Dead Letter Queue
          </div>
          <div class="card-value danger">${deadLetterEvents.length}</div>
        </div>
      </div>
      
      <div class="card fade-in" style="animation-delay: 0.2s;">
        <h3 class="card-title" style="color: #fff; font-size: 16px; margin-bottom: 24px;">
           <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: var(--danger)"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"></path></svg>
           Production Job Store (Dead Letter Dispositions)
        </h3>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Event ID</th>
                <th>Source Definition</th>
                <th>Task Run Segment</th>
                <th>Attempts</th>
                <th>Fatal Reason</th>
                <th style="text-align: right;">Manual Override</th>
              </tr>
            </thead>
            <tbody>
              ${deadLetterEvents.length === 0 ? `
                <tr>
                  <td colspan="6" style="padding: 40px; text-align: center;">
                    <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="color: var(--success); opacity: 0.8; margin-bottom: 12px;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                    <div style="color: var(--text-main); font-size: 16px; font-weight: 500;">Queues are healthy</div>
                    <div style="color: var(--text-muted); font-size: 14px; margin-top: 4px;">No dead letter events present. All orchestrations are stable.</div>
                  </td>
                </tr>
              ` : ''}
              ${deadLetterEvents.map(event => `
                <tr style="transition: background var(--transition-fast);">
                  <td><code style="background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">${event.eventId.substring(0, 8)}...</code></td>
                  <td><span class="badge info">${event.source}</span></td>
                  <td style="font-variant-numeric: tabular-nums;">${event.runId.substring(0, 8)}...</td>
                  <td>
                    <div style="background: rgba(0,0,0,0.2); padding: 4px 10px; border-radius: 12px; display: inline-flex; align-items: center; gap: 6px;">
                      <span style="font-weight: 600; color: #fff;">${event.attempt}</span>
                      <span style="color: var(--text-muted);">/ ${event.maxAttempts}</span>
                    </div>
                  </td>
                  <td><div style="color: var(--danger); font-size: 13px; font-weight: 500; max-width: 250px; line-height: 1.4;">${event.reason}</div></td>
                  <td style="text-align: right;">
                    <button class="action-btn outline btn-action" data-action="requeue" data-queue="dead_letter" data-event-id="${event.eventId}" style="margin-right: 8px;">
                      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right: 4px; vertical-align: middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                      Requeue
                    </button>
                    <button class="action-btn btn-action" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: var(--danger); box-shadow: none;" data-action="dismiss" data-queue="dead_letter" data-event-id="${event.eventId}">
                      Dismiss
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Attach delegated events
    const buttons = container.querySelectorAll('.btn-action');
    buttons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget;
        const action = target.getAttribute('data-action');
        const queue = target.getAttribute('data-queue');
        const eventId = target.getAttribute('data-event-id');

        const originalContent = target.innerHTML;
        target.disabled = true;
        target.innerHTML = '<span style="opacity: 0.7;">Working...</span>';

        try {
          await fetchApi('runSchedulerQueueAction', {
            queue,
            action,
            eventId
          });
          // Re-render
          renderScheduler(container);
        } catch (err) {
          target.disabled = false;
          target.textContent = 'Failed';
          target.style.background = 'var(--danger)';
          target.style.color = '#fff';
          setTimeout(() => target.innerHTML = originalContent, 2000);
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="error-view fade-in">Failed to load Scheduler: ${err.message}</div>`;
  }
}
