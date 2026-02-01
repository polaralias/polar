import React, { useEffect, useState } from 'react';
import { Agent, fetchAgents, terminateAgent, spawnAgent, proposeCoordination, AgentRole } from '../api.js';

export const AgentsPage: React.FC<{ sessionId: string }> = ({ sessionId }) => {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadAgents = async () => {
        try {
            const data = await fetchAgents(sessionId);
            setAgents(data);
            setError(null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAgents();
        const interval = setInterval(loadAgents, 3000);
        return () => clearInterval(interval);
    }, [sessionId]);

    const handleTerminate = async (agentId: string) => {
        try {
            await terminateAgent(sessionId, agentId, 'User requested termination');
            loadAgents();
        } catch (err) {
            alert((err as Error).message);
        }
    };

    const handleSpawnMain = async () => {
        try {
            await spawnAgent(sessionId, { role: 'main' });
            loadAgents();
        } catch (err) {
            alert((err as Error).message);
        }
    };

    const handleSpawnWorker = async () => {
        try {
            await spawnAgent(sessionId, { role: 'worker', metadata: { task: 'Manual test task' } });
            loadAgents();
        } catch (err) {
            alert((err as Error).message);
        }
    };

    return (
        <div className="page-container">
            <header className="page-header">
                <h1>Agent Control Plane</h1>
                <div className="header-actions">
                    <button onClick={handleSpawnMain} className="btn-primary">Spawn Main Agent</button>
                    <button onClick={handleSpawnWorker} className="btn-secondary">Spawn Worker Agent</button>
                </div>
            </header>

            {error && <div className="error-banner">{error}</div>}

            <div className="agents-grid">
                {agents.length === 0 && !loading && (
                    <div className="empty-state">No active agents in this session.</div>
                )}

                {agents.map((agent: any) => (
                    <div key={agent.id} className={`agent-card status-${agent.status}`}>
                        <div className="agent-card-header">
                            <span className={`role-badge role-${agent.role}`}>{agent.role}</span>
                            <span className="agent-status-label">{agent.status}</span>
                        </div>

                        <div className="agent-info">
                            <p><strong>ID:</strong> {agent.id.slice(0, 8)}</p>
                            <p><strong>Created:</strong> {new Date(agent.createdAt).toLocaleTimeString()}</p>
                            {agent.skillId && <p><strong>Skill:</strong> {String(agent.skillId)}</p>}
                            {agent.metadata?.task && <p><strong>Task:</strong> {String(agent.metadata.task)}</p>}
                        </div>

                        <div className="agent-actions">
                            {agent.status === 'running' && (
                                <button
                                    onClick={() => handleTerminate(agent.id)}
                                    className="btn-danger btn-sm"
                                >
                                    Terminate
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <section className="coordination-section">
                <h2>Coordination Patterns</h2>
                <div className="pattern-cards">
                    <div className="pattern-card">
                        <h3>Fan-out / Fan-in</h3>
                        <p>Distribute independent tasks to multiple workers.</p>
                        <button
                            disabled={agents.filter(a => a.role === 'main').length === 0}
                            onClick={() => proposeCoordination(sessionId, {
                                pattern: 'fan-out-fan-in',
                                initiatorAgentId: agents.find(a => a.role === 'main')?.id || '',
                                targetSpecs: [
                                    { role: 'worker', metadata: { task: 'Scan sub-dir A' } },
                                    { role: 'worker', metadata: { task: 'Scan sub-dir B' } }
                                ]
                            })}
                            className="btn-outline btn-sm"
                        >
                            Simulate Fan-out
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
};
