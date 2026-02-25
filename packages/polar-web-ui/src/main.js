import './index.css';
import { fetchApi } from './api.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTasks } from './views/tasks.js';
import { renderTelemetry } from './views/telemetry.js';
import { renderScheduler } from './views/scheduler.js';

const VIEW_MAP = {
  dashboard: renderDashboard,
  tasks: renderTasks,
  telemetry: renderTelemetry,
  scheduler: renderScheduler
};

let currentView = 'dashboard';

document.addEventListener('DOMContentLoaded', () => {
  const navBtns = document.querySelectorAll('.nav-btn');
  const viewContainer = document.getElementById('view-container');
  const viewTitle = document.getElementById('view-title');
  const refreshBtn = document.querySelector('.action-btn.outline');
  const healthStatus = document.getElementById('health-status');

  async function loadView(viewName) {
    if (!VIEW_MAP[viewName]) return;

    currentView = viewName;

    // Update active state
    navBtns.forEach(btn => {
      if (btn.dataset.view === viewName) {
        btn.classList.add('active');
        viewTitle.textContent = btn.textContent;
      } else {
        btn.classList.remove('active');
      }
    });

    // Clear and render
    viewContainer.innerHTML = '<div class="fade-in" style="color:var(--text-muted)">Loading...</div>';
    await VIEW_MAP[viewName](viewContainer);
  }

  // Handle navigation
  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = e.currentTarget.dataset.view;
      loadView(view);
    });
  });

  // Handle refresh
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadView(currentView);
      pollHealth();
    });
  }

  // Health Polling
  const setHealthUI = (status, text) => {
    if (!healthStatus) return;
    const dot = healthStatus.querySelector('.dot');
    const span = healthStatus.querySelector('.text');

    if (status === 'ok') {
      dot.className = 'dot online';
      span.textContent = text || 'System Online';
      span.style.color = 'var(--text-main)';
    } else {
      dot.className = 'dot';
      dot.style.background = 'var(--danger)';
      dot.style.boxShadow = '0 0 10px var(--danger)';
      span.textContent = text || 'System Offline';
      span.style.color = 'var(--danger)';
    }
  };

  async function pollHealth() {
    try {
      const res = await fetchApi('health');
      setHealthUI(res.status || 'ok', 'Control Plane Online');
    } catch (e) {
      setHealthUI('error', 'Control Plane Offline');
    }
  }

  // Initial Load
  loadView('dashboard');
  pollHealth();

  // Poll every 10s
  setInterval(pollHealth, 10000);
});
