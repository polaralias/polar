import { createSignal } from "solid-js";
import {
  getSettings as getSettingsApi,
  saveSettings as saveSettingsApi,
  Settings as ApiSettings,
} from "../lib/tauri-api";

export interface Settings {
  apiKey: string;  // Current active API key (for display)
  model: string;
  baseUrl: string;
  maxTokens: number;
  temperature?: number;
  executionBackend: string;
  containerEnabled: boolean;
  containerCpuCores: number;
  containerMemoryMb: number;
  containerTimeoutSecs: number;
  containerNetworkEnabled: boolean;
  containerPrepullOnEnable: boolean;
  routerModel: string;
  browserEnabled: boolean;
  browserRequireConsent: boolean;
  browserAllowedDomains: string;
  browserBlockedDomains: string;
  browserLlmMode: string;
  browserLlmProvider: string;
  browserLlmModel: string;
  browserLlmApiKey: string;
  browserLlmBaseUrl: string;
  providerKeys: Record<string, string>;  // Provider-specific API keys
  openaiOrganization?: string;  // Optional OpenAI Organization ID
  openaiProject?: string;  // Optional OpenAI Project ID
}

// Provider configuration type
export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: "anthropic" | "openai" | "openai-compatible" | "openai-responses" | "google" | "minimax";
  authType: "none" | "bearer" | "api-key" | "query-param";
  authHeader?: string;  // Custom auth header name
  description?: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  provider: string;
  baseUrl: string;
  apiFormat?: "responses" | "openai-responses";
}

export interface ModelHighlight {
  id: string;
  label: string;
  reason: string;
}

// Provider presets
export const PROVIDER_PRESETS: Record<string, ProviderConfig> = {
  // Official API services
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiFormat: "anthropic",
    authType: "api-key",
    description: "Claude Official API",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com",
    apiFormat: "openai-responses",
    authType: "bearer",
    description: "GPT Official API",
  },
  google: {
    id: "google",
    name: "Google",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiFormat: "google",
    authType: "query-param",
    description: "Gemini Official API",
  },
  minimax: {
    id: "minimax",
    name: "Minimax",
    baseUrl: "https://api.minimaxi.com/v1",
    apiFormat: "minimax",
    authType: "bearer",
    description: "Minimax Official API",
  },

  // Local inference services
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    baseUrl: "http://localhost:11434",
    apiFormat: "openai-compatible",
    authType: "none",
    description: "Local, free and private",
  },
  localai: {
    id: "localai",
    name: "LocalAI",
    baseUrl: "http://localhost:8080",
    apiFormat: "openai-compatible",
    authType: "none",
    description: "Local, multi-model support",
  },

  // Cloud GPU inference
  vllm: {
    id: "vllm",
    name: "vLLM Server",
    baseUrl: "http://localhost:8000",
    apiFormat: "openai-compatible",
    authType: "none",
    description: "High-performance inference engine",
  },
  tgi: {
    id: "tgi",
    name: "Text Generation Inference",
    baseUrl: "http://localhost:8080",
    apiFormat: "openai-compatible",
    authType: "none",
    description: "HuggingFace inference service",
  },
  sglang: {
    id: "sglang",
    name: "SGLang",
    baseUrl: "http://localhost:30000",
    apiFormat: "openai-compatible",
    authType: "none",
    description: "Structured generation language",
  },

  // API aggregation services
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiFormat: "openai-compatible",
    authType: "bearer",
    description: "Multi-model aggregation, pay-as-you-go",
  },
  together: {
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    apiFormat: "openai-compatible",
    authType: "bearer",
    description: "Open source model cloud service",
  },
  groq: {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiFormat: "openai-compatible",
    authType: "bearer",
    description: "Ultra-fast inference",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiFormat: "openai-compatible",
    authType: "bearer",
    description: "DeepSeek Official API",
  },
  siliconflow: {
    id: "siliconflow",
    name: "SiliconFlow",
    baseUrl: "https://api.siliconflow.com/v1",
    apiFormat: "openai-compatible",
    authType: "bearer",
    description: "Cloud inference service",
  },

  // Custom
  custom: {
    id: "custom",
    name: "Custom Service",
    baseUrl: "http://localhost:8000",
    apiFormat: "openai-compatible",
    authType: "bearer",
    description: "Custom OpenAI-compatible service",
  },
};

