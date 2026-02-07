import { Component, Show, For, createSignal, createMemo } from "solid-js";
import { Task, TaskMessage, openMultipleFoldersDialog } from "../lib/tauri-api";
import { useSettings, getMainUiModels } from "../stores/settings";
import "./AgentMain.css";

interface AgentMainProps {
  onNewTask: (title: string, description: string, projectPath?: string, browserConsent?: boolean) => void;
  onContinueTask: (message: string, projectPath?: string, browserConsent?: boolean) => void;
  onNewConversation: () => void;
  currentText: string;
  isRunning: boolean;
  activeTask: Task | null;
  messages: TaskMessage[];
}

const AgentMain: Component<AgentMainProps> = (props) => {
  const { isConfigured, toggleSettings, settings, updateSetting, getModelInfo } = useSettings();
  const [input, setInput] = createSignal("");
  const [selectedPaths, setSelectedPaths] = createSignal<string[]>([]);
  const [showPathsPanel, setShowPathsPanel] = createSignal(false);
  const [browserConsent, setBrowserConsent] = createSignal(false);

  const currentModelInfo = createMemo(() => getModelInfo(settings().model));
  const mainUiModels = createMemo(() => getMainUiModels(settings()));

  // Check if we're in an existing conversation
  const isInConversation = () => props.activeTask !== null && props.messages.length > 0;

  const handleAddFolders = async () => {
    const folders = await openMultipleFoldersDialog();
    if (folders.length > 0) {
      // Add new folders (avoid duplicates)
      const existing = selectedPaths();
      const newPaths = folders.filter(f => !existing.includes(f));
      setSelectedPaths([...existing, ...newPaths]);
      setShowPathsPanel(true);
    }
  };

  const handleRemovePath = (path: string) => {
    setSelectedPaths(selectedPaths().filter(p => p !== path));
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const message = input().trim();
    if (!message || props.isRunning) return;

    // Join all selected paths with comma for container copy
    const projectPath = selectedPaths().length > 0 ? selectedPaths().join(",") : undefined;

    if (isInConversation()) {
      // Continue existing conversation
      props.onContinueTask(message, projectPath, browserConsent());
    } else {
      // Create new task
      const firstLine = message.split("\n")[0];
      const title = firstLine.length > 50 ? firstLine.slice(0, 50) + "..." : firstLine;
      props.onNewTask(title, message, projectPath, browserConsent());
    }
    setInput("");
    if (settings().browserRequireConsent) {
      setBrowserConsent(false);
    }
  };

  return (
    <div class="agent-main">
      <Show
        when={isConfigured()}
        fallback={
          <div class="agent-setup">
            <h2>Welcome to Thinqi Cowork</h2>
            <p>Configure your API key to start using the agent</p>
            <button onClick={toggleSettings}>Open Settings</button>
          </div>
        }
      >
        <div class="agent-content">
          {/* Output area */}
          <div class="agent-output">
            <Show
              when={props.activeTask || props.currentText || props.messages.length > 0}
              fallback={
                <div class="empty-state">
                  <h2>Agent Mode</h2>
                  <p>Describe a task and the agent will work through it step by step.</p>
                  <div class="capabilities">
                    <div class="capability">
                      <span class="capability-icon">📁</span>
                      <span>Read, write, and edit files</span>
                    </div>
                    <div class="capability">
                      <span class="capability-icon">🔍</span>
                      <span>Search and explore codebases</span>
                    </div>
                    <div class="capability">
                      <span class="capability-icon">⚡</span>
                      <span>Run commands and scripts</span>
                    </div>
                    <div class="capability">
                      <span class="capability-icon">🐳</span>
                      <span>Execute in Docker containers</span>
                    </div>
                  </div>
                </div>
              }
            >
              {/* Show saved message history */}
              <For each={props.messages}>
                {(message) => (
                  <div class={`message ${message.role}`}>
                    <div class="message-label">
                      {message.role === "user" ? "You" : "Agent"}
                    </div>
                    <div class="message-content">{message.content}</div>
                  </div>
                )}
              </For>

              {/* Show current streaming text (when running a new task) */}
              <Show when={props.currentText && props.isRunning}>
                <div class="message assistant streaming">
                  <div class="message-label">Agent</div>
                  <div class="message-content">{props.currentText}</div>
                </div>
              </Show>
            </Show>
          </div>

          {/* Input area */}
          <div class="agent-input-area">
            <div class="agent-controls">
              <div class="model-control">
                <label for="agent-model">Model</label>
                <select
                  id="agent-model"
                  value={settings().model}
                  onChange={(e) => updateSetting("model", e.currentTarget.value)}
                  disabled={props.isRunning}
                >
                  <Show when={!mainUiModels().some((model) => model.id === settings().model)}>
                    <option value={settings().model}>
                      Custom ({settings().model})
                    </option>
                  </Show>
                  <For each={mainUiModels()}>
                    {(model) => (
                      <option value={model.id}>
                        {model.name} ({model.provider})
                      </option>
                    )}
                  </For>
                </select>
                <Show when={currentModelInfo()?.description}>
                  <span class="hint">{currentModelInfo()?.description}</span>
                </Show>
              </div>
              <Show when={settings().browserEnabled && settings().browserRequireConsent}>
                <label class="toggle-row compact">
                  <input
                    type="checkbox"
                    checked={browserConsent()}
                    onChange={(e) => setBrowserConsent(e.currentTarget.checked)}
                    disabled={props.isRunning}
                  />
                  Allow browser actions for this task
                </label>
              </Show>
            </div>
            {/* Selected paths panel */}
            <Show when={showPathsPanel() && selectedPaths().length > 0}>
              <div class="selected-paths">
                <div class="paths-header">
                  <span class="paths-label">Included Folders ({selectedPaths().length})</span>
                  <button
                    type="button"
                    class="paths-close"
                    onClick={() => setShowPathsPanel(false)}
                    title="Hide paths"
                  >
                    ×
                  </button>
                </div>
                <div class="paths-list">
                  <For each={selectedPaths()}>
                    {(path) => (
                      <div class="path-item">
                        <span class="path-icon">📁</span>
                        <span class="path-text" title={path}>
                          {path.split("/").pop() || path}
                        </span>
                        <button
                          type="button"
                          class="path-remove"
                          onClick={() => handleRemovePath(path)}
                          disabled={props.isRunning}
                          title={`Remove ${path}`}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <form class="agent-form" onSubmit={handleSubmit}>
              <div class="input-row">
                <textarea
                  value={input()}
                  onInput={(e) => setInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  placeholder={isInConversation()
                    ? "Continue the conversation..."
                    : "Describe a task... (e.g., 'Find and fix the authentication bug in auth.ts')"
                  }
                  disabled={props.isRunning}
                  rows={3}
                />
                <div class="input-actions">
                  <button
                    type="button"
                    class={`path-toggle ${selectedPaths().length > 0 ? "active" : ""}`}
                    onClick={handleAddFolders}
                    disabled={props.isRunning}
                    title="Add folders to include"
                  >
                    📁
                    <Show when={selectedPaths().length > 0}>
                      <span class="path-count">{selectedPaths().length}</span>
                    </Show>
                  </button>
                  <Show when={isInConversation()}>
                    <button
                      type="button"
                      class="new-chat-btn ghost"
                      onClick={props.onNewConversation}
                      disabled={props.isRunning}
                      title="Start new conversation"
                    >
                      +
                    </button>
                  </Show>
                  <button type="submit" class="submit-btn" disabled={props.isRunning || !input().trim()}>
                    {props.isRunning ? "Running..." : isInConversation() ? "Send" : "Start Task"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default AgentMain;
