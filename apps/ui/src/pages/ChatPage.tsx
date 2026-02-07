import { useEffect, useState, useRef, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  api,
  type Session,
  type PlannerToolCall,
  type PlannerToolResult,
  type SendMessageResponse,
  type WorkerTrace,
  type WorkerTraceEvent,
  type Approval,
} from '../api.js';

type ChatRole = 'user' | 'system' | 'assistant';

type PlannerTrace = {
  toolCalls?: PlannerToolCall[];
  toolResults?: PlannerToolResult[];
  workerAgentIds?: string[];
  workerTraces?: WorkerTrace[];
};

type ChatLogEntry = {
  id: string;
  role: ChatRole;
  content: string;
  trace?: PlannerTrace;
};

function createEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createLogEntry(role: ChatRole, content: string, trace?: PlannerTrace): ChatLogEntry {
  return { id: createEntryId(), role, content, ...(trace ? { trace } : {}) };
}

function toChatRole(role: string): ChatRole {
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role;
  }
  return 'system';
}

function hasTrace(trace?: PlannerTrace): boolean {
  if (!trace) return false;
  return Boolean(
    (trace.toolCalls && trace.toolCalls.length > 0) ||
    (trace.toolResults && trace.toolResults.length > 0) ||
    (trace.workerAgentIds && trace.workerAgentIds.length > 0) ||
    (trace.workerTraces && trace.workerTraces.length > 0),
  );
}

