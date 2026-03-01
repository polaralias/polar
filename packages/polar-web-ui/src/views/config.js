import { fetchApi } from '../api.js';

export async function renderConfig(container) {
  try {
    const budgetReq = await fetchApi('getBudgetPolicy', { scope: 'global' }).catch(() => ({ status: 'not_found' }));
    const budget = budgetReq.status === 'ok' ? budgetReq : { maxLimitUsd: 15.00, resetIntervalMs: 86400000 };

    // We can fetch providers and profiles using listConfigs if needed
    const reqList = await fetchApi('listConfigs', {}).catch(() => ({ records: [] }));
    const records = reqList.records || [];

    const providers = records.filter(r => r.resourceType === 'provider');
    const profiles = records.filter(r => r.resourceType === 'profile');
    const extensions = records.filter(r => r.resourceType === 'extension');
    const globalPersonalityResult = await fetchApi('getPersonalityProfile', { scope: 'global' }).catch(() => ({ status: 'not_found' }));
    const personalityListResult = await fetchApi('listPersonalityProfiles', { limit: 50 }).catch(() => ({ items: [] }));
    const globalPersonalityPrompt =
      globalPersonalityResult.status === 'found' && typeof globalPersonalityResult.profile?.prompt === 'string'
        ? globalPersonalityResult.profile.prompt
        : '';
    const personalityItems = Array.isArray(personalityListResult.items) ? personalityListResult.items : [];

    const html = `
      <div style="display: flex; gap: 24px; margin-bottom: 24px;">
         <button class="action-btn" id="tab-budget">Budget & Policy</button>
         <button class="action-btn outline" id="tab-providers">Providers</button>
         <button class="action-btn outline" id="tab-profiles">Agent Profiles</button>
         <button class="action-btn outline" id="tab-personality">Personality</button>
         <button class="action-btn outline" id="tab-extensions">MCP & Skills</button>
         <button class="action-btn outline" id="tab-files">System Files</button>
      </div>

      <!-- BUDGET TAB -->
      <div id="section-budget" class="config-section fade-in">
        <div class="grid grid-cols-2" style="gap: 32px;">
          <div class="card" style="display: flex; flex-direction: column;">
            <h3 class="card-title" style="color: #fff; font-size: 16px; margin-bottom: 24px;">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: var(--warning); margin-right: 8px;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              Budget Governance & Rate Limits
            </h3>
            <form id="budget-form" style="display: flex; flex-direction: column; gap: 16px;">
              <div style="display: flex; gap: 12px;">
                <div class="glass-box" style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
                  <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Scope</label>
                  <select id="budget-scope" style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 6px;">
                    <option value="global" style="color:#000;">Global</option>
                    <option value="workspace" style="color:#000;">Workspace</option>
                  </select>
                </div>
                <div id="budget-target-container" class="glass-box" style="flex: 2; display: none; flex-direction: column; gap: 8px;">
                  <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Workspace ID</label>
                  <input type="text" id="budget-target" placeholder="ws-1" style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 6px;" />
                </div>
              </div>
              <div class="glass-box" style="display: flex; flex-direction: column; gap: 8px;">
                <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Max Spend Limit (USD)</label>
                <input type="number" id="budget-limit" step="0.01" value="${budget.maxLimitUsd || 10.00}" style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 6px; font-family:var(--font-display);" />
              </div>
              <div class="glass-box" style="display: flex; flex-direction: column; gap: 8px;">
                <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Reset Interval (Hours)</label>
                <input type="number" id="budget-reset" step="1" value="${(budget.resetIntervalMs || 86400000) / 3600000}" style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 6px; font-family:var(--font-display);" />
              </div>
              <div style="display: flex; align-items: center; gap: 12px;">
                <input type="checkbox" id="budget-blocking" ${budget.enforceBlocking !== false ? 'checked' : ''} style="width: 18px; height: 18px;" />
                <label style="font-size: 13px; color: #fff;">Enforce Hard Blocking</label>
              </div>
              <button type="submit" class="action-btn" style="margin-top: 8px; width: 100%; border:none;">Upsert Governance Policy</button>
              <div id="budget-msg" style="font-size: 13px; min-height: 20px; transition: color 0.2s;"></div>
            </form>
          </div>
          <div class="card" style="display: flex; flex-direction: column;">
            <h3 class="card-title" style="color: #fff; font-size: 16px; margin-bottom: 24px;">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: var(--success); margin-right: 8px;"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
              Memory Compaction Lifecycle
            </h3>
            <div class="glass-box" style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
              <p style="font-size: 14px; line-height: 1.5; color: var(--text-muted);">
                Force a manual runtime memory compaction pass. This gathers decentralized session memory records,
                aggregates redundancies by invoking the reasoning model, and replaces granular facts with cohesive summaries.
              </p>
            </div>
            <button id="compact-btn" class="action-btn outline" style="width: 100%;">Initialize Compaction Run</button>
            <div id="compact-msg" style="font-size: 13px; margin-top: 16px; min-height: 20px;"></div>
          </div>
        </div>
      </div>

      <!-- PROVIDERS TAB -->
      <div id="section-providers" class="config-section fade-in" style="display: none;">
        <div class="card" style="display: flex; flex-direction: column;">
          <h3 class="card-title" style="color: #fff; font-size: 16px; margin-bottom: 24px;">LLM Providers</h3>
          <div style="margin-bottom: 24px; display: flex; flex-direction: column; gap: 8px;">
            <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Recommended Presets</label>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
               <button type="button" class="action-btn outline small preset-btn" data-id="openai" data-mode="responses" data-url="https://api.openai.com/v1/responses" style="padding: 4px 12px; font-size: 11px;">OpenAI</button>
               <button type="button" class="action-btn outline small preset-btn" data-id="anthropic" data-mode="anthropic_messages" data-url="https://api.anthropic.com/v1/messages" style="padding: 4px 12px; font-size: 11px;">Anthropic</button>
               <button type="button" class="action-btn outline small preset-btn" data-id="google_gemini" data-mode="gemini_generate_content" data-url="https://generativelanguage.googleapis.com" style="padding: 4px 12px; font-size: 11px;">Gemini</button>
               <button type="button" class="action-btn outline small preset-btn" data-id="deepseek" data-mode="chat" data-url="https://api.deepseek.com/chat/completions" style="padding: 4px 12px; font-size: 11px;">DeepSeek</button>
               <button type="button" class="action-btn outline small preset-btn" data-id="groq" data-mode="responses" data-url="https://api.groq.com/openai/v1/responses" style="padding: 4px 12px; font-size: 11px;">Groq</button>
               <button type="button" class="action-btn outline small preset-btn" data-id="ollama" data-mode="responses" data-url="http://localhost:11434/v1/responses" style="padding: 4px 12px; font-size: 11px;">Ollama (Local)</button>
               <button type="button" class="action-btn outline small preset-btn" data-id="localai" data-mode="responses" data-url="http://localhost:8080/v1/responses" style="padding: 4px 12px; font-size: 11px;">LocalAI (Local)</button>
               <button type="button" class="action-btn outline small preset-btn" data-id="openrouter" data-mode="chat" data-url="https://openrouter.ai/api/v1/chat/completions" style="padding: 4px 12px; font-size: 11px;">OpenRouter</button>
            </div>
          </div>
          <form id="provider-form" style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 32px; padding-bottom: 32px; border-bottom: 1px solid var(--card-border);">
             <div style="display: flex; flex-wrap: wrap; gap: 16px;">
                <div style="flex: 1; min-width: 200px;">
                    <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Provider ID</label>
                    <input type="text" id="prov-id" placeholder="openai" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 6px;" />
                </div>
                <div style="flex: 1; min-width: 150px;">
                    <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Endpoint Mode</label>
                    <select id="prov-mode" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 6px;">
                      <option value="responses" style="color: #000">OpenAI Responses API (Modern/Reasoning)</option>
                      <option value="chat" style="color: #000">OpenAI Chat Completions (Standard)</option>
                      <option value="anthropic_messages" style="color: #000">Anthropic Messages</option>
                      <option value="gemini_generate_content" style="color: #000">Gemini Generate Content</option>
                    </select>
                </div>
             </div>
             <div style="display: flex; flex-wrap: wrap; gap: 16px;">
                <div style="flex: 2; min-width: 300px;">
                    <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Base URL / Endpoint Target</label>
                    <input type="text" id="prov-url" placeholder="https://api.openai.com/v1/responses" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 6px;" />
                </div>
                <div style="flex: 1; min-width: 200px;">
                    <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">API Key</label>
                    <input type="password" id="prov-key" placeholder="sk-..." style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 6px;" />
                </div>
             </div>
             <div style="display: flex; gap: 12px; align-items: center; justify-content: flex-end;">
                <button type="submit" class="action-btn">Store Provider Configuration</button>
             </div>
          </form>
          <div id="provider-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
            ${providers.map(p => `
               <div class="glass-box">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong style="color: var(--accent-color); font-size: 15px;">${p.resourceId}</strong>
                    <span style="font-size: 10px; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; color: var(--text-muted);">${p.config?.endpointMode}</span>
                  </div>
                  <div style="font-size: 12px; color: var(--text-muted); margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.config?.baseUrl || 'No base URL'}</div>
               </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- PROFILES TAB -->
      <div id="section-profiles" class="config-section fade-in" style="display: none;">
        <div class="card" style="display: flex; flex-direction: column;">
          <h3 class="card-title" style="color: #fff; font-size: 16px; margin-bottom: 24px;">Agent Profiles</h3>
          <form id="profile-form" style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 32px; padding-bottom: 32px; border-bottom: 1px solid var(--card-border);">
             <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                 <div style="flex: 1; min-width: 200px;">
                    <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Profile ID (e.g. primary)</label>
                    <input type="text" id="prof-id" placeholder="primary" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px; border-radius: 6px;" />
                 </div>
                 <div style="flex: 1; min-width: 200px;">
                    <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Linked Provider ID</label>
                    <input type="text" id="prof-provider" placeholder="openai" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px; border-radius: 6px;" />
                 </div>
                 <div style="flex: 1; min-width: 200px;">
                    <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Model Name</label>
                    <input type="text" id="prof-model" placeholder="gpt-5-mini" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px; border-radius: 6px;" />
                 </div>
             </div>
             <div>
                <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">System Prompt</label>
                <textarea id="prof-prompt" rows="3" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px; border-radius: 6px; font-family:var(--font-family); margin-top: 4px; resize: vertical;"></textarea>
             </div>
             <div style="align-self: flex-end;">
                <button type="submit" class="action-btn outline">Save Profile</button>
             </div>
          </form>
          <div id="profile-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
            ${profiles.map(p => `
               <div class="glass-box">
                  <strong style="color: var(--secondary-glow)">${p.resourceId}</strong>
                  <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Provider: ${p.config?.providerId} | Model: ${p.config?.model}</div>
               </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- PERSONALITY TAB -->
      <div id="section-personality" class="config-section fade-in" style="display: none;">
        <div class="card" style="display: flex; flex-direction: column; gap: 24px;">
          <h3 class="card-title" style="color: #fff; font-size: 16px;">Personality Profiles</h3>
          <div class="glass-box" style="display: flex; flex-direction: column; gap: 12px;">
            <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Global Personality (Operator)</label>
            <textarea id="personality-global-prompt" rows="5" maxlength="2000" placeholder="Neutral by default..." style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 6px; font-family: var(--font-family); resize: vertical;">${globalPersonalityPrompt}</textarea>
            <div style="display:flex; gap:8px; justify-content:flex-end;">
              <button id="personality-global-reset" class="action-btn outline" type="button">Reset Global</button>
              <button id="personality-global-save" class="action-btn" type="button">Save Global</button>
            </div>
          </div>
          <div class="glass-box" style="display: flex; flex-direction: column; gap: 12px;">
            <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">User Personality (Operator)</label>
            <input id="personality-user-id" type="text" placeholder="userId" style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 6px;" />
            <textarea id="personality-user-prompt" rows="4" maxlength="2000" placeholder="Write user-scoped style guidance..." style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 6px; font-family: var(--font-family); resize: vertical;"></textarea>
            <div style="display:flex; gap:8px; justify-content:flex-end;">
              <button id="personality-user-load" class="action-btn outline" type="button">Load User</button>
              <button id="personality-user-reset" class="action-btn outline" type="button">Reset User</button>
              <button id="personality-user-save" class="action-btn" type="button">Save User</button>
            </div>
          </div>
          <div class="glass-box" style="display: flex; flex-direction: column; gap: 8px;">
            <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Stored Profiles (latest 50)</div>
            <div id="personality-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px;">
              ${personalityItems.map((item) => `
                <div style="padding: 10px; border-radius: 8px; background: rgba(0,0,0,0.2); border: 1px solid var(--card-border);">
                  <div style="font-size: 12px; color: #fff; font-weight: 600;">${item.scope}</div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${item.userId || 'n/a'} ${item.sessionId ? `| ${item.sessionId}` : ''}</div>
                </div>
              `).join('')}
            </div>
          </div>
          <div id="personality-msg" style="font-size: 13px; min-height: 20px;"></div>
        </div>
      </div>

      <!-- EXTENSIONS TAB -->
      <div id="section-extensions" class="config-section fade-in" style="display: none;">
        <div class="card" style="display: flex; flex-direction: column;">
          <h3 class="card-title" style="color: #fff; font-size: 16px; margin-bottom: 24px;">Extensions (MCP & Skills)</h3>
          <form id="extension-form" style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 32px; padding-bottom: 32px; border-bottom: 1px solid var(--card-border);">
             <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                 <div style="flex: 1; min-width: 200px;">
                    <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Extension ID</label>
                    <input type="text" id="ext-id" placeholder="github-mcp" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px; border-radius: 6px;" />
                 </div>
                 <div style="flex: 1; min-width: 150px;">
                    <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Extension Type</label>
                    <select id="ext-type" style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px; border-radius: 6px;">
                      <option value="mcp" style="color: #000">MCP Server (stdio)</option>
                      <option value="mcp_sse" style="color: #000">MCP Server (HTTP/SSE)</option>
                      <option value="skill" style="color: #000">Polar Skill (Module)</option>
                    </select>
                 </div>
                 <div style="flex: 2; min-width: 200px;">
                    <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Command / URL Target</label>
                    <input type="text" id="ext-command" placeholder="npx -y @... or https://..." style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px; border-radius: 6px;" />
                 </div>
                 <div style="flex: 1; min-width: 200px;" id="ext-token-container">
                    <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Auth Token / API Key (SSE)</label>
                    <input type="password" id="ext-token" placeholder="Bearer ..." style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px; border-radius: 6px;" />
                 </div>
             </div>
             <div style="align-self: flex-end;">
                <button type="submit" class="action-btn outline">Register Extension</button>
             </div>
          </form>
          <div id="extension-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
            ${extensions.map(e => `
               <div class="glass-box">
                  <strong style="color: var(--primary-glow)">${e.resourceId}</strong>
                  <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Type: ${e.config?.type || 'unknown'} | Target: ${e.config?.command || e.config?.target || e.config?.url || 'none'}</div>
               </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- FILES TAB -->
      <div id="section-files" class="config-section fade-in" style="display: none;">
        <div class="card" style="display: flex; flex-direction: column; min-height: 600px;">
          <h3 class="card-title" style="color: #fff; font-size: 16px; margin-bottom: 24px;">Core System File Editor</h3>
          <div style="display:flex; gap: 16px; margin-bottom: 16px;">
             <select id="file-selector" style="background: rgba(0,0,0,0.4); border: 1px solid var(--accent-color); color: #fff; padding: 8px; border-radius: 6px; outline:none; min-width: 200px;">
                <option value="AGENTS.md" style="color:#000;">AGENTS.md</option>
                <option value="docs/README.md" style="color:#000;">docs/README.md</option>
                <option value="docs/ARCHITECTURE.md" style="color:#000;">docs/ARCHITECTURE.md</option>
                <option value="docs/SECURITY.md" style="color:#000;">docs/SECURITY.md</option>
                <option value="docs/DEVELOPMENT.md" style="color:#000;">docs/DEVELOPMENT.md</option>
                <option value="docs/SKILLS.md" style="color:#000;">docs/SKILLS.md</option>
                <option value="docs/AUTOMATIONS.md" style="color:#000;">docs/AUTOMATIONS.md</option>
                <option value="docs/MEMORY_AND_FEEDBACK.md" style="color:#000;">docs/MEMORY_AND_FEEDBACK.md</option>
                <option value="docs/IMPLEMENTATION_LOG.md" style="color:#000;">docs/IMPLEMENTATION_LOG.md</option>
             </select>
             <button id="file-load" class="action-btn outline">Load File</button>
             <button id="file-save" class="action-btn" style="margin-left: auto;">Save Changes</button>
          </div>
          <textarea id="file-editor" style="flex: 1; background: #0a0f1e; border: 1px solid var(--card-border); color: #f8fafc; padding: 16px; font-family: monospace; font-size: 13px; border-radius: 8px; resize: none;"></textarea>
          <div id="file-msg" style="font-size: 13px; margin-top: 8px; min-height: 20px;"></div>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // TABS LOGIC
    const tabs = ['budget', 'providers', 'profiles', 'personality', 'extensions', 'files'];
    tabs.forEach(tab => {
      container.querySelector(`#tab-${tab}`).addEventListener('click', () => {
        tabs.forEach(t => {
          container.querySelector(`#tab-${t}`).classList.add('outline');
          container.querySelector(`#section-${t}`).style.display = 'none';
        });
        container.querySelector(`#tab-${tab}`).classList.remove('outline');
        container.querySelector(`#section-${tab}`).style.display = 'block';
      });
    });

    // BUDGET
    const form = container.querySelector('#budget-form');
    const msg = container.querySelector('#budget-msg');
    const scopeSelect = container.querySelector('#budget-scope');
    const targetContainer = container.querySelector('#budget-target-container');
    const targetInput = container.querySelector('#budget-target');

    scopeSelect.addEventListener('change', () => {
      targetContainer.style.display = scopeSelect.value === 'workspace' ? 'flex' : 'none';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = 'Enforcing...';
      msg.style.color = 'var(--info)';
      try {
        const payload = {
          scope: scopeSelect.value,
          targetId: scopeSelect.value === 'workspace' ? targetInput.value : undefined,
          maxLimitUsd: parseFloat(container.querySelector('#budget-limit').value),
          resetIntervalMs: parseInt(container.querySelector('#budget-reset').value, 10) * 3600000,
          enforceBlocking: container.querySelector('#budget-blocking').checked
        };
        await fetchApi('upsertBudgetPolicy', payload);
        msg.textContent = 'Governance policy aggressively enforced!';
        msg.style.color = 'var(--success)';
      } catch (error) {
        msg.textContent = 'Failed to apply policy: ' + error.message;
        msg.style.color = 'var(--danger)';
      }
    });

    const compactBtn = container.querySelector('#compact-btn');
    const compactMsg = container.querySelector('#compact-msg');
    compactBtn.addEventListener('click', async () => {
      compactBtn.disabled = true;
      compactBtn.textContent = 'Compacting Records...';
      compactMsg.textContent = 'Aggregating sparse vectors via summarization model...';
      compactMsg.style.color = 'var(--info)';
      try {
        const result = await fetchApi('compactMemory', {
          scope: 'global',
          sessionId: 'global', // Using global/global for system-wide compaction
          userId: 'global'
        });
        compactMsg.textContent = `Successfully compacted records! Examined: ${result.examinedCount}, Compacted: ${result.compactedCount}.`;
        compactMsg.style.color = 'var(--success)';
        compactBtn.textContent = 'Initialize Compaction Run';
        compactBtn.disabled = false;
      } catch (error) {
        compactMsg.textContent = 'Failed: ' + error.message;
        compactMsg.style.color = 'var(--danger)';
        compactBtn.disabled = false;
        compactBtn.textContent = 'Initialize Compaction Run';
      }
    });

    // PROVIDERS
    const provId = container.querySelector('#prov-id');
    const provMode = container.querySelector('#prov-mode');
    const provUrl = container.querySelector('#prov-url');
    const provKey = container.querySelector('#prov-key');

    container.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        provId.value = btn.dataset.id;
        provMode.value = btn.dataset.mode;
        provUrl.value = btn.dataset.url;
      });
    });

    container.querySelector('#provider-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = provId.value;
      const mode = provMode.value;
      const url = provUrl.value;
      const key = provKey.value;
      if (!id || !url || !key) return alert("Missing ID, Base URL, or Key");
      await fetchApi('upsertConfig', {
        resourceType: 'provider',
        resourceId: id,
        config: { endpointMode: mode, baseUrl: url, apiKey: key }
      });
      alert('Provider Configuration Locked. Refactor Agent Profiles if model IDs change.');
      location.reload(); // Simple reload to refresh the lists
    });

    // PROFILES
    container.querySelector('#profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = container.querySelector('#prof-id').value;
      const provider = container.querySelector('#prof-provider').value;
      const model = container.querySelector('#prof-model').value;
      const prompt = container.querySelector('#prof-prompt').value;
      if (!id || !provider || !model) return alert("Missing ID, Provider, or Model");
      await fetchApi('upsertConfig', {
        resourceType: 'profile',
        resourceId: id,
        config: { providerId: provider, model: model, system: prompt }
      });

      // Auto global pin if id === 'primary' or the user wants to pin it
      if (id === 'primary') {
        await fetchApi('upsertConfig', {
          resourceType: 'policy',
          resourceId: 'profile-pin:global',
          config: { profileId: 'primary' }
        });
      }
      alert('Profile Upserted Successfully. Refresh page to reflect in list.');
    });

    // PERSONALITY
    const personalityMsg = container.querySelector('#personality-msg');
    const personalityGlobalPrompt = container.querySelector('#personality-global-prompt');
    const personalityUserId = container.querySelector('#personality-user-id');
    const personalityUserPrompt = container.querySelector('#personality-user-prompt');

    const setPersonalityMsg = (text, tone = 'info') => {
      personalityMsg.textContent = text;
      personalityMsg.style.color =
        tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : 'var(--info)';
    };

    container.querySelector('#personality-global-save').addEventListener('click', async () => {
      try {
        await fetchApi('upsertPersonalityProfile', {
          scope: 'global',
          prompt: personalityGlobalPrompt.value,
        });
        setPersonalityMsg('Global personality saved.', 'success');
      } catch (error) {
        setPersonalityMsg(`Failed to save global personality: ${error.message}`, 'danger');
      }
    });

    container.querySelector('#personality-global-reset').addEventListener('click', async () => {
      try {
        await fetchApi('resetPersonalityProfile', { scope: 'global' });
        personalityGlobalPrompt.value = '';
        setPersonalityMsg('Global personality reset.', 'success');
      } catch (error) {
        setPersonalityMsg(`Failed to reset global personality: ${error.message}`, 'danger');
      }
    });

    container.querySelector('#personality-user-load').addEventListener('click', async () => {
      const userId = personalityUserId.value.trim();
      if (!userId) {
        setPersonalityMsg('Enter a userId to load a user personality profile.', 'danger');
        return;
      }
      try {
        const result = await fetchApi('getPersonalityProfile', {
          scope: 'user',
          userId,
        });
        personalityUserPrompt.value =
          result.status === 'found' ? (result.profile.prompt || '') : '';
        setPersonalityMsg(
          result.status === 'found'
            ? `Loaded personality for ${userId}.`
            : `No user personality found for ${userId}.`,
          'success',
        );
      } catch (error) {
        setPersonalityMsg(`Failed to load user personality: ${error.message}`, 'danger');
      }
    });

    container.querySelector('#personality-user-save').addEventListener('click', async () => {
      const userId = personalityUserId.value.trim();
      if (!userId) {
        setPersonalityMsg('Enter a userId before saving.', 'danger');
        return;
      }
      try {
        await fetchApi('upsertPersonalityProfile', {
          scope: 'user',
          userId,
          prompt: personalityUserPrompt.value,
        });
        setPersonalityMsg(`User personality saved for ${userId}.`, 'success');
      } catch (error) {
        setPersonalityMsg(`Failed to save user personality: ${error.message}`, 'danger');
      }
    });

    container.querySelector('#personality-user-reset').addEventListener('click', async () => {
      const userId = personalityUserId.value.trim();
      if (!userId) {
        setPersonalityMsg('Enter a userId before resetting.', 'danger');
        return;
      }
      try {
        await fetchApi('resetPersonalityProfile', {
          scope: 'user',
          userId,
        });
        personalityUserPrompt.value = '';
        setPersonalityMsg(`User personality reset for ${userId}.`, 'success');
      } catch (error) {
        setPersonalityMsg(`Failed to reset user personality: ${error.message}`, 'danger');
      }
    });

    // EXTENSIONS
    const extTypeDropdown = container.querySelector('#ext-type');
    const extTokenContainer = container.querySelector('#ext-token-container');
    extTypeDropdown.addEventListener('change', () => {
      if (extTypeDropdown.value === 'mcp_sse') {
        extTokenContainer.style.display = 'block';
      } else {
        extTokenContainer.style.display = 'none';
      }
    });
    extTypeDropdown.dispatchEvent(new Event('change')); // init state

    container.querySelector('#extension-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = container.querySelector('#ext-id').value;
      const type = container.querySelector('#ext-type').value;
      const command = container.querySelector('#ext-command').value;
      const token = container.querySelector('#ext-token').value;

      if (!id || !command) return alert("Missing ID or Command/Target");

      const config = { type: type, command: command };
      if (type === 'mcp_sse') {
        config.url = command;
        config.authToken = token;
      }

      await fetchApi('upsertConfig', {
        resourceType: 'extension',
        resourceId: id,
        config: config
      });
      alert('Extension Configured Successfully. Refresh page to reflect in list.');
    });

    // FILES
    const fileSelector = container.querySelector('#file-selector');
    const fileEditor = container.querySelector('#file-editor');
    const fileMsg = container.querySelector('#file-msg');

    container.querySelector('#file-load').addEventListener('click', async () => {
      fileEditor.value = 'Loading...';
      fileMsg.textContent = '';
      try {
        const res = await fetchApi('readMD', { filename: fileSelector.value });
        fileEditor.value = res.content || '';
      } catch (err) {
        fileEditor.value = 'Error loading file.';
        fileMsg.textContent = err.message;
      }
    });

    container.querySelector('#file-save').addEventListener('click', async () => {
      fileMsg.textContent = 'Saving...';
      fileMsg.style.color = 'var(--info)';
      try {
        await fetchApi('writeMD', { filename: fileSelector.value, content: fileEditor.value });
        fileMsg.textContent = 'File saved successfully!';
        fileMsg.style.color = 'var(--success)';
      } catch (err) {
        fileMsg.textContent = 'Failed: ' + err.message;
        fileMsg.style.color = 'var(--danger)';
      }
    });

    // initial file load
    container.querySelector('#file-load').click();

  } catch (err) {
    container.innerHTML = `<div class="error-view fade-in">Failed to load Configuration Settings: ${err.message}</div>`;
  }
}
