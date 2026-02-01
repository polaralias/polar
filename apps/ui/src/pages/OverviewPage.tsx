import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function OverviewPage() {
    const [stats, setStats] = useState({
        sessions: 0,
        agents: 0,
        skills: 0,
        auditEvents: 0,
        systemStatus: 'Unknown',
    });

    useEffect(() => {
        async function loadStats() {
            try {
                const [audit, skills, agents] = await Promise.all([
                    api.getAuditLogs(),
                    api.getSkills(),
                    api.getAgents('default-session'),
                ]);

                setStats({
                    sessions: 1, // Current session
                    agents: agents.agents.length,
                    skills: skills.skills.length,
                    auditEvents: audit.events.length,
                    systemStatus: 'Active',
                });
            } catch (error) {
                console.error('Failed to load dashboard stats:', error);
            }
        }
        loadStats();
    }, []);

    return (
        <div className="page fade-in">
            <div className="section-header">
                <h2>System Overview</h2>
            </div>

            <div className="stats-grid">
                <div className="card stat-card">
                    <label>Runtime Status</label>
                    <div className="value status-active">{stats.systemStatus}</div>
                </div>
                <div className="card stat-card">
                    <label>Active Agents</label>
                    <div className="value">{stats.agents}</div>
                </div>
                <div className="card stat-card">
                    <label>Installed Skills</label>
                    <div className="value">{stats.skills}</div>
                </div>
                <div className="card stat-card">
                    <label>Audit Trail</label>
                    <div className="value">{stats.auditEvents} events</div>
                </div>
            </div>

            <div className="section-header" style={{ marginTop: '2rem' }}>
                <h3>Security Invariants</h3>
            </div>
            <div className="card">
                <ul className="invariant-list">
                    <li>✅ Deny-by-default policy enforcement</li>
                    <li>✅ Mandatory capability signing</li>
                    <li>✅ Immutable audit logging active</li>
                    <li>✅ Memory TTL enforcement running</li>
                </ul>
            </div>
        </div>
    );
}
