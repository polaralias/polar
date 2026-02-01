import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAudit, type AuditEvent } from '../api';

export default function AuditPage() {
  const [decision, setDecision] = useState<string>('');
  const [tool, setTool] = useState<string>('');
  const [subject, setSubject] = useState<string>('');

  const queryParams = useMemo(
    () => ({
      decision: decision || undefined,
      tool: tool || undefined,
      subject: subject || undefined,
      limit: '200',
    }),
    [decision, tool, subject],
  );

  const { data = [], isLoading } = useQuery({
    queryKey: ['audit', queryParams],
    queryFn: () => fetchAudit(queryParams),
    refetchInterval: 2000,
  });

  return (
    <div className="panel">
      <h2 className="section-title">Audit Timeline</h2>
      <div className="form-row" style={{ marginBottom: 16 }}>
        <select value={decision} onChange={(event) => setDecision(event.target.value)}>
          <option value="">All decisions</option>
          <option value="allow">Allowed</option>
          <option value="deny">Denied</option>
        </select>
        <input
          value={tool}
          onChange={(event) => setTool(event.target.value)}
          placeholder="Tool (fs.readFile)"
        />
        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Subject"
        />
      </div>

      {isLoading ? (
        <p className="mono">Loading audit events...</p>
      ) : data.length === 0 ? (
        <p className="mono">No audit events yet.</p>
      ) : (
        <div className="timeline">
          {data
            .slice()
            .reverse()
            .map((event: AuditEvent) => (
              <div key={event.id} className="timeline-item">
                <div className="form-row" style={{ alignItems: 'center' }}>
                  <span className={`badge ${event.decision}`}>{event.decision}</span>
                  <strong>{event.tool ?? event.action}</strong>
                  <span className="mono">{new Date(event.time).toLocaleString()}</span>
                </div>
                <div className="mono">Subject: {event.subject}</div>
                <div className="mono">Path: {event.resource.path ?? 'n/a'}</div>
                {event.reason && <div className="mono">Reason: {event.reason}</div>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
