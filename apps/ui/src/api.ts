export type Session = {
  id: string;
  createdAt: string;
  subject: string;
  projectPath?: string;
  mainAgentId?: string;
  status?: 'active' | 'terminated';
};

export type AuditEvent = {
  id: string;
  time: string;
  subject: string;
  action: string;
  tool?: string;
  decision: 'allow' | 'deny';
  reason?: string;
  resource: {
    type: string;
    path?: string;
    root?: string;
    memoryType?: string;
    scopeId?: string;
  };
  sessionId?: string;
  agentId?: string;
  role?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
};

export type AgentRole = 'main' | 'worker' | 'coordinator' | 'external';
export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'terminated';

export type Agent = {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  sessionId: string;
  userId: string;
  skillId?: string;
  templateId?: string;
  createdAt: string;
  terminatedAt?: string;
  metadata?: Record<string, unknown>;
};

export type Skill = {
  manifest: {
    id: string;
    name: string;
    version: string;
    description?: string;
    workerTemplates: Array<{
      id: string;
      name: string;
      description?: string;
      requiredCapabilities: string[];
    }>;
    requestedCapabilities: Array<{
      connector: string;
      action: string;
      resource: {
        type: 'fs';
        root?: string;
        paths?: string[];
      };
      justification: string;
    }>;
  };
  status: 'enabled' | 'disabled' | 'pending_consent';
  installedAt: string;
  path: string;
};

export type CoordinationPattern = 'fan-out-fan-in' | 'pipeline' | 'supervisor';

export type CoordinationEvent = {
  id: string;
  pattern: CoordinationPattern;
  initiatorAgentId: string;
  targetAgentIds: string[];
  status: 'proposed' | 'active' | 'completed' | 'aborted';
  metadata?: Record<string, unknown>;
};

export type PolicyStore = {
  grants: Array<{
    id: string;
    subject: string;
    action: string;
    resource: {
      type: 'fs';
      root?: string;
      paths?: string[];
    };
    fields?: string[];
    expiresAt?: number;
  }>;
  rules: Array<{
    id: string;
    effect: 'deny' | 'allow';
    subject?: string;
    action?: string;
    resource?: {
      type: 'fs' | 'memory';
      root?: string;
      paths?: string[];
      memoryType?: string;
      scopeIds?: string[];
    };
    reason?: string;
  }>;
};

export type MemoryType = 'profile' | 'project' | 'session' | 'tool-derived';
export type SensitivityLevel = 'low' | 'moderate' | 'high';

export type MemoryItem = {
  id: string;
  type: MemoryType;
  subjectId: string;
  scopeId: string;
  content: Record<string, any>;
  provenance: {
    agentId?: string;
    skillId?: string;
    sourceId: string;
    timestamp: string;
  };
  metadata: {
    tags: string[];
    sensitivity: SensitivityLevel;
    ttlSeconds?: number;
    expiresAt?: string;
  };
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data.error;
    throw new Error(message || 'Request failed');
  }

  return data as T;
}

