import { useState, useEffect } from 'react';
import { api } from '../api.js';

// Types matching the runtime LLM module
type LLMProvider = 'openrouter' | 'anthropic' | 'ollama' | 'openai' | 'azure-openai' | 'bedrock' | 'mistral';
type ModelTier = 'cheap' | 'fast' | 'writing' | 'reasoning';

interface LLMConfig {
    provider: LLMProvider;
    modelId: string;
    parameters: {
        temperature: number;
        maxTokens?: number | undefined;
        topP?: number | undefined;
    };
    tierModels?: {
        cheap?: string | undefined;
        fast?: string | undefined;
        writing?: string | undefined;
        reasoning?: string | undefined;
    } | undefined;
    hasCredential: boolean;
    providerCredentials: Record<LLMProvider, boolean>;
}

interface ProviderStatus {
    available: boolean;
    hasCredential: boolean;
}

const PROVIDER_INFO: Record<LLMProvider, { name: string; description: string; needsJson?: boolean }> = {
    openrouter: { name: 'OpenRouter', description: 'Access multiple models through one API' },
    openai: { name: 'OpenAI', description: 'GPT-4o, GPT-4o-mini, o1 models' },
    anthropic: { name: 'Anthropic', description: 'Claude 3.5 Sonnet, Opus, Haiku' },
    mistral: { name: 'Mistral AI', description: 'Mistral Large, Small, Codestral' },
    bedrock: { name: 'Amazon Bedrock', description: 'Nova, Claude, Titan on AWS', needsJson: true },
    'azure-openai': { name: 'Azure OpenAI', description: 'Enterprise Azure-hosted models', needsJson: true },
    ollama: { name: 'Ollama', description: 'Local models (Llama, Mistral, etc.)' },
};

const TIER_INFO: Record<ModelTier, { label: string; description: string; icon: string }> = {
    cheap: { label: 'Economy', description: 'Simple tasks (classification, extraction)', icon: '💰' },
    fast: { label: 'Fast', description: 'Quick responses with moderate quality', icon: '⚡' },
    writing: { label: 'Writing', description: 'Content creation (emails, docs, posts)', icon: '✍️' },
    reasoning: { label: 'Reasoning', description: 'Complex analysis and planning', icon: '🧠' },
};

const SUGGESTED_MODELS: Record<LLMProvider, string[]> = {
    openrouter: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'openai/gpt-4o-mini', 'google/gemini-pro-1.5'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'gpt-3.5-turbo'],
    anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    mistral: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    bedrock: ['amazon.nova-pro-v1:0', 'anthropic.claude-3-5-sonnet-20241022-v2:0', 'amazon.nova-lite-v1:0'],
    'azure-openai': ['gpt-4o', 'gpt-4o-mini'],
    ollama: ['llama3.2:3b', 'mistral:7b', 'codellama:7b'],
};