export const AVAILABLE_MODELS: ModelConfig[] = [
  // Anthropic
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", description: "Deep reasoning for complex tasks", provider: "anthropic", baseUrl: "https://api.anthropic.com" },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", description: "Fast, balanced reasoning and execution", provider: "anthropic", baseUrl: "https://api.anthropic.com" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", description: "Lightweight and low-latency", provider: "anthropic", baseUrl: "https://api.anthropic.com" },

  // OpenAI
  { id: "gpt-5.2", name: "GPT-5.2", description: "Reasoning flagship", provider: "openai", baseUrl: "https://api.openai.com", apiFormat: "responses" },
  { id: "gpt-5-mini", name: "GPT-5 Mini", description: "Quick and cost-efficient", provider: "openai", baseUrl: "https://api.openai.com", apiFormat: "responses" },
  { id: "gpt-5-nano", name: "GPT-5 Nano", description: "Lowest-cost GPT-5 model", provider: "openai", baseUrl: "https://api.openai.com", apiFormat: "responses" },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", description: "Newest Codex model (availability may vary by account/API access)", provider: "openai", baseUrl: "https://api.openai.com", apiFormat: "responses" },
  { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", description: "Reliable Codex baseline model", provider: "openai", baseUrl: "https://api.openai.com", apiFormat: "responses" },
  { id: "gpt-5.1", name: "GPT-5.1", description: "General use at lower cost than 5.2", provider: "openai", baseUrl: "https://api.openai.com", apiFormat: "responses" },
  { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", description: "General coding agent model", provider: "openai", baseUrl: "https://api.openai.com", apiFormat: "responses" },
  { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", description: "Cheaper Codex variant", provider: "openai", baseUrl: "https://api.openai.com", apiFormat: "responses" },
  { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", description: "Highest-capability Codex variant", provider: "openai", baseUrl: "https://api.openai.com", apiFormat: "responses" },
  { id: "computer-use-preview", name: "Computer Use Preview", description: "OpenAI computer-use workflow model", provider: "openai", baseUrl: "https://api.openai.com", apiFormat: "responses" },

  // Google
  { id: "gemini-3-pro-preview-09-2026", name: "Gemini 3 Pro", description: "Reasoning and long-context workflows", provider: "google", baseUrl: "https://generativelanguage.googleapis.com" },
  { id: "gemini-3-flash-preview-09-2026", name: "Gemini 3 Flash", description: "Fast and low-cost Gemini 3 model", provider: "google", baseUrl: "https://generativelanguage.googleapis.com" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "Previous Gemini flagship", provider: "google", baseUrl: "https://generativelanguage.googleapis.com" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Fast 2.5-series model", provider: "google", baseUrl: "https://generativelanguage.googleapis.com" },

  // Minimax
  { id: "M2", name: "MiniMax M2", description: "MiniMax flagship", provider: "minimax", baseUrl: "https://api.minimaxi.com/v1" },
  { id: "M2-Pro", name: "MiniMax M2 Pro", description: "High-capability M2 variant", provider: "minimax", baseUrl: "https://api.minimaxi.com/v1" },

  // Local Inference (Ollama)
  { id: "llama3.3:latest", name: "Llama 3.3 8B", description: "Local open-source model", provider: "ollama", baseUrl: "http://localhost:11434" },
  { id: "llama3.3:70b", name: "Llama 3.3 70B", description: "Large local model", provider: "ollama", baseUrl: "http://localhost:11434" },
  { id: "qwen2.5:latest", name: "Qwen 2.5 7B", description: "Local Qwen default", provider: "ollama", baseUrl: "http://localhost:11434" },
  { id: "qwen2.5:32b", name: "Qwen 2.5 32B", description: "Large local Qwen", provider: "ollama", baseUrl: "http://localhost:11434" },
  { id: "deepseek-r1:latest", name: "DeepSeek R1", description: "Local reasoning model", provider: "ollama", baseUrl: "http://localhost:11434" },
  { id: "codellama:latest", name: "Code Llama", description: "Local coding model", provider: "ollama", baseUrl: "http://localhost:11434" },
  { id: "mistral:latest", name: "Mistral 7B", description: "Local Mistral model", provider: "ollama", baseUrl: "http://localhost:11434" },
  { id: "phi3:latest", name: "Phi-3", description: "Local small model", provider: "ollama", baseUrl: "http://localhost:11434" },

  // Aggregation services
  { id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5", description: "via OpenRouter", provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "openai/gpt-5.2", name: "GPT-5.2", description: "via OpenRouter", provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", description: "via OpenRouter", provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1", description: "via OpenRouter", provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo", description: "via Together", provider: "together", baseUrl: "https://api.together.xyz/v1" },
  { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", name: "Qwen 2.5 72B Turbo", description: "via Together", provider: "together", baseUrl: "https://api.together.xyz/v1" },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", description: "via Groq", provider: "groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", description: "via Groq", provider: "groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", description: "via Groq", provider: "groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "deepseek-chat", name: "DeepSeek Chat", description: "DeepSeek official API", provider: "deepseek", baseUrl: "https://api.deepseek.com" },
  { id: "deepseek-reasoner", name: "DeepSeek Reasoner", description: "Reasoning-tuned variant", provider: "deepseek", baseUrl: "https://api.deepseek.com" },
  { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B", description: "via SiliconFlow", provider: "siliconflow", baseUrl: "https://api.siliconflow.com/v1" },
  { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3", description: "via SiliconFlow", provider: "siliconflow", baseUrl: "https://api.siliconflow.com/v1" },

  // Custom
  { id: "custom-model", name: "Custom Model", description: "Enter your own model ID", provider: "custom", baseUrl: "http://localhost:8000" },
];

export const RECOMMENDED_MODEL_STACK: ModelHighlight[] = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", reason: "Deep reasoning for complex tasks" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", reason: "Fast and strong general reasoning" },
  { id: "gemini-3-flash-preview-09-2026", label: "Gemini 3 Flash", reason: "Quick response, low cost" },
  { id: "gemini-3-pro-preview-09-2026", label: "Gemini 3 Pro", reason: "Reasoning-heavy tasks" },
  { id: "gpt-5.2", label: "GPT-5.2", reason: "OpenAI reasoning flagship" },
  { id: "gpt-5.1", label: "GPT-5.1", reason: "Cheaper general use" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", reason: "Quick and cheap daily use" },
];

export const AGENTIC_MODEL_STACK: ModelHighlight[] = [
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", reason: "Frontier Codex model for agentic workflows" },
  { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", reason: "Stable Codex baseline for agentic tasks" },
  { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", reason: "Cheaper Codex agent variant" },
  { id: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", reason: "Maximum Codex capability" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", reason: "Agentic deep reasoning workflows" },
  { id: "gemini-3-pro-preview-09-2026", label: "Gemini 3 Pro", reason: "Agentic planning and reasoning" },
  { id: "computer-use-preview", label: "Computer Use Preview", reason: "OpenAI computer-use workflows" },
];

const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: "claude-sonnet-4-5",
  baseUrl: "https://api.anthropic.com",
  maxTokens: 4096,
  temperature: 0.7,
  executionBackend: "none",
  containerEnabled: false,
  containerCpuCores: 2,
  containerMemoryMb: 2048,
  containerTimeoutSecs: 300,
  containerNetworkEnabled: true,
  containerPrepullOnEnable: false,
  routerModel: "claude-sonnet-4-5",
  browserEnabled: false,
  browserRequireConsent: true,
  browserAllowedDomains: "",
  browserBlockedDomains: "",
  browserLlmMode: "inherit",
  browserLlmProvider: "",
  browserLlmModel: "",
  browserLlmApiKey: "",
  browserLlmBaseUrl: "",
  providerKeys: {},
};

const MODEL_ID_ALIASES: Record<string, string> = {
  "gpt-5.2-mini": "gpt-5-mini",
  "gpt-5.1-mini": "gpt-5-mini",
  "gpt-5.2-nano": "gpt-5-nano",
  "gpt-5.1-nano": "gpt-5-nano",
  "gpt-5": "gpt-5.2",
  "gpt-4o": "gpt-5-mini",
};

export function normalizeModelIdAlias(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return "";
  }
  const canonical = trimmed.toLowerCase().replace(/[_\s]+/g, "-");
  const alias = MODEL_ID_ALIASES[canonical];
  if (alias) {
    return alias;
  }
  const exactModel = AVAILABLE_MODELS.find((candidate) => candidate.id.toLowerCase() === canonical);
  if (exactModel) {
    return exactModel.id;
  }
  return trimmed;
}

const ROUTER_MODEL_IDS_BY_PROVIDER: Record<string, string[]> = {
  anthropic: ["claude-haiku-4-5", "claude-sonnet-4-5"],
  openai: ["gpt-5-nano", "gpt-5-mini", "gpt-5.1", "gpt-5.2"],
  google: ["gemini-3-flash-preview-09-2026", "gemini-2.5-flash"],
  minimax: ["M2"],
  openrouter: ["openai/gpt-5.2"],
  together: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  groq: ["mixtral-8x7b-32768"],
  deepseek: ["deepseek-chat"],
  siliconflow: ["Qwen/Qwen2.5-72B-Instruct"],
  ollama: ["llama3.3:latest"],
};

const FALLBACK_ROUTER_MODEL_IDS = [
  "claude-haiku-4-5",
  "gpt-5-nano",
  "gpt-5-mini",
  "gemini-3-flash-preview-09-2026",
  "M2",
];

export function getCheapRouterModels(providerId: string): ModelConfig[] {
  const ids = ROUTER_MODEL_IDS_BY_PROVIDER[providerId] ?? FALLBACK_ROUTER_MODEL_IDS;
  const seen = new Set<string>();
  const models: ModelConfig[] = [];
  for (const id of ids) {
    const model = AVAILABLE_MODELS.find((candidate) => candidate.id === id);
    if (!model || seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);
    models.push(model);
  }
  return models;
}

function isOpenAIModelId(modelId: string): boolean {
  const lower = modelId.trim().toLowerCase();
  return lower.startsWith("gpt-")
    || lower.startsWith("o1")
    || lower.startsWith("o3")
    || lower.startsWith("o4")
    || lower.startsWith("computer-use")
    || lower.startsWith("chatgpt");
}

function isOpenAIResponsesModelId(modelId: string): boolean {
  return isOpenAIModelId(modelId);
}

// Get provider ID from model
export function getProviderFromModel(modelId: string): string {
  const normalizedModelId = normalizeModelIdAlias(modelId);
  const model = AVAILABLE_MODELS.find(m => m.id === normalizedModelId);
  if (model?.provider) {
    return model.provider;
  }

  const lower = normalizedModelId.trim().toLowerCase();
  if (
    lower.startsWith("anthropic/")
    || lower.startsWith("openai/")
    || lower.startsWith("meta-llama/")
    || lower.startsWith("deepseek/")
  ) {
    return "openrouter";
  }
  if (lower.includes(":")) {
    return "ollama";
  }
  if (lower.includes("claude")) {
    return "anthropic";
  }
  if (lower.includes("gemini")) {
    return "google";
  }
  if (lower.includes("minimax") || lower.startsWith("m2")) {
    return "minimax";
  }
  if (isOpenAIModelId(lower)) {
    return "openai";
  }
  return "anthropic";
}

export function getDefaultRouterModel(providerId: string, fallbackModel?: string): string {
  switch (providerId) {
    case "anthropic":
      return "claude-sonnet-4-5";
    case "openai":
      return "gpt-5-mini";
    case "google":
      return "gemini-3-flash-preview-09-2026";
    case "minimax":
      return "M2";
    case "openrouter":
      return "openai/gpt-5.2";
    case "together":
      return "meta-llama/Llama-3.3-70B-Instruct-Turbo";
    case "groq":
      return "mixtral-8x7b-32768";
    case "deepseek":
      return "deepseek-chat";
    case "siliconflow":
      return "Qwen/Qwen2.5-72B-Instruct";
    case "ollama":
      return "llama3.3:latest";
    default:
      return fallbackModel || "";
  }
}

// Check if a model uses the OpenAI Responses API.
export function usesResponsesApi(modelId: string): boolean {
  const normalizedModelId = normalizeModelIdAlias(modelId);
  // Check if model is in AVAILABLE_MODELS with apiFormat: "responses"
  const model = AVAILABLE_MODELS.find(m => m.id === normalizedModelId);
  if (
    model
    && "apiFormat" in model
    && (model.apiFormat === "responses" || model.apiFormat === "openai-responses")
  ) {
    return true;
  }
  // Fallback: all OpenAI-provider models use Responses API.
  return getProviderFromModel(normalizedModelId) === "openai";
}

// Convert between frontend and API formats
function fromApiSettings(api: ApiSettings): Settings {
  const providerKeys = api.provider_keys || {};
  const model = normalizeModelIdAlias(api.model);
  const provider = getProviderFromModel(model);
  const defaultRouter = getDefaultRouterModel(provider, model);
  const rawRouterModel = api.router_model ?? defaultRouter;
  const routerModel = rawRouterModel ? normalizeModelIdAlias(rawRouterModel) : rawRouterModel;
  const browserLlmModel = api.browser_llm_model
    ? normalizeModelIdAlias(api.browser_llm_model)
    : "";
  const allowedBackends = new Set(["none", "docker"]);
  const executionBackend = allowedBackends.has(api.execution_backend)
    ? api.execution_backend
    : "none";
  const containerEnabled = (api.container_enabled ?? false) && executionBackend === "docker";

  // Get the current provider's API key
  const apiKey = providerKeys[provider] || api.api_key || "";

  return {
    apiKey,
    model,
    baseUrl: api.base_url,
    maxTokens: api.max_tokens,
    temperature: api.temperature ?? 0.7,
    executionBackend,
    containerEnabled,
    containerCpuCores: api.container_cpu_cores ?? 2,
    containerMemoryMb: api.container_memory_mb ?? 2048,
    containerTimeoutSecs: api.container_timeout_secs ?? 300,
    containerNetworkEnabled: api.container_network_enabled ?? true,
    containerPrepullOnEnable: api.container_prepull_on_enable ?? false,
    routerModel,
    browserEnabled: api.browser_enabled ?? false,
    browserRequireConsent: api.browser_require_consent ?? true,
    browserAllowedDomains: api.browser_allowed_domains ?? "",
    browserBlockedDomains: api.browser_blocked_domains ?? "",
    browserLlmMode: api.browser_llm_mode ?? "inherit",
    browserLlmProvider: api.browser_llm_provider ?? "",
    browserLlmModel,
    browserLlmApiKey: api.browser_llm_api_key ?? "",
    browserLlmBaseUrl: api.browser_llm_base_url ?? "",
    providerKeys,
    openaiOrganization: api.openai_organization,
    openaiProject: api.openai_project,
  };
}

function toApiSettings(settings: Settings): ApiSettings {
  const model = normalizeModelIdAlias(settings.model);
  const routerModel = settings.routerModel
    ? normalizeModelIdAlias(settings.routerModel)
    : "";
  const browserLlmModel = settings.browserLlmModel
    ? normalizeModelIdAlias(settings.browserLlmModel)
    : "";
  // Update the providerKeys with current apiKey for current provider
  const provider = getProviderFromModel(model);
  const providerKeys = { ...settings.providerKeys };
  if (settings.apiKey) {
    providerKeys[provider] = settings.apiKey;
  }

  return {
    api_key: settings.apiKey,
    model,
    base_url: settings.baseUrl,
    max_tokens: settings.maxTokens,
    temperature: settings.temperature ?? 0.7,
    execution_backend: settings.executionBackend,
    container_enabled: settings.containerEnabled,
    container_cpu_cores: settings.containerCpuCores,
    container_memory_mb: settings.containerMemoryMb,
    container_timeout_secs: settings.containerTimeoutSecs,
    container_network_enabled: settings.containerNetworkEnabled,
    container_prepull_on_enable: settings.containerPrepullOnEnable,
    router_model: routerModel,
    browser_enabled: settings.browserEnabled,
    browser_require_consent: settings.browserRequireConsent,
    browser_allowed_domains: settings.browserAllowedDomains,
    browser_blocked_domains: settings.browserBlockedDomains,
    browser_llm_mode: settings.browserLlmMode,
    browser_llm_provider: settings.browserLlmProvider,
    browser_llm_model: browserLlmModel,
    browser_llm_api_key: settings.browserLlmApiKey,
    browser_llm_base_url: settings.browserLlmBaseUrl,
    provider_keys: providerKeys,
    openai_organization: settings.openaiOrganization,
    openai_project: settings.openaiProject,
  };
}

const [settings, setSettings] = createSignal<Settings>(DEFAULT_SETTINGS);
const [showSettings, setShowSettings] = createSignal(false);
const [isLoading, setIsLoading] = createSignal(true);

// Load settings on startup
export async function loadSettings() {
  setIsLoading(true);
  try {
    const apiSettings = await getSettingsApi();
    setSettings(fromApiSettings(apiSettings));
  } catch (e) {
    console.error("Failed to load settings:", e);
  } finally {
    setIsLoading(false);
  }
}

// Save settings
async function persistSettings(newSettings: Settings) {
  try {
    await saveSettingsApi(toApiSettings(newSettings));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

// Helper function to get model info
export function getModelInfo(modelId: string) {
  return AVAILABLE_MODELS.find(m => m.id === modelId);
}

// Helper function to get default base URL for a model
export function getDefaultBaseUrl(modelId: string): string {
  const model = getModelInfo(modelId);
  if (model?.baseUrl) {
    return model.baseUrl;
  }
  const provider = getProviderFromModel(modelId);
  return PROVIDER_PRESETS[provider]?.baseUrl || "https://api.anthropic.com";
}

// Check if a provider requires API key
export function providerRequiresApiKey(providerId: string): boolean {
  const config = PROVIDER_PRESETS[providerId];
  if (!config) return true;  // Unknown provider, assume needs key
  return config.authType !== "none";
}

function getProviderApiKey(settings: Settings, providerId: string): string {
  const fromMap = settings.providerKeys[providerId];
  if (fromMap && fromMap.trim().length > 0) {
    return fromMap.trim();
  }
  const currentProvider = getProviderFromModel(settings.model);
  if (currentProvider === providerId && settings.apiKey.trim().length > 0) {
    return settings.apiKey.trim();
  }
  return "";
}

function providerConfiguredInMainUi(settings: Settings, providerId: string): boolean {
  if (!providerRequiresApiKey(providerId)) {
    // Keep local/no-auth providers visible only when they are currently selected.
    return getProviderFromModel(settings.model) === providerId;
  }
  return getProviderApiKey(settings, providerId).length > 0;
}

export function getMainUiModels(settings: Settings): ModelConfig[] {
  return AVAILABLE_MODELS.filter((model) => {
    if (model.provider === "custom") {
      return false;
    }
    return providerConfiguredInMainUi(settings, model.provider);
  });
}

export function useSettings() {
  return {
    settings,
    setSettings,
    showSettings,
    isLoading,
    toggleSettings: () => setShowSettings((v) => !v),
    updateSetting: async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      const normalizedValue =
        typeof value === "string" && (key === "model" || key === "routerModel" || key === "browserLlmModel")
          ? (normalizeModelIdAlias(value) as Settings[K])
          : value;
      let newSettings = { ...settings(), [key]: normalizedValue };

      // When API key changes, also save it to providerKeys for the current provider
      if (key === 'apiKey' && typeof value === 'string') {
        const currentProvider = getProviderFromModel(settings().model);
        newSettings.providerKeys = {
          ...newSettings.providerKeys,
          [currentProvider]: value,
        };
      }

      // When model changes, switch to that provider's stored API key
      if (key === 'model' && typeof normalizedValue === 'string') {
        const nextModelId = normalizeModelIdAlias(normalizedValue);
        const currentModel = getModelInfo(settings().model);
        const newModel = getModelInfo(nextModelId);
        const currentProvider = getProviderFromModel(settings().model);
        const newProvider = getProviderFromModel(nextModelId);
        const defaultCurrentRouter = getDefaultRouterModel(currentProvider, settings().model);
        const defaultNewRouter = getDefaultRouterModel(newProvider, nextModelId);

        // Save current API key to providerKeys before switching
        if (settings().apiKey) {
          newSettings.providerKeys = {
            ...newSettings.providerKeys,
            [currentProvider]: settings().apiKey,
          };
        }

        // Load the new provider's API key
        newSettings.apiKey = newSettings.providerKeys[newProvider] || "";

        // Auto-update base URL if current URL matches the previous model's default
        if (currentModel && newModel && settings().baseUrl === currentModel.baseUrl) {
          newSettings.baseUrl = newModel.baseUrl;
        }

        if (newSettings.routerModel === defaultCurrentRouter) {
          newSettings.routerModel = defaultNewRouter;
        }
      }

      setSettings(newSettings);
      await persistSettings(newSettings);
    },
    saveAllSettings: async (newSettings: Settings) => {
      // Save current API key to providerKeys
      const provider = getProviderFromModel(newSettings.model);
      if (newSettings.apiKey) {
        newSettings.providerKeys = {
          ...newSettings.providerKeys,
          [provider]: newSettings.apiKey,
        };
      }
      setSettings(newSettings);
      await persistSettings(newSettings);
    },
    // Always show main UI - API key validation happens at request time
    // This allows users to explore the app and switch to local providers without being blocked
    isConfigured: () => true,
    loadSettings,
    getModelInfo,
    getDefaultBaseUrl,
    getProviderFromModel,
    providerRequiresApiKey,
  };
}
