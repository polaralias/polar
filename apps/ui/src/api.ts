export type Session = {
  id: string;
  createdAt: string;
  subject: string;
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
  };
  sessionId?: string;
  requestId?: string;
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
      type: 'fs';
      root?: string;
      paths?: string[];
    };
    reason?: string;
  }>;
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

export async function createSession(): Promise<Session> {
  const data = await apiFetch<{ session: Session }>('/sessions', { method: 'POST' });
  return data.session;
}

export async function sendMessage(sessionId: string, message: string) {
  return apiFetch<{
    ok: boolean;
    action: string;
    path: string;
    result: { content?: string; entries?: string[] };
  }>(`/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export async function fetchAudit(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const data = await apiFetch<{ events: AuditEvent[] }>(`/audit?${query.toString()}`);
  return data.events;
}

export async function fetchPolicy() {
  const data = await apiFetch<{ policy: PolicyStore }>('/permissions');
  return data.policy;
}

export async function updatePolicy(policy: PolicyStore) {
  return apiFetch<{ ok: boolean }>('/permissions', {
    method: 'POST',
    body: JSON.stringify({ policy }),
  });
}