function buildTrace(data: SendMessageResponse): PlannerTrace | undefined {
  const trace: PlannerTrace = {
    ...(data.toolCalls && data.toolCalls.length > 0 ? { toolCalls: data.toolCalls } : {}),
    ...(data.toolResults && data.toolResults.length > 0 ? { toolResults: data.toolResults } : {}),
    ...(data.workerAgentIds && data.workerAgentIds.length > 0 ? { workerAgentIds: data.workerAgentIds } : {}),
    ...(data.workerTraces && data.workerTraces.length > 0 ? { workerTraces: data.workerTraces } : {}),
  };
  return hasTrace(trace) ? trace : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function formatPayload(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function mergeWorkerTraces(existing: WorkerTrace[] | undefined, updates: WorkerTrace[]): WorkerTrace[] | undefined {
  if (updates.length === 0) {
    return existing;
  }

  const map = new Map<string, WorkerTrace>();
  for (const trace of existing || []) {
    map.set(trace.agentId, { agentId: trace.agentId, events: [...trace.events] });
  }

  let changed = false;
  for (const update of updates) {
    const current = map.get(update.agentId);
    if (!current) {
      map.set(update.agentId, {
        agentId: update.agentId,
        events: [...update.events].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()),
      });
      changed = true;
      continue;
    }

    const seenIds = new Set(current.events.map((event) => event.id));
    for (const event of update.events) {
      if (!seenIds.has(event.id)) {
        current.events.push(event);
        seenIds.add(event.id);
        changed = true;
      }
    }
    current.events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }

  if (!changed) {
    return existing;
  }

  return Array.from(map.values());
}

function formatTraceTime(isoTime: string): string {
  try {
    return new Date(isoTime).toLocaleTimeString();
  } catch {
    return isoTime;
  }
}

export default function ChatPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState('');
  const [log, setLog] = useState<ChatLogEntry[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  // Load session from storage
  useEffect(() => {
    const stored = localStorage.getItem('polar-session');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSession(parsed);
      } catch (e) {
        localStorage.removeItem('polar-session');
      }
    }
  }, []);

  // Fetch history when session changes
  useEffect(() => {
    if (session) {
      api.getSessionMessages(session.id).then(data => {
        if (data.messages && data.messages.length > 0) {
          setLog(
            data.messages.map((entry) =>
              createLogEntry(toChatRole(entry.role), entry.content)
            )
          );
        } else {
          setLog([createLogEntry('system', 'Secure session established. Planning agent initialized.')]);
        }
      }).catch(err => {
        console.error('Failed to load history:', err);
      });
    }
  }, [session]);

  // Fetch Skills
  const { data: skillsData } = useQuery({
    queryKey: ['skills'],
    queryFn: api.getSkills,
    refetchInterval: 5000,
  });

  // Fetch Agents for current session
  const { data: agentsData } = useQuery({
    queryKey: ['agents', session?.id],
    queryFn: () => session ? api.getAgents(session.id) : Promise.resolve({ agents: [] }),
    enabled: !!session,
    refetchInterval: 3000,
  });

  const { data: approvalsData, refetch: refetchApprovals } = useQuery({
    queryKey: ['approvals', session?.id],
    queryFn: () => session ? api.getApprovals({ sessionId: session.id }) : Promise.resolve({ approvals: [] }),
    enabled: !!session,
    refetchInterval: 3000,
  });

  const approveMutation = useMutation({
    mutationFn: (approvalId: string) => api.approveApproval(approvalId),
    onSuccess: () => {
      refetchApprovals();
    },
    onError: (error) => {
      setLog((prev) => [...prev, createLogEntry('system', `Approval execution failed: ${(error as Error).message}`)]);
    },
  });

  const denyMutation = useMutation({
    mutationFn: (payload: { approvalId: string; reason?: string }) => api.denyApproval(payload.approvalId, payload.reason),
    onSuccess: () => {
      refetchApprovals();
    },
    onError: (error) => {
      setLog((prev) => [...prev, createLogEntry('system', `Approval denial failed: ${(error as Error).message}`)]);
    },
  });

  const trackedWorkerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of log) {
      for (const workerId of entry.trace?.workerAgentIds || []) {
        ids.add(workerId);
      }
    }
    return Array.from(ids);
  }, [log]);

  const { data: workerTraceData } = useQuery({
    queryKey: ['worker-trace', session?.id, trackedWorkerIds.join(',')],
    queryFn: () =>
      session
        ? api.getWorkerTrace(session.id, { agentIds: trackedWorkerIds, limit: 120 })
        : Promise.resolve({ traces: [] }),
    enabled: !!session && trackedWorkerIds.length > 0,
    refetchInterval: 3000,
  });

  useEffect(() => {
    const updates = workerTraceData?.traces || [];
    if (updates.length === 0) {
      return;
    }

    setLog((prev) => {
      let changed = false;
      const next = prev.map((entry) => {
        if (entry.role !== 'assistant' || !entry.trace?.workerAgentIds || entry.trace.workerAgentIds.length === 0) {
          return entry;
        }

        const relevantUpdates = updates.filter((trace) => entry.trace?.workerAgentIds?.includes(trace.agentId));
        if (relevantUpdates.length === 0) {
          return entry;
        }

        const merged = mergeWorkerTraces(entry.trace.workerTraces, relevantUpdates);
        if (merged === entry.trace.workerTraces) {
          return entry;
        }

        changed = true;
        return {
          ...entry,
          trace: {
            ...entry.trace,
            workerTraces: merged,
          },
        };
      });

      return changed ? next : prev;
    });
  }, [workerTraceData]);

  const createSessionMutation = useMutation({
    mutationFn: api.createSession,
    onSuccess: (data) => {
      setSession(data.session);
      localStorage.setItem('polar-session', JSON.stringify(data.session));
      setLog([createLogEntry('system', 'Secure session established. Planning agent initialized.')]);
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: (payload: { sessionId: string; message: string }) =>
      api.sendMessage(payload.sessionId, payload.message),
    onSuccess: (data) => {
      // Handle tool result vs general LLM response
      let output = 'Action completed.';
      if (data.result) {
        output = data.result.content ?? data.result.entries?.join('\n') ?? 'Action completed.';
      } else if (data.message?.content) {
        output = data.message.content;
      }
      const trace = buildTrace(data);
      setLog((prev) => [...prev, createLogEntry('assistant', output, trace)]);
    },
    onError: (error) => {
      const msg = (error as Error).message;
      setLog((prev) => [...prev, createLogEntry('system', `Security Alert: ${msg}`)]);

      // If session is invalid, clear it so user can start over
      if (msg.includes('Session not found')) {
        localStorage.removeItem('polar-session');
        setSession(null);
      }

      if (msg.includes('User confirmation required')) {
        refetchApprovals();
      }
    },
  });

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!session || !message.trim() || sendMessageMutation.isPending) return;

    const trimmed = message.trim();
    setLog((prev) => [...prev, createLogEntry('user', trimmed)]);
    setMessage('');
    sendMessageMutation.mutate({ sessionId: session.id, message: trimmed });
  };

  const enabledSkills = skillsData?.skills.filter(s => s.status === 'enabled') || [];
  const activeAgents = agentsData?.agents.filter(a => a.status === 'running') || [];
  const approvals = approvalsData?.approvals || [];
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');

  return (
    <div className="app-shell">
      {/* Premium Header */}
      <header className="header">
        <div className="brand">
          <h1>Polar Chat</h1>
        </div>

        <div className="header-actions" style={{ display: 'flex', gap: '12px' }}>
          {session && (
            <div className="security-status">
              <div className="dot"></div>
              Session: {session.id.slice(0, 8)}... (Secured)
            </div>
          )}
          <button
            className="secondary btn-sm"
            onClick={() => createSessionMutation.mutate({})}
            disabled={createSessionMutation.isPending}
          >
            {session ? 'Rotate Session' : 'Start Secure Session'}
          </button>
        </div>
      </header>

      {/* Main Experience Grid */}
      <main className="main-grid">

        {/* Left Sidebar: Skills */}
        <aside className="sidebar">
          <div className="sidebar-panel">
            <h3>
              Available Skills
              <span className="badge">{enabledSkills.length}</span>
            </h3>
            <div className="skill-list">
              {enabledSkills.length === 0 ? (
                <p className="mono" style={{ fontSize: '11px' }}>No skills enabled.</p>
              ) : (
                enabledSkills.map(skill => (
                  <div key={skill.manifest.id} className="skill-item">
                    <div className="skill-info">
                      <span className="skill-name">{skill.manifest.name}</span>
                      <span className="skill-status">Active</span>
                    </div>
                    <div className="skill-icon">🛡️</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="sidebar-panel">
            <h3>System Status</h3>
            <div className="metrics">
              <div className="metric">
                <label>Mode</label>
                <span style={{ color: 'var(--success)' }}>Nominal</span>
              </div>
              <div className="metric">
                <label>Active Workers</label>
                <span>{activeAgents.length}</span>
              </div>
              <div className="metric">
                <label>Audit Stream</label>
                <span>Live</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Center: Chat Experience */}
        <section className="chat-container">
          <div className="chat-history">
            {log.length === 0 && (
              <div className="empty-state">
                <div className="brand" style={{ justifyContent: 'center', marginBottom: '12px' }}>
                  <h1>Polar</h1>
                </div>
                <p>Establishing secure connection...</p>
                <div className="hint">Start a new session to begin planning.</div>
              </div>
            )}

            {log.map((entry) => (
              <div key={entry.id} className={`message ${entry.role}`}>
                <div className="message-meta">
                  {entry.role === 'user' ? 'Principal' : entry.role === 'assistant' ? 'Planner' : 'System'}
                </div>
                <div className="bubble">
                  {entry.content}
                </div>
                {entry.role === 'assistant' && hasTrace(entry.trace) && (
                  <details className="action-block">
                    <summary className="action-summary">
                      <span>Planner action trace</span>
                      <span className="action-count">
                        {(entry.trace?.toolResults?.length ?? entry.trace?.toolCalls?.length ?? 0)} call(s)
                      </span>
                    </summary>
                    <div className="action-content">
                      {entry.trace?.workerAgentIds && entry.trace.workerAgentIds.length > 0 && (
                        <div className="worker-chip-row">
                          {entry.trace.workerAgentIds.map((agentId) => (
                            <span key={agentId} className="worker-chip">{agentId.slice(0, 10)}</span>
                          ))}
                        </div>
                      )}
                      {entry.trace?.toolResults?.map((result) => {
                        const call = entry.trace?.toolCalls?.find((toolCall) => toolCall.id === result.callId);
                        const resultData = asRecord(result.data);
                        const spawnedAgentId = resultData && typeof resultData.agentId === 'string'
                          ? resultData.agentId
                          : undefined;
                        const spawnGoal = resultData && typeof resultData.goal === 'string'
                          ? resultData.goal
                          : undefined;
                        const modelHint = resultData && typeof resultData.modelHint === 'string'
                          ? resultData.modelHint
                          : undefined;
                        const readOnly = resultData && resultData.readOnly === true;
                        const capabilities = resultData && Array.isArray(resultData.capabilities)
                          ? resultData.capabilities.filter((capability): capability is string => typeof capability === 'string')
                          : [];

                        return (
                          <details key={`${entry.id}-${result.callId}`} className="action-item">
                            <summary className="action-item-summary">
                              <code>{result.name}</code>
                              <span className={`action-status ${result.ok ? 'ok' : 'fail'}`}>
                                {result.ok ? 'allow' : 'deny'}
                              </span>
                            </summary>
                            <div className="action-item-body">
                              {call && (
                                <div>
                                  <div className="action-label">Arguments</div>
                                  <pre className="action-json">{formatPayload(call.arguments)}</pre>
                                </div>
                              )}
                              {result.name === 'worker.spawn' && result.ok && (
                                <div className="spawn-metadata">
                                  {spawnedAgentId && (
                                    <div className="action-label">Worker</div>
                                  )}
                                  {spawnedAgentId && (
                                    <code className="inline-code">{spawnedAgentId}</code>
                                  )}
                                  {spawnGoal && (
                                    <>
                                      <div className="action-label">Goal</div>
                                      <div className="action-text">{spawnGoal}</div>
                                    </>
                                  )}
                                  {(modelHint || readOnly || capabilities.length > 0) && (
                                    <>
                                      <div className="action-label">Granted execution profile</div>
                                      <div className="spawn-profile">
                                        {modelHint && <span className="worker-chip">model: {modelHint}</span>}
                                        {readOnly && <span className="worker-chip">read-only</span>}
                                        {capabilities.map((capability) => (
                                          <span key={capability} className="worker-chip">{capability}</span>
                                        ))}
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                              <div className="action-label">{result.ok ? 'Result' : 'Error'}</div>
                              <pre className="action-json">
                                {result.ok
                                  ? formatPayload(result.data ?? { ok: true })
                                  : formatPayload({ error: result.error ?? 'Unknown failure' })}
                              </pre>
                            </div>
                          </details>
                        );
                      })}
                      {entry.trace?.workerAgentIds?.map((agentId) => {
                        const workerTrace = entry.trace?.workerTraces?.find((trace) => trace.agentId === agentId);
                        const events = workerTrace?.events || [];

                        return (
                          <details key={`${entry.id}-worker-${agentId}`} className="worker-trace-block">
                            <summary className="worker-trace-summary">
                              <span>Worker {agentId.slice(0, 10)}</span>
                              <span className="action-count">{events.length} downstream event(s)</span>
                            </summary>
                            <div className="worker-trace-body">
                              {events.length === 0 && (
                                <div className="worker-empty">No downstream worker activity recorded yet.</div>
                              )}
                              {events.map((event: WorkerTraceEvent) => (
                                <div key={event.id} className="worker-event">
                                  <div className="worker-event-header">
                                    <code>{event.action}</code>
                                    <span className={`action-status ${event.decision === 'allow' ? 'ok' : 'fail'}`}>
                                      {event.decision}
                                    </span>
                                  </div>
                                  <div className="worker-event-meta">{formatTraceTime(event.time)}</div>
                                  {event.reason && (
                                    <>
                                      <div className="action-label">Reason</div>
                                      <div className="action-text">{event.reason}</div>
                                    </>
                                  )}
                                  <div className="action-label">Resource</div>
                                  <pre className="action-json">{formatPayload(event.resource)}</pre>
                                  {event.metadata && (
                                    <>
                                      <div className="action-label">Metadata</div>
                                      <pre className="action-json">{formatPayload(event.metadata)}</pre>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </details>
                )}
              </div>
            ))}

            {sendMessageMutation.isPending && (
              <div className="message assistant">
                <div className="message-meta">Planner</div>
                <div className="bubble" style={{ opacity: 0.7 }}>
                  Orchestrating workers...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input Area */}
          <form className="chat-input-area" onSubmit={handleSend}>
            <div className="input-container">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={session ? "Request an action or ask a question..." : "Start a session to chat"}
                disabled={!session || sendMessageMutation.isPending}
              />
              <button type="submit" disabled={!session || sendMessageMutation.isPending || !message.trim()}>
                {sendMessageMutation.isPending ? '...' : 'Send'}
              </button>
            </div>
          </form>
        </section>

        {/* Right Sidebar: Active Context/Agents */}
        <aside className="sidebar">
          <div className="sidebar-panel">
            <h3>Active Workers</h3>
            <div className="skill-list">
              {activeAgents.length === 0 ? (
                <p className="mono" style={{ fontSize: '11px' }}>No active workers.</p>
              ) : (
                activeAgents.map(agent => (
                  <div key={agent.id} className="skill-item" style={{ borderColor: 'var(--accent)' }}>
                    <div className="skill-info">
                      <span className="skill-name">Worker: {agent.id.slice(0, 6)}</span>
                      <span className="skill-status" style={{ color: 'var(--accent)' }}>Running</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="sidebar-panel">
            <h3>
              Pending Approvals
              <span className="badge">{pendingApprovals.length}</span>
            </h3>
            <div className="skill-list">
              {pendingApprovals.length === 0 ? (
                <p className="mono" style={{ fontSize: '11px' }}>No pending approvals.</p>
              ) : (
                pendingApprovals.map((approval: Approval) => (
                  <div key={approval.id} className="skill-item" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: '8px' }}>
                    <div className="skill-info">
                      <span className="skill-name">{approval.action}</span>
                      <span className="skill-status">Waiting for confirmation</span>
                    </div>
                    <div className="mono" style={{ fontSize: '10px', lineHeight: '1.4' }}>
                      ID: {approval.id.slice(0, 8)}<br />
                      Subject: {approval.subject}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="btn-small primary"
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(approval.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="btn-small danger"
                        disabled={denyMutation.isPending}
                        onClick={() => denyMutation.mutate({ approvalId: approval.id })}
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="sidebar-panel">
            <h3>Audit Integrity</h3>
            <p className="mono" style={{ fontSize: '10px', lineHeight: '1.4' }}>
              All actions are cryptographically chained and stored in the immutable audit trail.
            </p>
          </div>
        </aside>

      </main>
    </div>
  );
}
