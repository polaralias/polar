import { useState, useEffect } from 'react';
import { Skill, fetchSkills, enableSkill, disableSkill, installSkill, grantSkill, revokeSkill } from '../api.js';

export default function SkillsPage() {
    const [skills, setSkills] = useState<Skill[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [installPath, setInstallPath] = useState('');
    const [loading, setLoading] = useState(false);
    const [grantConfig, setGrantConfig] = useState<Record<string, { selected: string[]; requiresConfirmation: string[] }>>({});

    const loadSkills = async () => {
        try {
            const data = await fetchSkills();
            setSkills(data);
        } catch (err) {
            setError((err as Error).message);
        }
    };

    useEffect(() => {
        loadSkills();
        const interval = setInterval(loadSkills, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        setGrantConfig((prev) => {
            const next = { ...prev };
            for (const skill of skills) {
                if (!next[skill.manifest.id]) {
                    const selected = skill.manifest.requestedCapabilities.map((cap) => cap.action);
                    const requiresConfirmation = skill.manifest.requestedCapabilities
                        .filter((cap) => cap.requiresConfirmation)
                        .map((cap) => cap.action);
                    next[skill.manifest.id] = { selected, requiresConfirmation };
                }
            }
            return next;
        });
    }, [skills]);

    const handleToggle = async (id: string, currentStatus: Skill['status']) => {
        try {
            if (currentStatus === 'enabled') {
                await disableSkill(id);
            } else {
                await enableSkill(id);
            }
            loadSkills();
        } catch (err) {
            setError((err as Error).message);
        }
    };

    const handleGrant = async (id: string) => {
        try {
            const config = grantConfig[id];
            const selected = config?.selected || [];
            const requiresConfirmation = (config?.requiresConfirmation || []).filter(action => selected.includes(action));
            await grantSkill(id, { capabilities: selected, requiresConfirmationActions: requiresConfirmation });
            loadSkills();
        } catch (err) {
            setError((err as Error).message);
        }
    };

    const toggleCapability = (skillId: string, action: string) => {
        setGrantConfig((prev) => {
            const current = prev[skillId] || { selected: [], requiresConfirmation: [] };
            const isSelected = current.selected.includes(action);
            const selected = isSelected
                ? current.selected.filter((item) => item !== action)
                : [...current.selected, action];
            const requiresConfirmation = selected.includes(action)
                ? current.requiresConfirmation
                : current.requiresConfirmation.filter((item) => item !== action);
            return { ...prev, [skillId]: { selected, requiresConfirmation } };
        });
    };

    const toggleRequiresConfirmation = (skillId: string, action: string) => {
        setGrantConfig((prev) => {
            const current = prev[skillId] || { selected: [], requiresConfirmation: [] };
            const selected = current.selected.includes(action) ? current.selected : [...current.selected, action];
            const enabled = current.requiresConfirmation.includes(action);
            const requiresConfirmation = enabled
                ? current.requiresConfirmation.filter((item) => item !== action)
                : [...current.requiresConfirmation, action];
            return { ...prev, [skillId]: { selected, requiresConfirmation } };
        });
    };

    const handleRevoke = async (id: string) => {
        try {
            await revokeSkill(id);
            loadSkills();
        } catch (err) {
            setError((err as Error).message);
        }
    };

    const handleInstall = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!installPath) return;
        setLoading(true);
        setError(null);
        try {
            await installSkill(installPath);
            setInstallPath('');
            loadSkills();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="page">
            <header className="page-header">
                <h2>Skill Library</h2>
                <p>Extend Polar's capabilities with permission-bound skills.</p>
            </header>

            {error && <div className="error-banner">{error}</div>}

            <div className="card install-card">
                <h3>Install Local Skill</h3>
                <form onSubmit={handleInstall} className="install-form">
                    <input
                        type="text"
                        placeholder="Absolute path to skill directory"
                        value={installPath}
                        onChange={(e) => setInstallPath(e.target.value)}
                    />
                    <button type="submit" disabled={loading}>
                        {loading ? 'Installing...' : 'Install'}
                    </button>
                </form>
            </div>

            <div className="skill-grid">
                {skills.map((skill: Skill) => (
                    <div key={skill.manifest.id} className={`card skill-card ${skill.status}`}>
                        <div className="skill-header">
                            <h4>{skill.manifest.name}</h4>
                            <span className={`badge ${skill.status}`}>{skill.status.replace('_', ' ')}</span>
                        </div>
                        <p className="skill-desc">{skill.manifest.description}</p>
                        <div className="skill-meta">
                            <span>Version: {skill.manifest.version}</span>
                            <span>ID: {skill.manifest.id}</span>
                        </div>

                        <div className="skill-section">
                            <h5>Requested Permissions</h5>
                            <ul className="caps-list">
                                {skill.manifest.requestedCapabilities.map((cap: Skill['manifest']['requestedCapabilities'][number], i: number) => (
                                    <li key={i} title={cap.justification}>
                                        <code>{cap.action}</code> → <code>{cap.resource.root || '*'}</code>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="skill-section">
                            <h5>Tools</h5>
                            <div className="tools-tags">
                                {skill.manifest.workerTemplates.map((t: Skill['manifest']['workerTemplates'][number]) => (
                                    <span key={t.id} className="tag" title={t.description}>{t.name}</span>
                                ))}
                            </div>
                        </div>

                        <div className="skill-actions">
                            {skill.status === 'pending_consent' ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {skill.manifest.requestedCapabilities.map((cap) => {
                                            const selected = grantConfig[skill.manifest.id]?.selected?.includes(cap.action) ?? true;
                                            const requiresConfirmation = grantConfig[skill.manifest.id]?.requiresConfirmation?.includes(cap.action)
                                                ?? Boolean(cap.requiresConfirmation);
                                            return (
                                                <div key={`${skill.manifest.id}-${cap.action}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selected}
                                                            onChange={() => toggleCapability(skill.manifest.id, cap.action)}
                                                        />
                                                        <code>{cap.action}</code>
                                                    </label>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={requiresConfirmation}
                                                            onChange={() => toggleRequiresConfirmation(skill.manifest.id, cap.action)}
                                                        />
                                                        Require Approval
                                                    </label>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <button className="primary" onClick={() => handleGrant(skill.manifest.id)}>
                                        Grant &amp; Enable
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <button onClick={() => handleToggle(skill.manifest.id, skill.status)}>
                                        {skill.status === 'enabled' ? 'Disable' : 'Enable'}
                                    </button>
                                    <button className="danger" onClick={() => handleRevoke(skill.manifest.id)}>
                                        Revoke Permissions
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
