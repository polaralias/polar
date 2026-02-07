export type Session = {
  id: string;
  createdAt: string;
  subject: string;
  projectPath?: string;
  mainAgentId?: string;
  status?: 'active' | 'terminated';
};

export type SystemStatus = {
  mode: 'normal' | 'emergency';
  lastModeChange: string;
  reason?: string;
  skillPolicyMode: 'developer' | 'signed_only';
};

export type TrustedPublisher = {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type GoalCheckIn = {
  id: string;
  userId: string;
  goalId: string;
  goalDescription: string;
  goalCategory: 'professional' | 'personal' | 'learning';
  dueAt: string;
  createdAt: string;
  status: 'pending' | 'sent';
  sentAt?: string;
};

export type Channel = {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  allowlist: string[];
  userId?: string;
};

export type ChannelRoute = {
  channelId: string;
  conversationId: string;
  sessionId: string;
};

export type QuarantinedAttachment = {
  id: string;
  quarantinedAt: string;
  sessionId: string;
  userId?: string;
  channelId: string;
  conversationId: string;
  senderId: string;
  attachment: {
    type: 'image' | 'document';
    url: string;
    mimeType: string;
  };
  status: 'quarantined' | 'analysis_requested' | 'analyzed' | 'rejected';
  analysisRequestedAt?: string;
  analysisRequestedBy?: string;
  analysisNote?: string;
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
        type: 'fs' | 'http' | 'connector' | 'cli' | 'system' | 'memory' | 'skill';
        root?: string;
        paths?: string[];
        allowHosts?: string[];
        allowMethods?: string[];
        connectorId?: string;
        constraints?: Record<string, unknown>;
        commands?: string[];
        components?: string[];
      };
      justification: string;
      requiresConfirmation?: boolean;
    }>;
  };
  status: 'enabled' | 'disabled' | 'pending_consent' | 'emergency_disabled';
  installedAt: string;
  path: string;
  provenance?: {
    hash: string;
    signature?: string;
    publicKey?: string;
    trustLevel: 'trusted' | 'locally_trusted' | 'untrusted';
    verifiedAt?: string;
    integrityFailed?: boolean;
    integrityCheckedAt?: string;
  };
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
      type: 'fs' | 'http' | 'connector' | 'cli' | 'system' | 'memory' | 'skill';
      root?: string;
      paths?: string[];
      allowHosts?: string[];
      allowMethods?: string[];
      connectorId?: string;
      constraints?: Record<string, unknown>;
      commands?: string[];
      components?: string[];
      memoryType?: string;
      scopeIds?: string[];
      id?: string;
    };
    fields?: string[];
    requiresConfirmation?: boolean;
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

export type LLMModelOption = {
  id: string;
  name: string;
  provider: string;
  tier?: 'flagship' | 'balanced' | 'efficient';
  tags?: string[];
};

