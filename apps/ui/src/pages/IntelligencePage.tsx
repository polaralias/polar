import { useEffect, useMemo, useState } from 'react';
import { api, type LLMModelOption } from '../api.js';

type LLMProvider =
    | 'openrouter'
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'minimax'
    | 'mistral'
    | 'bedrock'
    | 'azure-openai'
    | 'together'
    | 'groq'
    | 'deepseek'
    | 'siliconflow'
    | 'ollama'
    | 'lm-studio'
    | 'localai'
    | 'vllm'
    | 'tgi'
    | 'sglang';

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
    providerCredentials: Record<string, boolean>;
}

interface ProviderStatus {
    available: boolean;
    hasCredential: boolean;
}

type CredentialType = 'apiKey' | 'baseUrl' | 'json';

const PROVIDERS: LLMProvider[] = [
    'openrouter',
    'openai',
    'anthropic',
    'gemini',
    'minimax',
    'mistral',
    'bedrock',
    'azure-openai',
    'together',
    'groq',
    'deepseek',
    'siliconflow',
    'ollama',
    'lm-studio',
    'localai',
    'vllm',
    'tgi',
    'sglang',
];

const PROVIDER_INFO: Record<LLMProvider, {
    name: string;
    description: string;
    credentialType: CredentialType;
}> = {
    openrouter: { name: 'OpenRouter', description: 'Multi-model cloud routing', credentialType: 'apiKey' },
    openai: { name: 'OpenAI', description: 'Responses API for GPT-5 and Codex', credentialType: 'apiKey' },
    anthropic: { name: 'Anthropic', description: 'Claude models', credentialType: 'apiKey' },
    gemini: { name: 'Google Gemini', description: 'Gemini 3 and 2.5 families', credentialType: 'apiKey' },
    minimax: { name: 'MiniMax', description: 'MiniMax M2 series', credentialType: 'apiKey' },
    mistral: { name: 'Mistral', description: 'Mistral and Codestral models', credentialType: 'apiKey' },
    bedrock: { name: 'Amazon Bedrock', description: 'AWS-hosted model access', credentialType: 'json' },
    'azure-openai': { name: 'Azure OpenAI', description: 'Azure-hosted OpenAI deployments', credentialType: 'json' },
    together: { name: 'Together AI', description: 'Open-source model cloud', credentialType: 'apiKey' },
    groq: { name: 'Groq', description: 'Low-latency inference cloud', credentialType: 'apiKey' },
    deepseek: { name: 'DeepSeek', description: 'DeepSeek official API', credentialType: 'apiKey' },
    siliconflow: { name: 'SiliconFlow', description: 'Open model inference cloud', credentialType: 'apiKey' },
    ollama: { name: 'Ollama', description: 'Local model runtime', credentialType: 'baseUrl' },
    'lm-studio': { name: 'LM Studio', description: 'Local OpenAI-compatible endpoint', credentialType: 'baseUrl' },
    localai: { name: 'LocalAI', description: 'Local OpenAI-compatible endpoint', credentialType: 'baseUrl' },
    vllm: { name: 'vLLM', description: 'Self-hosted OpenAI-compatible endpoint', credentialType: 'baseUrl' },
    tgi: { name: 'TGI', description: 'Hugging Face Text Generation Inference', credentialType: 'baseUrl' },
    sglang: { name: 'SGLang', description: 'Structured generation endpoint', credentialType: 'baseUrl' },
};

