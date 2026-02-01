import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { createSession, sendMessage, type Session } from '../api';

export default function ChatPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState('');
  const [log, setLog] = useState<Array<{ role: 'user' | 'system'; content: string }>>([]);

  useEffect(() => {
    const stored = localStorage.getItem('polar-session');
    if (stored) {
      setSession(JSON.parse(stored));
    }
  }, []);

  const createSessionMutation = useMutation({
    mutationFn: createSession,
    onSuccess: (data) => {
      setSession(data);
      localStorage.setItem('polar-session', JSON.stringify(data));
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: (payload: { sessionId: string; message: string }) =>
      sendMessage(payload.sessionId, payload.message),
    onSuccess: (data) => {
      const output = data.result.content ?? data.result.entries?.join('\n') ?? 'No output';
      setLog((prev) => [...prev, { role: 'system', content: output }]);
    },
    onError: (error) => {
      setLog((prev) => [...prev, { role: 'system', content: (error as Error).message }]);
    },
  });

  const handleSend = () => {
    if (!session || !message.trim()) return;
    const trimmed = message.trim();
    setLog((prev) => [...prev, { role: 'user', content: trimmed }]);
    setMessage('');
    sendMessageMutation.mutate({ sessionId: session.id, message: trimmed });
  };

  return (
    <div className="grid two">
      <section className="panel">
        <h2 className="section-title">Session</h2>
        <p className="mono">Subject: {session?.subject ?? 'not started'}</p>
        <p className="mono">Session ID: {session?.id ?? 'none'}</p>
        <button
          type="button"
          onClick={() => createSessionMutation.mutate()}
          disabled={createSessionMutation.isPending}
        >
          {session ? 'New Session' : 'Create Session'}
        </button>
      </section>

      <section className="panel">
        <h2 className="section-title">Send Message</h2>
        <p className="mono">Try: read file sandbox/allowed/a.txt</p>
        <div className="form-row">
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="read file sandbox/allowed/a.txt"
          />
          <button type="button" onClick={handleSend} disabled={!session}>
            Send
          </button>
        </div>
      </section>

      <section className="panel" style={{ gridColumn: '1 / -1' }}>
        <h2 className="section-title">Conversation</h2>
        <div className="chat-log">
          {log.length === 0 ? (
            <p className="mono">No messages yet.</p>
          ) : (
            log.map((entry, index) => (
              <div key={`${entry.role}-${index}`} className={`chat-bubble ${entry.role}`}>
                <strong>{entry.role === 'user' ? 'You' : 'Runtime'}</strong>
                <div className="mono" style={{ whiteSpace: 'pre-wrap' }}>
                  {entry.content}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