export type PlannerToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type PlannerToolResult = {
  callId: string;
  name: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type WorkerTraceEvent = {
  id: string;
  time: string;
  action: string;
  tool?: string;
  decision: 'allow' | 'deny';
  reason?: string;
  resource: {
    type: string;
    path?: string;
    root?: string;
    url?: string;
    method?: string;
    component?: string;
  };
  requestId?: string;
  messageId?: string;
  parentEventId?: string;
  metadata?: Record<string, unknown>;
};

export type WorkerTrace = {
  agentId: string;
  events: WorkerTraceEvent[];
};

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'executed' | 'failed';

export type Approval = {
  id: string;
  status: ApprovalStatus;
  jti: string;
  subject: string;
  action: string;
  sessionId?: string;
  agentId?: string;
  traceId?: string;
  parentEventId?: string;
  resource: Record<string, unknown>;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
  result?: unknown;
  error?: string;
};

export type SendMessageResponse = {
  ok: boolean;
  action?: string;
  path?: string;
  result?: { content?: string; entries?: string[] };
  toolResults?: PlannerToolResult[];
  workerAgentIds?: string[];
  workerTraces?: WorkerTrace[];
  toolCalls?: PlannerToolCall[];
  message?: { id: string; role: string; content: string };
  agentId?: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('polar_token') || 'polar-dev-token-456';

  const response = await fetch(`/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
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
  getSessions: (status?: 'active' | 'terminated') => {
    const suffix = status ? `?status=${status}` : '';
    return apiFetch<{ sessions: Session[] }>(`/sessions${suffix}`);
  },
  getChannels: () => apiFetch<{ channels: Channel[] }>('/channels'),
  getChannelRoutes: (channelId: string) => apiFetch<{ routes: ChannelRoute[] }>(`/channels/${channelId}/routes`),
  setChannelRoute: (channelId: string, payload: { conversationId: string; sessionId: string }) => apiFetch<{ ok: boolean }>(`/channels/${channelId}/routes`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }),
  getChannelAttachments: (params: { channelId?: string; sessionId?: string; status?: QuarantinedAttachment['status'] } = {}) => {
    const query = new URLSearchParams();
    if (params.channelId) query.set('channelId', params.channelId);
    if (params.sessionId) query.set('sessionId', params.sessionId);
    if (params.status) query.set('status', params.status);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiFetch<{ attachments: QuarantinedAttachment[] }>(`/channels/attachments${suffix}`);
  },
  requestAttachmentAnalysis: (attachmentId: string, note?: string) => apiFetch<{ ok: boolean; attachment: QuarantinedAttachment }>(`/channels/attachments/${attachmentId}/analyze`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  }),
  generateChannelPairingCode: () => apiFetch<{ code: string; expiresSeconds: number }>('/channels/pairing-code', {
    method: 'POST',
  }),
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
  sendMessage: (sessionId: string, message: string) => apiFetch<SendMessageResponse>(`/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  }),
  getWorkerTrace: (sessionId: string, params?: { agentIds?: string[]; from?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.agentIds && params.agentIds.length > 0) {
      query.set('agentIds', params.agentIds.join(','));
    }
    if (params?.from) {
      query.set('from', params.from);
    }
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) {
      query.set('limit', String(params.limit));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiFetch<{ traces: WorkerTrace[] }>(`/sessions/${sessionId}/worker-trace${suffix}`);
  },
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
  grantSkill: (id: string, payload?: { capabilities?: string[]; requiresConfirmationActions?: string[] }) => apiFetch<{ ok: boolean }>(`/skills/${id}/grant`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  }),
  revokeSkill: (id: string) => apiFetch<{ ok: boolean }>(`/skills/${id}/revoke`, { method: 'POST' }),
  getApprovals: (params: { sessionId?: string; status?: ApprovalStatus } = {}) => {
    const query = new URLSearchParams();
    if (params.sessionId) query.set('sessionId', params.sessionId);
    if (params.status) query.set('status', params.status);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiFetch<{ approvals: Approval[] }>(`/approvals${suffix}`);
  },
  approveApproval: (id: string) => apiFetch<{ ok: boolean; approval: Approval; result?: unknown; error?: string }>(`/approvals/${id}/approve`, {
    method: 'POST',
  }),
  denyApproval: (id: string, reason?: string) => apiFetch<{ ok: boolean; approval: Approval }>(`/approvals/${id}/deny`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }),
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

  getLLMStatus: () => apiFetch<{ status: { configured: boolean; provider: string; model: string; error?: string } }>('/llm/status'),

  getLLMModels: async (provider?: string) => {
    const query = provider ? `?provider=${provider}` : '';
    const data = await apiFetch<{ models: LLMModelOption[] }>(`/llm/models${query}`);
    return data.models;
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

  getGoalCheckIns: (status?: 'pending' | 'sent') => {
    const suffix = status ? `?status=${status}` : '';
    return apiFetch<{ checkIns: GoalCheckIn[] }>(`/preferences/checkins${suffix}`);
  },

  startOnboarding: () =>
    apiFetch<{ ok: boolean; phase: string }>('/preferences/onboarding/start', {
      method: 'POST',
    }),

  getSessionMessages: (sessionId: string) =>
    apiFetch<{ messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> }>(`/sessions/${sessionId}/messages`),

  getSystemStatus: () => apiFetch<{ status: SystemStatus }>('/system/status'),
  setEmergencyMode: (enabled: boolean, reason?: string) => apiFetch<{ ok: boolean; status: SystemStatus; terminatedWorkers: number; emergencyDisabledSkills: number }>('/system/emergency', {
    method: 'POST',
    body: JSON.stringify({ enabled, reason }),
  }),
  recoverEmergencySkills: (skillIds?: string[]) => apiFetch<{ ok: boolean; recoveredSkillIds: string[]; count: number }>('/system/emergency/recover', {
    method: 'POST',
    body: JSON.stringify({ skillIds }),
  }),
  setSkillPolicyMode: (mode: 'developer' | 'signed_only') => apiFetch<{ ok: boolean; status: SystemStatus }>('/system/policy-mode', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  }),
  getTrustedPublishers: () => apiFetch<{ publishers: TrustedPublisher[] }>('/system/trust-store'),
  addTrustedPublisher: (payload: { name: string; publicKey: string }) => apiFetch<{ ok: boolean; publisher: TrustedPublisher }>('/system/trust-store', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  removeTrustedPublisher: (id: string) => apiFetch<{ ok: boolean }>(`/system/trust-store/${id}`, {
    method: 'DELETE',
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