const FALLBACK_MODELS: Record<LLMProvider, string[]> = {
    openrouter: ['anthropic/claude-sonnet-4-5', 'openai/gpt-5.2', 'deepseek/deepseek-r1'],
    openai: ['gpt-5.2', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.3-codex', 'computer-use-preview'],
    anthropic: ['claude-opus-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    gemini: ['gemini-3-pro-preview-09-2026', 'gemini-3-flash-preview-09-2026', 'gemini-2.5-pro'],
    minimax: ['M2', 'M2-Pro'],
    mistral: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    bedrock: ['amazon.nova-pro-v1:0', 'amazon.nova-lite-v1:0', 'anthropic.claude-3-5-sonnet-20241022-v2:0'],
    'azure-openai': ['gpt-5.2', 'gpt-5-mini', 'gpt-5-nano'],
    together: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
    groq: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    siliconflow: ['Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    ollama: ['llama3.3:latest', 'qwen2.5:latest', 'deepseek-r1:latest'],
    'lm-studio': [],
    localai: [],
    vllm: [],
    tgi: [],
    sglang: [],
};

const TIER_INFO: Record<ModelTier, { label: string; description: string; icon: string }> = {
    cheap: { label: 'Cheap / Router', description: 'Lowest-cost routing and classification', icon: '💰' },
    fast: { label: 'Fast', description: 'Quick responses for standard tasks', icon: '⚡' },
    writing: { label: 'Writing', description: 'Long-form drafting and editing', icon: '✍️' },
    reasoning: { label: 'Reasoning', description: 'Complex analysis and planning', icon: '🧠' },
};

function fallbackModelOptions(provider: LLMProvider): LLMModelOption[] {
    return FALLBACK_MODELS[provider].map(id => ({
        id,
        name: id,
        provider,
    }));
}

function dedupeModels(models: LLMModelOption[]): LLMModelOption[] {
    const seen = new Set<string>();
    const deduped: LLMModelOption[] = [];

    for (const model of models) {
        if (seen.has(model.id)) {
            continue;
        }
        seen.add(model.id);
        deduped.push(model);
    }

    return deduped;
}

function credentialPlaceholder(provider: LLMProvider): string {
    if (provider === 'bedrock') {
        return '{"accessKeyId":"...","secretAccessKey":"...","region":"us-east-1"}';
    }
    if (provider === 'azure-openai') {
        return '{"endpoint":"https://...","apiKey":"...","apiVersion":"2024-02-15-preview","deploymentId":"..."}';
    }
    if (PROVIDER_INFO[provider].credentialType === 'baseUrl') {
        return 'Base URL (e.g., http://localhost:11434)';
    }
    return 'API Key';
}

function modelDisplayLabel(model: LLMModelOption): string {
    const tags = model.tags ?? [];
    if (tags.includes('cheap')) {
        return `${model.name} (Cheap)`;
    }
    return model.name;
}

export default function IntelligencePage() {
    const [config, setConfig] = useState<LLMConfig | null>(null);
    const [providerStatuses, setProviderStatuses] = useState<Record<LLMProvider, ProviderStatus> | null>(null);
    const [availableModels, setAvailableModels] = useState<LLMModelOption[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

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

    const [credentialInput, setCredentialInput] = useState('');
    const [savingCredential, setSavingCredential] = useState(false);
    const [showCredentialSection, setShowCredentialSection] = useState<LLMProvider | null>(null);

    const modelGroups = useMemo(() => {
        const recommended = availableModels.filter(model => model.tags?.includes('recommended'));
        const agentic = availableModels.filter(model => model.tags?.includes('agentic'));
        const reasoning = availableModels.filter(model =>
            model.tags?.includes('reasoning')
            && !model.tags?.includes('agentic')
            && !model.tags?.includes('recommended'),
        );
        const highlighted = new Set<string>([...recommended, ...agentic, ...reasoning].map(model => model.id));
        const other = availableModels.filter(model => !highlighted.has(model.id));
        return { recommended, agentic, reasoning, other };
    }, [availableModels]);

    const loadConfig = async () => {
        try {
            setLoading(true);
            const data = await api.getLLMConfig();
            const providerValue = data.provider as LLMProvider;
            const configData: LLMConfig = {
                provider: providerValue,
                modelId: data.modelId,
                parameters: data.parameters,
                tierModels: data.tierModels,
                hasCredential: data.hasCredential,
                providerCredentials: data.providerCredentials,
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

    const loadStatuses = async () => {
        try {
            const statuses = await api.getLLMProviderStatuses();
            setProviderStatuses(statuses as Record<LLMProvider, ProviderStatus>);
        } catch (err) {
            console.error('Failed to load provider statuses:', err);
        }
    };

    const loadModels = async (provider: LLMProvider) => {
        try {
            const models = await api.getLLMModels(provider);
            const fallback = fallbackModelOptions(provider);
            setAvailableModels(dedupeModels(models.length > 0 ? models : fallback));
        } catch {
            setAvailableModels(dedupeModels(fallbackModelOptions(provider)));
        }
    };

    useEffect(() => {
        void loadConfig();
        void loadStatuses();
    }, []);

    useEffect(() => {
        void loadModels(selectedProvider);
    }, [selectedProvider]);

    const handleSaveConfig = async () => {
        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
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

            setSuccess('Configuration saved successfully.');
            void loadConfig();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveCredential = async (provider: LLMProvider) => {
        if (!credentialInput.trim()) return;

        setSavingCredential(true);
        setError(null);

        try {
            await api.setLLMCredential(provider, credentialInput);
            setCredentialInput('');
            setShowCredentialSection(null);
            setSuccess(`${PROVIDER_INFO[provider].name} credential saved.`);
            void loadStatuses();
            void loadConfig();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSavingCredential(false);
        }
    };

    const handleDeleteCredential = async (provider: LLMProvider) => {
        if (!confirm(`Remove saved credential for ${PROVIDER_INFO[provider].name}?`)) return;

        try {
            await api.deleteLLMCredential(provider);
            setSuccess(`${PROVIDER_INFO[provider].name} credential removed.`);
            void loadStatuses();
            void loadConfig();
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
                <p>Configure providers, model stacks, and tier routing.</p>
            </header>

            {error && <div className="error-banner">{error}</div>}
            {success && <div className="success-banner">{success}</div>}

            <div className="card status-card">
                <h3>Provider Status</h3>
                <div className="provider-status-grid">
                    {PROVIDERS.map(provider => {
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
                                    <span className={`status-indicator ${status?.hasCredential ? 'configured' : 'not-configured'}`}>
                                        {status?.hasCredential ? '✓ Configured' : '○ Not configured'}
                                    </span>
                                    {status?.hasCredential ? (
                                        <div className="key-actions">
                                            <button
                                                className="btn-small"
                                                onClick={() => setShowCredentialSection(showCredentialSection === provider ? null : provider)}
                                            >
                                                Update
                                            </button>
                                            <button
                                                className="btn-small danger"
                                                onClick={() => handleDeleteCredential(provider)}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            className="btn-small primary"
                                            onClick={() => setShowCredentialSection(showCredentialSection === provider ? null : provider)}
                                        >
                                            Add
                                        </button>
                                    )}
                                </div>

                                {showCredentialSection === provider && (
                                    <div className="api-key-input-section">
                                        {info.credentialType === 'json' ? (
                                            <textarea
                                                placeholder={credentialPlaceholder(provider)}
                                                value={credentialInput}
                                                onChange={event => setCredentialInput(event.target.value)}
                                                rows={4}
                                            />
                                        ) : (
                                            <input
                                                type={info.credentialType === 'apiKey' ? 'password' : 'text'}
                                                placeholder={credentialPlaceholder(provider)}
                                                value={credentialInput}
                                                onChange={event => setCredentialInput(event.target.value)}
                                            />
                                        )}
                                        <div className="key-input-actions">
                                            <button
                                                className="btn-small primary"
                                                onClick={() => handleSaveCredential(provider)}
                                                disabled={savingCredential || !credentialInput.trim()}
                                            >
                                                {savingCredential ? 'Saving...' : 'Save'}
                                            </button>
                                            <button
                                                className="btn-small"
                                                onClick={() => {
                                                    setShowCredentialSection(null);
                                                    setCredentialInput('');
                                                }}
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

            <div className="card config-card">
                <h3>Primary Model</h3>
                <p className="card-description">Set the default provider and model for orchestration tasks.</p>

                <div className="config-form">
                    <div className="form-group">
                        <label>Provider</label>
                        <select
                            value={selectedProvider}
                            onChange={event => {
                                setSelectedProvider(event.target.value as LLMProvider);
                                setSelectedModel('');
                            }}
                        >
                            {PROVIDERS.map(provider => (
                                <option key={provider} value={provider}>
                                    {PROVIDER_INFO[provider].name}
                                    {!config?.providerCredentials[provider] ? ' (Not configured)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {modelGroups.recommended.length > 0 && (
                        <div className="model-stack">
                            <h4>Recommended</h4>
                            <div className="model-stack-grid">
                                {modelGroups.recommended.map(model => (
                                    <button
                                        key={model.id}
                                        type="button"
                                        className={`model-chip ${selectedModel === model.id ? 'selected' : ''}`}
                                        onClick={() => setSelectedModel(model.id)}
                                    >
                                        {modelDisplayLabel(model)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {modelGroups.agentic.length > 0 && (
                        <div className="model-stack">
                            <h4>Agentic</h4>
                            <div className="model-stack-grid">
                                {modelGroups.agentic.map(model => (
                                    <button
                                        key={model.id}
                                        type="button"
                                        className={`model-chip ${selectedModel === model.id ? 'selected' : ''}`}
                                        onClick={() => setSelectedModel(model.id)}
                                    >
                                        {modelDisplayLabel(model)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {modelGroups.reasoning.length > 0 && (
                        <div className="model-stack">
                            <h4>Reasoning</h4>
                            <div className="model-stack-grid">
                                {modelGroups.reasoning.map(model => (
                                    <button
                                        key={model.id}
                                        type="button"
                                        className={`model-chip ${selectedModel === model.id ? 'selected' : ''}`}
                                        onClick={() => setSelectedModel(model.id)}
                                    >
                                        {modelDisplayLabel(model)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="form-group">
                        <label>Model</label>
                        <select
                            value={selectedModel}
                            onChange={event => setSelectedModel(event.target.value)}
                        >
                            <option value="">Select a model...</option>
                            {modelGroups.other.length > 0 && (
                                <optgroup label="All models">
                                    {modelGroups.other.map(model => (
                                        <option key={model.id} value={model.id}>
                                            {modelDisplayLabel(model)}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                            {modelGroups.recommended.length > 0 && (
                                <optgroup label="Recommended">
                                    {modelGroups.recommended.map(model => (
                                        <option key={model.id} value={model.id}>
                                            {modelDisplayLabel(model)}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                            {modelGroups.agentic.length > 0 && (
                                <optgroup label="Agentic">
                                    {modelGroups.agentic.map(model => (
                                        <option key={model.id} value={model.id}>
                                            {modelDisplayLabel(model)}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                            {modelGroups.reasoning.length > 0 && (
                                <optgroup label="Reasoning">
                                    {modelGroups.reasoning.map(model => (
                                        <option key={model.id} value={model.id}>
                                            {modelDisplayLabel(model)}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                        <span className="form-hint">
                            Recommended, agentic, and reasoning stacks are highlighted based on the model catalog.
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
                                    onChange={event => setTemperature(parseFloat(event.target.value))}
                                />
                                <span className="slider-value">{temperature.toFixed(1)}</span>
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Max Tokens</label>
                            <input
                                type="number"
                                value={maxTokens || ''}
                                onChange={event => setMaxTokens(event.target.value ? parseInt(event.target.value, 10) : undefined)}
                                placeholder="4096"
                                min="100"
                                max="1000000"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="card tiers-card">
                <h3>Model Tiers</h3>
                <p className="card-description">
                    Tier routing format is <code>provider:model</code> (example: <code>openai:gpt-5-mini</code>).
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
                                onChange={event => setTierModels({ ...tierModels, [tier]: event.target.value })}
                                placeholder="provider:model"
                            />
                        </div>
                    ))}
                </div>
            </div>

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