export const api = {
  getDoctorResults: () => apiFetch<{ results: any[] }>('/doctor'),
  getChannels: () => apiFetch<{ channels: any[] }>('/channels'),
  getAuditLogs: async (params: Record<string, string | undefined> = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const data = await apiFetch<{ events: AuditEvent[] }>(`/audit?${query.toString()}`);
    return data;
  },
  getSkills: () => apiFetch<{ skills: Skill[] }>('/skills'),
  getAgents: (sessionId: string) => apiFetch<{ agents: Agent[] }>(`/sessions/${sessionId}/agents`),
  createSession: (params?: { projectPath?: string }) => apiFetch<{ session: Session; mainAgentId: string }>('/sessions', {
    method: 'POST',
    body: JSON.stringify(params)
  }),
  getSessionPrompt: (sessionId: string) => apiFetch<{ prompt: string }>(`/sessions/${sessionId}/prompt`),
  getAgentInstructions: (agentId: string) => apiFetch<{ instructions: string; metadata?: any }>(`/agents/${agentId}/instructions`),
  sendMessage: (sessionId: string, message: string) => apiFetch<{
    ok: boolean;
    action: string;
    path: string;
    result: { content?: string; entries?: string[] };
  }>(`/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  }),
  fetchPolicy: () => apiFetch<{ policy: PolicyStore }>('/permissions'),
  updatePolicy: (policy: PolicyStore) => apiFetch<{ ok: boolean }>('/permissions', {
    method: 'POST',
    body: JSON.stringify({ policy }),
  }),
  installSkill: (sourcePath: string) => apiFetch<{ ok: boolean; skill: Skill }>('/skills/install', {
    method: 'POST',
    body: JSON.stringify({ sourcePath }),
  }),
  enableSkill: (id: string) => apiFetch<{ ok: boolean }>(`/skills/${id}/enable`, { method: 'POST' }),
  disableSkill: (id: string) => apiFetch<{ ok: boolean }>(`/skills/${id}/disable`, { method: 'POST' }),
  grantSkill: (id: string) => apiFetch<{ ok: boolean }>(`/skills/${id}/grant`, { method: 'POST' }),
  revokeSkill: (id: string) => apiFetch<{ ok: boolean }>(`/skills/${id}/revoke`, { method: 'POST' }),
  fetchMemory: () => apiFetch<{ items: MemoryItem[] }>('/memory'),
  deleteMemory: (id: string) => apiFetch<{ ok: boolean }>(`/memory/${id}`, { method: 'DELETE' }),
  spawnAgent: (sessionId: string, params: {
    role: AgentRole;
    skillId?: string;
    templateId?: string;
    metadata?: Record<string, unknown>;
  }) => apiFetch<{ agent: Agent }>(`/sessions/${sessionId}/agents`, {
    method: 'POST',
    body: JSON.stringify(params),
  }),
  terminateAgent: (sessionId: string, agentId: string, reason?: string) => apiFetch<{ ok: boolean }>(`/sessions/${sessionId}/agents/${agentId}/terminate`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }),
  proposeCoordination: (sessionId: string, params: {
    pattern: CoordinationPattern;
    initiatorAgentId: string;
    targetSpecs: Array<{
      role: AgentRole;
      skillId?: string;
      templateId?: string;
      metadata?: Record<string, unknown>;
    }>;
  }) => apiFetch<{ coordination: CoordinationEvent }>(`/sessions/${sessionId}/coordination`, {
    method: 'POST',
    body: JSON.stringify(params),
  }),

  // LLM Intelligence Configuration APIs
  getLLMConfig: () => apiFetch<{
    provider: string;
    modelId: string;
    parameters: { temperature: number; maxTokens?: number; topP?: number };
    tierModels?: { cheap?: string; fast?: string; writing?: string; reasoning?: string };
    hasCredential: boolean;
    providerCredentials: Record<string, boolean>;
  }>('/llm/config'),

  updateLLMConfig: (config: {
    provider?: string;
    modelId?: string;
    parameters?: { temperature?: number; maxTokens?: number; topP?: number };
    tierModels?: { cheap?: string; fast?: string; writing?: string; reasoning?: string } | undefined;
  }) => apiFetch<{ ok: boolean }>('/llm/config', {
    method: 'POST',
    body: JSON.stringify(config),
  }),

  getLLMStatus: () => apiFetch<{ configured: boolean; provider: string; model: string }>('/llm/status'),

  getLLMModels: async (provider?: string) => {
    const query = provider ? `?provider=${provider}` : '';
    const data = await apiFetch<{ models: Array<{ id: string; name: string }> }>(`/llm/models${query}`);
    return data.models.map(m => m.id);
  },

  getLLMProviderStatuses: () => apiFetch<Record<string, { available: boolean; hasCredential: boolean }>>('/llm/providers/status'),

  setLLMCredential: (provider: string, credential: string) => apiFetch<{ ok: boolean }>('/llm/credentials', {
    method: 'POST',
    body: JSON.stringify({ provider, credential }),
  }),

  deleteLLMCredential: (provider: string) => apiFetch<{ ok: boolean }>(`/llm/credentials/${provider}`, {
    method: 'DELETE',
  }),

  // =========================================================================
  // User Preferences & Personalization
  // =========================================================================

  getPreferences: () => apiFetch<{
    id: string;
    userId: string;
    customInstructions: {
      aboutUser: string;
      responseStyle: string;
    };
    userContext: {
      work: {
        role?: string;
        industry?: string;
        typicalHours?: string;
        timezone?: string;
      };
      personal: {
        familyContext?: string;
        preferredContactTimes?: string;
      };
      goals: Array<{
        id: string;
        description: string;
        category: 'professional' | 'personal' | 'learning';
        createdAt: string;
        checkInScheduled: boolean;
      }>;
    };
    onboarding: {
      completed: boolean;
      startedAt?: string;
      completedAt?: string;
      phase: 'not_started' | 'in_progress' | 'completed';
      coveredTopics: Array<'work' | 'personal' | 'goals'>;
    };
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
  }>('/preferences'),

  updateCustomInstructions: (instructions: { aboutUser?: string; responseStyle?: string }) =>
    apiFetch<{ ok: boolean }>('/preferences/instructions', {
      method: 'PUT',
      body: JSON.stringify(instructions),
    }),

  updateUserContext: (context: {
    work?: { role?: string; industry?: string; typicalHours?: string; timezone?: string };
    personal?: { familyContext?: string; preferredContactTimes?: string };
  }) =>
    apiFetch<{ ok: boolean }>('/preferences/context', {
      method: 'PUT',
      body: JSON.stringify(context),
    }),

  addGoal: (goal: { description: string; category: 'professional' | 'personal' | 'learning' }) =>
    apiFetch<{ ok: boolean }>('/preferences/goals', {
      method: 'POST',
      body: JSON.stringify(goal),
    }),

  removeGoal: (goalId: string) =>
    apiFetch<{ ok: boolean }>(`/preferences/goals/${goalId}`, {
      method: 'DELETE',
    }),

  setPersonalizationEnabled: (enabled: boolean) =>
    apiFetch<{ ok: boolean }>('/preferences/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),

  getOnboardingStatus: () =>
    apiFetch<{
      needsOnboarding: boolean;
      phase: 'not_started' | 'in_progress' | 'completed';
      coveredTopics: Array<'work' | 'personal' | 'goals'>;
      completedAt?: string;
    }>('/preferences/onboarding-status'),

  startOnboarding: () =>
    apiFetch<{ ok: boolean; phase: string }>('/preferences/onboarding/start', {
      method: 'POST',
    }),

  completeOnboarding: () =>
    apiFetch<{ ok: boolean; completedAt: string }>('/preferences/onboarding/complete', {
      method: 'POST',
    }),
};

export const {
  createSession,
  sendMessage,
  fetchPolicy,
  updatePolicy,
  installSkill,
  enableSkill,
  disableSkill,
  grantSkill,
  revokeSkill,
  fetchMemory,
  deleteMemory,
  spawnAgent,
  terminateAgent,
  proposeCoordination,
} = api;

// For legacy code that might expect fetchAudit or fetchSkills / fetchAgents / fetchAudit
export const fetchAudit = (params: any) => api.getAuditLogs(params).then(d => d.events);
export const fetchSkills = () => api.getSkills().then(d => d.skills);
export const fetchAgents = (sid: string) => api.getAgents(sid).then(d => d.agents);
