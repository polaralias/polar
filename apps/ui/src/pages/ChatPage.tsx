import { useEffect, useState, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type Session, type Skill, type Agent } from '../api';

export default function ChatPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState('');
  const [log, setLog] = useState<Array<{ role: 'user' | 'system' | 'assistant'; content: string }>>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  // Load session from storage
  useEffect(() => {
    const stored = localStorage.getItem('polar-session');
    if (stored) {
      setSession(JSON.parse(stored));
    }
  }, []);

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

  const createSessionMutation = useMutation({
    mutationFn: api.createSession,
    onSuccess: (data) => {
      setSession(data.session);
      localStorage.setItem('polar-session', JSON.stringify(data.session));
      setLog([{ role: 'system', content: 'Secure session established. Planning agent initialized.' }]);
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: (payload: { sessionId: string; message: string }) =>
      api.sendMessage(payload.sessionId, payload.message),
    onSuccess: (data) => {
      const output = data.result.content ?? data.result.entries?.join('\n') ?? 'Action completed.';
      setLog((prev) => [...prev, { role: 'assistant', content: output }]);
    },
    onError: (error) => {
      setLog((prev) => [...prev, { role: 'system', content: `Security Alert: ${(error as Error).message}` }]);
    },
  });

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!session || !message.trim() || sendMessageMutation.isPending) return;

    const trimmed = message.trim();
    setLog((prev) => [...prev, { role: 'user', content: trimmed }]);
    setMessage('');
    sendMessageMutation.mutate({ sessionId: session.id, message: trimmed });
  };

  const enabledSkills = skillsData?.skills.filter(s => s.status === 'enabled') || [];
  const activeAgents = agentsData?.agents.filter(a => a.status === 'running') || [];

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

            {log.map((entry, index) => (
              <div key={index} className={`message ${entry.role}`}>
                <div className="message-meta">
                  {entry.role === 'user' ? 'Principal' : entry.role === 'assistant' ? 'Planner' : 'System'}
                </div>
                <div className="bubble">
                  {entry.content}
                </div>
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
