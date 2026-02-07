import { Component, createSignal, createMemo, Show } from "solid-js";
import { useSettings, AVAILABLE_MODELS, PROVIDER_PRESETS, getProviderFromModel, getCheapRouterModels } from "../stores/settings";
import { listExecutionAudit, prepullDockerImages, testConnection, type ExecutionAuditEntry } from "../lib/tauri-api";
import ModelSelector from "./ModelSelector";
import "./Settings.css";

const Settings: Component = () => {
  const { settings, updateSetting, toggleSettings } = useSettings();
  const [testing, setTesting] = createSignal(false);
  const [testResult, setTestResult] = createSignal<string | null>(null);
  const [prepulling, setPrepulling] = createSignal(false);
  const [prepullResult, setPrepullResult] = createSignal<string | null>(null);
  const [auditLoading, setAuditLoading] = createSignal(false);
  const [auditEntries, setAuditEntries] = createSignal<ExecutionAuditEntry[]>([]);
  const [auditFilter, setAuditFilter] = createSignal("");
  const [expandedAuditId, setExpandedAuditId] = createSignal<string | null>(null);


  // Get current selected model's provider info
  const currentProviderInfo = createMemo(() => {
    const model = AVAILABLE_MODELS.find(m => m.id === settings().model);
    if (model) {
      return PROVIDER_PRESETS[model.provider];
    }
    // If not in preset list, check baseUrl to determine provider
    const baseUrl = settings().baseUrl;
    if (baseUrl.includes("localhost:11434") || baseUrl.includes("127.0.0.1:11434")) {
      return PROVIDER_PRESETS["ollama"];
    }
    if (baseUrl.includes("localhost:8080")) {
      return PROVIDER_PRESETS["localai"];
    }
    // Other local services - use custom preset
    if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
      return PROVIDER_PRESETS["custom"];
    }
    return null;
  });

  // Check if it's a true local service (authType === "none", no API Key needed at all)
  const isNoAuthProvider = createMemo(() => {
    const info = currentProviderInfo();
    return info?.authType === "none";
  });

  // Check if API key is optional (custom provider - can work with or without key)
  const isApiKeyOptional = createMemo(() => {
    const providerId = getProviderFromModel(settings().model);
    // Custom provider with localhost URL - API key is optional
    if (providerId === "custom") {
      return true;
    }
    return false;
  });

  const routerProviderId = createMemo(() => getProviderFromModel(settings().model));
  const cheapRouterModels = createMemo(() => getCheapRouterModels(routerProviderId()));
  const hasCustomRouterModel = createMemo(() =>
    !!settings().routerModel && !cheapRouterModels().some((model) => model.id === settings().routerModel)
  );

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      console.log("Testing connection...");
      const result = await testConnection();
      console.log("Test result:", result, typeof result);
      setTestResult(result);
    } catch (e) {
      console.error("Test connection error:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      setTestResult(`Error: ${errorMsg}`);
    }
    setTesting(false);
  };

  const handlePrepull = async () => {
    setPrepulling(true);
    setPrepullResult(null);
    try {
      const result = await prepullDockerImages();
      setPrepullResult(result);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setPrepullResult(`Error: ${errorMsg}`);
    }
    setPrepulling(false);
  };

  const handleLoadAudit = async () => {
    setAuditLoading(true);
    try {
      const entries = await listExecutionAudit(100);
      setAuditEntries(entries);
    } catch (e) {
      console.error("Failed to load execution audit:", e);
      setAuditEntries([]);
    }
    setAuditLoading(false);
  };

  const filteredAuditEntries = createMemo(() => {
    const filter = auditFilter().trim().toLowerCase();
    if (!filter) return auditEntries();
    return auditEntries().filter((entry) =>
      entry.tool_name.toLowerCase().includes(filter) ||
      entry.result.toLowerCase().includes(filter) ||
      entry.input.toLowerCase().includes(filter)
    );
  });

  const handleExportAudit = () => {
    const data = JSON.stringify(auditEntries(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "execution-audit.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleAuditEntry = (id: string) => {
    setExpandedAuditId((prev) => (prev === id ? null : id));
  };

  const formatAuditBody = (value: string) => {
    if (!value) return "—";
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  };

  const previewAuditBody = (value: string) => {
    if (!value) return "—";
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized;
  };

  // const handleSave = async () => {
  //   setSaving(true);
  //   await saveAllSettings(settings());
  //   setSaving(false);
  // };

  return (
    <div class="settings">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-btn" onClick={toggleSettings}>
          Close
        </button>
      </div>

      <div class="settings-content">
        <div class="settings-section">
          <h3>Model Selection</h3>

          <ModelSelector
            value={settings().model}
            onChange={(modelId, baseUrl) => {
              updateSetting("model", modelId);
              if (baseUrl) {
                updateSetting("baseUrl", baseUrl);
              }
            }}
          />

          <div class="form-group" style={{ "margin-top": "1rem" }}>
            <label for="routerModel">
              Router model (cheap)
              <span class="optional-tag">(Optional)</span>
            </label>
            <select
              id="routerModel"
              value={settings().routerModel}
              onChange={(e) => updateSetting("routerModel", e.currentTarget.value)}
            >
              <option value="">Disabled (always use planning prompt)</option>
              {cheapRouterModels().map((model) => (
                <option value={model.id}>{model.name}</option>
              ))}
              <Show when={hasCustomRouterModel()}>
                <option value={settings().routerModel}>Custom ({settings().routerModel})</option>
              </Show>
            </select>
            <span class="hint">
              Router uses the same provider as your selected model ({PROVIDER_PRESETS[routerProviderId()]?.name || routerProviderId()}).
              Pick a cheap model for classification, or disable routing to always use the planning prompt.
            </span>
          </div>
        </div>

        <div class="settings-section">
          <h3>API Configuration</h3>

          {/* Local service notice - only for providers that truly don't need auth */}
          <Show when={isNoAuthProvider()}>
            <div class="local-service-notice">
              <span class="notice-icon">🏠</span>
              <div class="notice-content">
                <strong>Local Service - No API Key Required</strong>
                <p>Please ensure {currentProviderInfo()?.name} is running locally</p>
              </div>
            </div>
          </Show>

          {/* API Key input - show for all providers except those with authType === "none" */}
          <Show when={!isNoAuthProvider()}>
            <div class="form-group">
              <label for="apiKey">
                API Key
                <Show when={isApiKeyOptional()}>
                  <span class="optional-tag">(Optional)</span>
                </Show>
              </label>
              <input
                id="apiKey"
                type="password"
                value={settings().apiKey}
                onInput={(e) => updateSetting("apiKey", e.currentTarget.value)}
                placeholder={currentProviderInfo()?.authType === "bearer" ? "sk-..." : "your-api-key"}
              />
              <span class="hint">
                <Show
                  when={currentProviderInfo()?.id === "anthropic"}
                  fallback={
                    <Show
                      when={isApiKeyOptional()}
                      fallback={<>Get API Key from {currentProviderInfo()?.name}</>}
                    >
                      API key is optional for custom endpoints
                    </Show>
                  }
                >
                  Get your API key from{" "}
                  <a href="https://console.anthropic.com/settings/keys" target="_blank">
                    Anthropic Console
                  </a>
                </Show>
              </span>
            </div>
          </Show>

          <div class="form-group">
            <label for="baseUrl">API Base URL</label>
            <input
              id="baseUrl"
              type="text"
              value={settings().baseUrl}
              onInput={(e) => updateSetting("baseUrl", e.currentTarget.value)}
              placeholder={currentProviderInfo()?.baseUrl || "https://api.example.com"}
            />
            <span class="hint">
              {isNoAuthProvider()
                ? "Ensure the address matches your local service configuration"
                : "Customize proxy or compatible API address"}
            </span>
          </div>

          {/* OpenAI Organization and Project ID - only show for OpenAI provider */}
          <Show when={currentProviderInfo()?.id === "openai"}>
            <div class="form-group">
              <label for="openaiOrg">
                Organization ID
                <span class="optional-tag">(Optional)</span>
              </label>
              <input
                id="openaiOrg"
                type="text"
                value={settings().openaiOrganization || ""}
                onInput={(e) => updateSetting("openaiOrganization", e.currentTarget.value || undefined)}
                placeholder="org-..."
              />
              <span class="hint">
                Your OpenAI organization ID (if you belong to multiple organizations)
              </span>
            </div>

            <div class="form-group">
              <label for="openaiProject">
                Project ID
                <span class="optional-tag">(Optional)</span>
              </label>
              <input
                id="openaiProject"
                type="text"
                value={settings().openaiProject || ""}
                onInput={(e) => updateSetting("openaiProject", e.currentTarget.value || undefined)}
                placeholder="proj_..."
              />
              <span class="hint">
                Your OpenAI project ID (for project-level access control)
              </span>
            </div>
          </Show>

          <div class="form-group">
            <label for="maxTokens">Max Tokens</label>
            <input
              id="maxTokens"
              type="number"
              value={settings().maxTokens}
              onInput={(e) =>
                updateSetting("maxTokens", parseInt(e.currentTarget.value) || 4096)
              }
              min={1}
              max={200000}
            />
          </div>

          <div class="form-group">
            <button
              class="test-btn"
              onClick={handleTest}
              disabled={testing() || (!isNoAuthProvider() && !isApiKeyOptional() && !settings().apiKey)}
            >
              {testing() ? "Testing..." : "Test Connection"}
            </button>
            {testResult() === "success" && (
              <span class="test-success">✓ Connection successful!</span>
            )}
            {testResult() && testResult() !== "success" && (
              <span class="test-error">{testResult()}</span>
            )}
          </div>
        </div>

        <div class="settings-section">
          <h3>Execution</h3>

          <div class="form-group">
            <label for="executionBackend">Execution Backend</label>
            <select
              id="executionBackend"
              value={settings().executionBackend}
              onChange={(e) => {
                const value = e.currentTarget.value;
                updateSetting("executionBackend", value);
                if (value === "none") {
                  updateSetting("containerEnabled", false);
                }
              }}
            >
              <option value="none">None (disable containers)</option>
              <option value="docker">Docker</option>
            </select>
            <span class="hint">
              Docker is the only supported backend. Select None to disable containers.
            </span>
          </div>

          <div class="form-group">
            <label class="toggle-row">
              <input
                type="checkbox"
                checked={settings().containerEnabled}
                onChange={(e) => {
                  const next = e.currentTarget.checked;
                  const wasEnabled = settings().containerEnabled;
                  updateSetting("containerEnabled", next);
                  if (
                    next &&
                    !wasEnabled &&
                    settings().containerPrepullOnEnable &&
                    settings().executionBackend === "docker"
                  ) {
                    void handlePrepull();
                  }
                }}
                disabled={settings().executionBackend === "none"}
              />
              Enable container tools
            </label>
            <span class="hint">
              Opt-in. When disabled, container tools are unavailable to the agent.
            </span>
          </div>

          <Show when={settings().containerEnabled}>
            <div class="form-group">
              <label for="containerCpuCores">Container CPU Cores</label>
              <input
                id="containerCpuCores"
                type="number"
                min={0.1}
                step={0.1}
                value={settings().containerCpuCores}
                onInput={(e) =>
                  updateSetting("containerCpuCores", parseFloat(e.currentTarget.value) || 2)
                }
              />
              <span class="hint">Limits CPU cores available to container runs.</span>
            </div>

            <div class="form-group">
              <label for="containerMemoryMb">Container Memory (MB)</label>
              <input
                id="containerMemoryMb"
                type="number"
                min={256}
                step={128}
                value={settings().containerMemoryMb}
                onInput={(e) =>
                  updateSetting("containerMemoryMb", parseInt(e.currentTarget.value) || 2048)
                }
              />
              <span class="hint">Caps memory usage for container runs.</span>
            </div>

            <div class="form-group">
              <label for="containerTimeoutSecs">Container Timeout (seconds)</label>
              <input
                id="containerTimeoutSecs"
                type="number"
                min={30}
                step={10}
                value={settings().containerTimeoutSecs}
                onInput={(e) =>
                  updateSetting("containerTimeoutSecs", parseInt(e.currentTarget.value) || 300)
                }
              />
              <span class="hint">Hard timeout for container commands.</span>
            </div>

            <div class="form-group">
              <label class="toggle-row">
                <input
                  type="checkbox"
                  checked={settings().containerNetworkEnabled}
                  onChange={(e) => updateSetting("containerNetworkEnabled", e.currentTarget.checked)}
                />
                Allow container network access
              </label>
              <span class="hint">Disable to run containers without network access.</span>
            </div>

            <div class="form-group">
              <label class="toggle-row">
                <input
                  type="checkbox"
                  checked={settings().containerPrepullOnEnable}
                  onChange={(e) => updateSetting("containerPrepullOnEnable", e.currentTarget.checked)}
                />
                Pre-pull default images on enable
              </label>
              <span class="hint">Helps avoid first-run delays for common tasks.</span>
            </div>

            <div class="form-group">
              <button
                class="test-btn"
                onClick={handlePrepull}
                disabled={prepulling() || settings().executionBackend !== "docker"}
              >
                {prepulling() ? "Pulling..." : "Pre-pull default images"}
              </button>
              <Show when={prepullResult()}>
                <span class={prepullResult()?.startsWith("Error:") ? "test-error" : "test-success"}>
                  {prepullResult()}
                </span>
              </Show>
            </div>
          </Show>

        </div>

        <div class="settings-section">
          <h3>Browser Automation</h3>

          <div class="form-group">
            <label class="toggle-row">
              <input
                type="checkbox"
                checked={settings().browserEnabled}
                onChange={(e) => updateSetting("browserEnabled", e.currentTarget.checked)}
              />
              Enable browser automation
            </label>
            <span class="hint">
              Uses a browser-use sidecar with a visible (non-headless) browser.
            </span>
          </div>

          <Show when={settings().browserEnabled}>
            <div class="form-group">
              <label for="browserLlmMode">Browser model mode</label>
              <select
                id="browserLlmMode"
                value={settings().browserLlmMode}
                onChange={(e) => updateSetting("browserLlmMode", e.currentTarget.value)}
              >
                <option value="inherit">Inherit app model/provider</option>
                <option value="custom">Custom browser model/provider</option>
              </select>
              <span class="hint">
                Use custom mode if you want browser automation to run on a different model than chat.
              </span>
            </div>

            <Show when={settings().browserLlmMode === "custom"}>
              <div class="form-group">
                <label for="browserLlmProvider">Browser provider</label>
                <select
                  id="browserLlmProvider"
                  value={settings().browserLlmProvider}
                  onChange={(e) => updateSetting("browserLlmProvider", e.currentTarget.value)}
                >
                  <option value="openai">OpenAI-compatible</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google</option>
                  <option value="browser_use">Browser Use</option>
                </select>
              </div>

              <div class="form-group">
                <label for="browserLlmModel">Browser model ID</label>
                <input
                  id="browserLlmModel"
                  type="text"
                  value={settings().browserLlmModel}
                  onInput={(e) => updateSetting("browserLlmModel", e.currentTarget.value)}
                  placeholder="gpt-4.1-mini"
                />
                <span class="hint">
                  Use a model that is supported by the selected provider endpoint.
                </span>
              </div>

              <div class="form-group">
                <label for="browserLlmApiKey">
                  Browser API key
                  <span class="optional-tag">(Optional)</span>
                </label>
                <input
                  id="browserLlmApiKey"
                  type="password"
                  value={settings().browserLlmApiKey}
                  onInput={(e) => updateSetting("browserLlmApiKey", e.currentTarget.value)}
                  placeholder="Leave empty to reuse provider key"
                />
              </div>

              <div class="form-group">
                <label for="browserLlmBaseUrl">
                  Browser API base URL
                  <span class="optional-tag">(Optional)</span>
                </label>
                <input
                  id="browserLlmBaseUrl"
                  type="text"
                  value={settings().browserLlmBaseUrl}
                  onInput={(e) => updateSetting("browserLlmBaseUrl", e.currentTarget.value)}
                  placeholder="Leave empty to use provider default"
                />
              </div>
            </Show>

            <div class="form-group">
              <label class="toggle-row">
                <input
                  type="checkbox"
                  checked={settings().browserRequireConsent}
                  onChange={(e) => updateSetting("browserRequireConsent", e.currentTarget.checked)}
                />
                Require browser session consent
              </label>
              <span class="hint">
                When enabled, consent is captured once at browser-session start and reused until the session closes.
              </span>
            </div>

            <div class="form-group">
              <label for="browserAllowlist">
                Allowed domains
                <span class="optional-tag">(Optional)</span>
              </label>
              <textarea
                id="browserAllowlist"
                rows={3}
                value={settings().browserAllowedDomains}
                onInput={(e) => updateSetting("browserAllowedDomains", e.currentTarget.value)}
                placeholder="example.com\napp.example.com"
              />
              <span class="hint">Comma or newline separated. Leave empty to allow all.</span>
            </div>

            <div class="form-group">
              <label for="browserBlocklist">
                Blocked domains
                <span class="optional-tag">(Optional)</span>
              </label>
              <textarea
                id="browserBlocklist"
                rows={3}
                value={settings().browserBlockedDomains}
                onInput={(e) => updateSetting("browserBlockedDomains", e.currentTarget.value)}
                placeholder="sensitive.example.com"
              />
              <span class="hint">Blocks matching domains and subdomains.</span>
            </div>
          </Show>
        </div>

        <div class="settings-section">
          <h3>Data Storage</h3>
          <p class="hint" style={{ margin: 0 }}>
            All data is stored locally on your computer in SQLite database.
            <br />
            API key is securely stored and never sent to any server except Anthropic's API.
          </p>
        </div>


        <div class="settings-section">
          <h3>Execution Audit</h3>
          <div class="form-group">
            <button class="test-btn" onClick={handleLoadAudit} disabled={auditLoading()}>
              {auditLoading() ? "Loading..." : "Refresh audit log"}
            </button>
            <button class="test-btn" onClick={handleExportAudit} disabled={!auditEntries().length}>
              Export JSON
            </button>
          </div>
          <div class="audit-controls">
            <input
              type="text"
              placeholder="Filter by tool, input, or result"
              value={auditFilter()}
              onInput={(e) => setAuditFilter(e.currentTarget.value)}
            />
          </div>
          <Show when={filteredAuditEntries().length > 0} fallback={<span class="hint">No entries yet.</span>}>
            <div class="audit-list">
              {filteredAuditEntries().map((entry) => (
                <div
                  class={`audit-item ${expandedAuditId() === entry.id ? "expanded" : ""}`}
                  onClick={() => toggleAuditEntry(entry.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleAuditEntry(entry.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedAuditId() === entry.id}
                >
                  <div class="audit-meta">
                    <span class={entry.success ? "test-success" : "test-error"}>
                      {entry.success ? "✓" : "✕"}
                    </span>
                    <span class="audit-tool">{entry.tool_name}</span>
                    <span class="audit-time">{new Date(entry.timestamp).toLocaleString()}</span>
                    <span class="audit-toggle">
                      {expandedAuditId() === entry.id ? "Hide details" : "View details"}
                    </span>
                  </div>
                  <Show when={expandedAuditId() !== entry.id}>
                    <div class="audit-preview">{previewAuditBody(entry.result)}</div>
                  </Show>
                  <Show when={expandedAuditId() === entry.id}>
                    <div class="audit-label">Input</div>
                    <pre class="audit-body">{formatAuditBody(entry.input)}</pre>
                    <div class="audit-label">Result</div>
                    <pre class="audit-body">{formatAuditBody(entry.result)}</pre>
                  </Show>
                </div>
              ))}
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default Settings;