export default function IntelligencePage() {
    const [config, setConfig] = useState<LLMConfig | null>(null);
    const [providerStatuses, setProviderStatuses] = useState<Record<LLMProvider, ProviderStatus> | null>(null);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Form state
    const [selectedProvider, setSelectedProvider] = useState<LLMProvider>('openrouter');
    const [selectedModel, setSelectedModel] = useState('');
    const [temperature, setTemperature] = useState(0.7);
    const [maxTokens, setMaxTokens] = useState<number | undefined>(4096);
    const [tierModels, setTierModels] = useState<Record<ModelTier, string>>({
        cheap: '',
        fast: '',
        writing: '',
        reasoning: '',
    });

    // API Key management
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [savingKey, setSavingKey] = useState(false);
    const [showKeySection, setShowKeySection] = useState<LLMProvider | null>(null);

    // Load configuration
    const loadConfig = async () => {
        try {
            setLoading(true);
            const data = await api.getLLMConfig();
            // Cast provider to LLMProvider type
            const providerValue = data.provider as LLMProvider;
            const configData: LLMConfig = {
                provider: providerValue,
                modelId: data.modelId,
                parameters: data.parameters,
                tierModels: data.tierModels,
                hasCredential: data.hasCredential,
                providerCredentials: data.providerCredentials as Record<LLMProvider, boolean>,
            };
            setConfig(configData);
            setSelectedProvider(providerValue);
            setSelectedModel(data.modelId);
            setTemperature(data.parameters.temperature);
            setMaxTokens(data.parameters.maxTokens);
            if (data.tierModels) {
                setTierModels({
                    cheap: data.tierModels.cheap ?? '',
                    fast: data.tierModels.fast ?? '',
                    writing: data.tierModels.writing ?? '',
                    reasoning: data.tierModels.reasoning ?? '',
                });
            }
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    // Load provider statuses
    const loadStatuses = async () => {
        try {
            const statuses = await api.getLLMProviderStatuses();
            setProviderStatuses(statuses);
        } catch (err) {
            console.error('Failed to load provider statuses:', err);
        }
    };

    // Load available models when provider changes
    const loadModels = async (provider: LLMProvider) => {
        try {
            const models = await api.getLLMModels(provider);
            setAvailableModels(models.length > 0 ? models : SUGGESTED_MODELS[provider]);
        } catch {
            setAvailableModels(SUGGESTED_MODELS[provider]);
        }
    };

    useEffect(() => {
        loadConfig();
        loadStatuses();
    }, []);

    useEffect(() => {
        loadModels(selectedProvider);
    }, [selectedProvider]);

    // Save configuration
    const handleSaveConfig = async () => {
        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            // Build update payload without undefined values
            const tierModelsPayload: { cheap?: string; fast?: string; writing?: string; reasoning?: string } = {};
            if (tierModels.cheap) tierModelsPayload.cheap = tierModels.cheap;
            if (tierModels.fast) tierModelsPayload.fast = tierModels.fast;
            if (tierModels.writing) tierModelsPayload.writing = tierModels.writing;
            if (tierModels.reasoning) tierModelsPayload.reasoning = tierModels.reasoning;

            const parametersPayload: { temperature?: number; maxTokens?: number } = { temperature };
            if (maxTokens !== undefined) parametersPayload.maxTokens = maxTokens;

            await api.updateLLMConfig({
                provider: selectedProvider,
                modelId: selectedModel,
                parameters: parametersPayload,
                tierModels: Object.keys(tierModelsPayload).length > 0 ? tierModelsPayload : undefined,
            });
            setSuccess('Configuration saved successfully!');
            loadConfig();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    };

    // Save API key
    const handleSaveApiKey = async (provider: LLMProvider) => {
        if (!apiKeyInput.trim()) return;

        setSavingKey(true);
        setError(null);

        try {
            await api.setLLMCredential(provider, apiKeyInput);
            setApiKeyInput('');
            setShowKeySection(null);
            setSuccess(`API key for ${PROVIDER_INFO[provider].name} saved!`);
            loadStatuses();
            loadConfig();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSavingKey(false);
        }
    };

    // Delete API key
    const handleDeleteApiKey = async (provider: LLMProvider) => {
        if (!confirm(`Remove API key for ${PROVIDER_INFO[provider].name}?`)) return;

        try {
            await api.deleteLLMCredential(provider);
            setSuccess(`API key for ${PROVIDER_INFO[provider].name} removed.`);
            loadStatuses();
            loadConfig();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError((err as Error).message);
        }
    };

    if (loading) {
        return (
            <div className="page">
                <div className="loading-state">Loading LLM configuration...</div>
            </div>
        );
    }

    return (
        <div className="page intelligence-page">
            <header className="page-header">
                <h2>🧠 Intelligence Settings</h2>
                <p>Configure AI providers, models, and tier assignments for optimal performance and cost.</p>
            </header>

            {error && <div className="error-banner">{error}</div>}
            {success && <div className="success-banner">{success}</div>}

            {/* Status Overview */}
            <div className="card status-card">
                <h3>Provider Status</h3>
                <div className="provider-status-grid">
                    {(Object.keys(PROVIDER_INFO) as LLMProvider[]).map(provider => {
                        const status = providerStatuses?.[provider];
                        const info = PROVIDER_INFO[provider];
                        const isActive = config?.provider === provider;

                        return (
                            <div
                                key={provider}
                                className={`provider-status-item ${isActive ? 'active' : ''} ${status?.available ? 'available' : ''}`}
                            >
                                <div className="provider-status-header">
                                    <span className="provider-name">{info.name}</span>
                                    {isActive && <span className="badge primary">Active</span>}
                                </div>
                                <p className="provider-desc">{info.description}</p>
                                <div className="provider-status-footer">
                                    {status?.hasCredential ? (
                                        <span className="status-indicator configured">
                                            ✓ Configured
                                        </span>
                                    ) : (
                                        <span className="status-indicator not-configured">
                                            ○ No API Key
                                        </span>
                                    )}
                                    {status?.hasCredential ? (
                                        <div className="key-actions">
                                            <button
                                                className="btn-small"
                                                onClick={() => setShowKeySection(showKeySection === provider ? null : provider)}
                                            >
                                                Update Key
                                            </button>
                                            <button
                                                className="btn-small danger"
                                                onClick={() => handleDeleteApiKey(provider)}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            className="btn-small primary"
                                            onClick={() => setShowKeySection(showKeySection === provider ? null : provider)}
                                        >
                                            Add Key
                                        </button>
                                    )}
                                </div>

                                {showKeySection === provider && (
                                    <div className="api-key-input-section">
                                        {info.needsJson ? (
                                            <textarea
                                                placeholder={provider === 'bedrock'
                                                    ? '{"accessKeyId": "...", "secretAccessKey": "...", "region": "us-east-1"}'
                                                    : '{"endpoint": "https://...", "apiKey": "...", "apiVersion": "2024-02-15-preview"}'
                                                }
                                                value={apiKeyInput}
                                                onChange={(e) => setApiKeyInput(e.target.value)}
                                                rows={4}
                                            />
                                        ) : (
                                            <input
                                                type="password"
                                                placeholder={provider === 'ollama' ? 'Base URL (e.g., http://localhost:11434)' : 'API Key'}
                                                value={apiKeyInput}
                                                onChange={(e) => setApiKeyInput(e.target.value)}
                                            />
                                        )}
                                        <div className="key-input-actions">
                                            <button
                                                className="btn-small primary"
                                                onClick={() => handleSaveApiKey(provider)}
                                                disabled={savingKey || !apiKeyInput.trim()}
                                            >
                                                {savingKey ? 'Saving...' : 'Save'}
                                            </button>
                                            <button
                                                className="btn-small"
                                                onClick={() => { setShowKeySection(null); setApiKeyInput(''); }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Primary Model Configuration */}
            <div className="card config-card">
                <h3>Primary Model</h3>
                <p className="card-description">The main model used for orchestration and complex tasks.</p>

                <div className="config-form">
                    <div className="form-group">
                        <label>Provider</label>
                        <select
                            value={selectedProvider}
                            onChange={(e) => {
                                setSelectedProvider(e.target.value as LLMProvider);
                                setSelectedModel('');
                            }}
                        >
                            {(Object.keys(PROVIDER_INFO) as LLMProvider[]).map(provider => (
                                <option key={provider} value={provider}>
                                    {PROVIDER_INFO[provider].name}
                                    {!config?.providerCredentials[provider] && ' (No API Key)'}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group">
                        <label>Model</label>
                        <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                        >
                            <option value="">Select a model...</option>
                            {availableModels.map(model => (
                                <option key={model} value={model}>{model}</option>
                            ))}
                        </select>
                        <span className="form-hint">
                            {availableModels.length > 0
                                ? 'Models retrieved from provider API'
                                : 'Enter a custom model name or configure API key to fetch available models'}
                        </span>
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label>Temperature</label>
                            <div className="slider-group">
                                <input
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.1"
                                    value={temperature}
                                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                                />
                                <span className="slider-value">{temperature.toFixed(1)}</span>
                            </div>
                            <span className="form-hint">Lower = more focused, Higher = more creative</span>
                        </div>

                        <div className="form-group">
                            <label>Max Tokens</label>
                            <input
                                type="number"
                                value={maxTokens || ''}
                                onChange={(e) => setMaxTokens(e.target.value ? parseInt(e.target.value) : undefined)}
                                placeholder="4096"
                                min="100"
                                max="128000"
                            />
                            <span className="form-hint">Maximum response length</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Model Tiers */}
            <div className="card tiers-card">
                <h3>Model Tiers</h3>
                <p className="card-description">
                    Assign models to tiers for automatic selection. Sub-agents and workers use these tiers to optimize cost and quality.
                    Format: <code>provider:model</code> (e.g., <code>openai:gpt-4o-mini</code>)
                </p>

                <div className="tiers-grid">
                    {(Object.keys(TIER_INFO) as ModelTier[]).map(tier => (
                        <div key={tier} className="tier-config">
                            <div className="tier-header">
                                <span className="tier-icon">{TIER_INFO[tier].icon}</span>
                                <div className="tier-info">
                                    <span className="tier-label">{TIER_INFO[tier].label}</span>
                                    <span className="tier-desc">{TIER_INFO[tier].description}</span>
                                </div>
                            </div>
                            <input
                                type="text"
                                value={tierModels[tier]}
                                onChange={(e) => setTierModels({ ...tierModels, [tier]: e.target.value })}
                                placeholder={`e.g., ${tier === 'cheap' ? 'openai:gpt-4o-mini' : tier === 'writing' ? 'anthropic:claude-3-5-sonnet' : 'openrouter:anthropic/claude-3-5-sonnet'}`}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Save Button */}
            <div className="save-section">
                <button
                    className="btn-primary btn-large"
                    onClick={handleSaveConfig}
                    disabled={saving || !selectedModel}
                >
                    {saving ? 'Saving...' : 'Save Configuration'}
                </button>
            </div>
        </div>
    );
}
