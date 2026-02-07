import { Component, For, Show, createSignal, createMemo, onMount } from "solid-js";
import {
  AVAILABLE_MODELS,
  PROVIDER_PRESETS,
  ProviderConfig,
  RECOMMENDED_MODEL_STACK,
  AGENTIC_MODEL_STACK,
  type ModelConfig,
} from "../stores/settings";
import "./ModelSelector.css";

// Ollama model info interface
interface OllamaModel {
  name: string;
  size: number;  // bytes
  modified_at: string;
  digest: string;
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Format time
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

// Provider type
type ProviderType = "cloud" | "ollama" | "custom";

// Ollama service status
type OllamaStatus = "checking" | "running" | "not-running";

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string, baseUrl?: string) => void;
}

const ModelSelector: Component<ModelSelectorProps> = (props) => {
  // Determine current model's provider type
  const getCurrentProviderType = (): ProviderType => {
    const model = AVAILABLE_MODELS.find(m => m.id === props.value);
    if (!model) {
      // Check if it's an Ollama model (non-preset)
      if (props.value && !props.value.includes("/")) {
        return "ollama";
      }
      return "cloud";
    }
    if (model.provider === "ollama") return "ollama";
    if (model.provider === "custom") return "custom";
    return "cloud";
  };

  const [providerType, setProviderType] = createSignal<ProviderType>(getCurrentProviderType());
  const [ollamaStatus, setOllamaStatus] = createSignal<OllamaStatus>("checking");
  const [ollamaModels, setOllamaModels] = createSignal<OllamaModel[]>([]);
  const [ollamaBaseUrl, _setOllamaBaseUrl] = createSignal("http://localhost:11434");
  const [showOtherModels, setShowOtherModels] = createSignal(false);

  const cloudModels = createMemo(() =>
    AVAILABLE_MODELS.filter((m) => m.provider !== "ollama" && m.provider !== "custom")
  );

  const recommendedModels = createMemo(() =>
    RECOMMENDED_MODEL_STACK
      .map((entry) => ({
        entry,
        model: AVAILABLE_MODELS.find((m) => m.id === entry.id),
      }))
      .filter((item): item is { entry: typeof RECOMMENDED_MODEL_STACK[number]; model: ModelConfig } => !!item.model)
  );

  const agenticModels = createMemo(() =>
    AGENTIC_MODEL_STACK
      .map((entry) => ({
        entry,
        model: AVAILABLE_MODELS.find((m) => m.id === entry.id),
      }))
      .filter((item): item is { entry: typeof AGENTIC_MODEL_STACK[number]; model: ModelConfig } => !!item.model)
  );

  const highlightedIds = createMemo(() => {
    const ids = new Set<string>();
    for (const item of recommendedModels()) {
      ids.add(item.model.id);
    }
    for (const item of agenticModels()) {
      ids.add(item.model.id);
    }
    return ids;
  });

  const otherCloudModels = createMemo(() =>
    cloudModels().filter((model) => !highlightedIds().has(model.id))
  );

  const otherCloudModelsGrouped = createMemo(() => {
    const grouped: Record<string, ModelConfig[]> = {};
    for (const model of otherCloudModels()) {
      if (!grouped[model.provider]) {
        grouped[model.provider] = [];
      }
      grouped[model.provider].push(model);
    }
    return Object.entries(grouped)
      .map(([provider, models]) => ({
        provider,
        providerName: PROVIDER_PRESETS[provider]?.name || provider,
        models,
      }))
      .sort((a, b) => a.providerName.localeCompare(b.providerName));
  });

  // Check Ollama service status and get model list
  const checkOllamaStatus = async () => {
    setOllamaStatus("checking");
    try {
      const baseUrl = ollamaBaseUrl().replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        const models = data.models || [];
        setOllamaModels(models);
        setOllamaStatus("running");
      } else {
        setOllamaStatus("not-running");
        setOllamaModels([]);
      }
    } catch {
      setOllamaStatus("not-running");
      setOllamaModels([]);
    }
  };

  // Check Ollama status on mount
  onMount(() => {
    checkOllamaStatus();
  });

  // Currently selected Ollama model
  const selectedOllamaModel = createMemo(() => {
    return ollamaModels().find(m => m.name === props.value);
  });

  // Handle model selection
  const handleCloudModelChange = (modelId: string) => {
    const model = AVAILABLE_MODELS.find(m => m.id === modelId);
    if (model) {
      props.onChange(modelId, model.baseUrl);
    }
  };

  const handleOllamaModelSelect = (modelName: string) => {
    props.onChange(modelName, ollamaBaseUrl());
  };

  // Get current provider info
  const currentProviderInfo = createMemo((): ProviderConfig | null => {
    const model = AVAILABLE_MODELS.find(m => m.id === props.value);
    if (!model) return null;
    return PROVIDER_PRESETS[model.provider] || null;
  });

  return (
    <div class="model-selector">
      {/* Provider type tabs */}
      <div class="provider-tabs">
        <button
          class={`provider-tab ${providerType() === "cloud" ? "active" : ""}`}
          onClick={() => setProviderType("cloud")}
        >
          <span class="tab-icon">☁️</span>
          <span class="tab-label">Cloud</span>
        </button>
        <button
          class={`provider-tab ${providerType() === "ollama" ? "active" : ""}`}
          onClick={() => {
            setProviderType("ollama");
            checkOllamaStatus();
          }}
        >
          <span class="tab-icon">🦙</span>
          <span class="tab-label">Ollama</span>
        </button>
        <button
          class={`provider-tab ${providerType() === "custom" ? "active" : ""}`}
          onClick={() => setProviderType("custom")}
        >
          <span class="tab-icon">⚙️</span>
          <span class="tab-label">Custom</span>
        </button>
      </div>

      {/* Cloud service selection */}
      <Show when={providerType() === "cloud"}>
        <div class="cloud-selector">
          <div class="stack-section">
            <div class="stack-title">Recommended models</div>
            <div class="stack-subtitle">
              Primary picks for day-to-day use.
            </div>
            <div class="stack-grid">
              <For each={recommendedModels()}>
                {({ entry, model }) => (
                  <button
                    type="button"
                    class={`stack-item ${props.value === model.id ? "selected" : ""}`}
                    onClick={() => handleCloudModelChange(model.id)}
                  >
                    <span class="stack-name">{entry.label}</span>
                    <span class="stack-reason">{entry.reason}</span>
                    <span class="stack-provider">{PROVIDER_PRESETS[model.provider]?.name || model.provider}</span>
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="stack-section">
            <div class="stack-title">Agentic models</div>
            <div class="stack-subtitle">
              Best options for tool use and autonomous browser/code flows.
            </div>
            <div class="stack-grid">
              <For each={agenticModels()}>
                {({ entry, model }) => (
                  <button
                    type="button"
                    class={`stack-item ${props.value === model.id ? "selected" : ""}`}
                    onClick={() => handleCloudModelChange(model.id)}
                  >
                    <span class="stack-name">{entry.label}</span>
                    <span class="stack-reason">{entry.reason}</span>
                    <span class="stack-provider">{PROVIDER_PRESETS[model.provider]?.name || model.provider}</span>
                  </button>
                )}
              </For>
            </div>
          </div>

          <button
            type="button"
            class="other-models-toggle"
            onClick={() => setShowOtherModels(!showOtherModels())}
          >
            {showOtherModels() ? "Hide other models" : "Show other models"}
          </button>

          <Show when={showOtherModels()}>
            <select
              value={props.value}
              onChange={(e) => handleCloudModelChange(e.currentTarget.value)}
            >
              <For each={otherCloudModelsGrouped()}>
                {(group) => (
                  <optgroup label={group.providerName}>
                    <For each={group.models}>
                      {(model) => (
                        <option value={model.id}>
                          {model.name} - {model.description}
                        </option>
                      )}
                    </For>
                  </optgroup>
                )}
              </For>
            </select>
            <span class="other-models-hint">
              Need a model not listed here? Use Custom and enter the model ID directly.
            </span>
          </Show>

          <Show when={!cloudModels().some((m) => m.id === props.value) && props.value}>
            <div class="selected-info">
              <span class="info-badge">Custom</span>
              <span class="info-desc">{props.value}</span>
            </div>
          </Show>

          <Show when={currentProviderInfo()}>
            <div class="selected-info">
              <span class="info-badge">{currentProviderInfo()?.name}</span>
              <span class="info-desc">{currentProviderInfo()?.description}</span>
            </div>
          </Show>
        </div>
      </Show>

      {/* Ollama model selection */}
      <Show when={providerType() === "ollama"}>
        <div class="ollama-section">
          {/* Status indicator */}
          <Show when={ollamaStatus() === "checking"}>
            <div class="ollama-status checking">
              <span class="status-icon">⏳</span>
              <p>Checking Ollama service...</p>
            </div>
          </Show>

          <Show when={ollamaStatus() === "not-running"}>
            <div class="ollama-status not-running">
              <span class="status-icon">⚠️</span>
              <div class="status-content">
                <p><strong>Ollama not running</strong></p>
                <p>Please install and start <a href="https://ollama.ai" target="_blank">Ollama</a></p>
                <button class="retry-btn" onClick={checkOllamaStatus}>
                  Retry
                </button>
              </div>
            </div>
          </Show>

          <Show when={ollamaStatus() === "running"}>
            <div class="ollama-status running">
              <span class="status-icon">✅</span>
              <p>Ollama running · {ollamaModels().length} models</p>
              <button class="refresh-btn" onClick={checkOllamaStatus}>
                Refresh
              </button>
            </div>

            <Show when={ollamaModels().length === 0}>
              <div class="no-models">
                <p>No models installed</p>
                <p class="hint">Run <code>ollama pull llama3.2</code> to install a model</p>
              </div>
            </Show>

            <Show when={ollamaModels().length > 0}>
              <div class="model-list">
                <For each={ollamaModels()}>
                  {(model) => (
                    <div
                      class={`model-item ${selectedOllamaModel()?.name === model.name ? "selected" : ""}`}
                      onClick={() => handleOllamaModelSelect(model.name)}
                    >
                      <div class="model-main">
                        <span class="model-name">{model.name}</span>
                        <span class="model-size">{formatSize(model.size)}</span>
                      </div>
                      <div class="model-meta">
                        <span class="model-time">Updated {formatTime(model.modified_at)}</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          {/* Current selected model */}
          <Show when={selectedOllamaModel()}>
            <div class="selected-model-info">
              <span class="label">Current model:</span>
              <span class="value">{selectedOllamaModel()?.name}</span>
            </div>
          </Show>
        </div>
      </Show>

      {/* Custom service */}
      <Show when={providerType() === "custom"}>
        <div class="custom-section">
          <div class="custom-notice">
            <span class="notice-icon">🔧</span>
            <p>Use OpenAI-compatible API service (vLLM / TGI / SGLang, etc.)</p>
          </div>

          <div class="custom-form">
            <div class="form-group">
              <label>Model ID</label>
              <input
                type="text"
                value={props.value === "custom-model" ? "" : props.value}
                placeholder="e.g., meta-llama/Llama-3.2-8B"
                onInput={(e) => props.onChange(e.currentTarget.value || "custom-model")}
              />
            </div>
            <p class="hint">Configure API URL and key in Settings</p>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default ModelSelector;
