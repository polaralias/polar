import { useState, useEffect } from 'react';
import { Skill, fetchSkills, enableSkill, disableSkill, installSkill, grantSkill, revokeSkill } from '../api.js';

export default function SkillsPage() {
    const [skills, setSkills] = useState<Skill[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [installPath, setInstallPath] = useState('');
    const [loading, setLoading] = useState(false);

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
            await grantSkill(id);
            loadSkills();
        } catch (err) {
            setError((err as Error).message);
        }
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
                                <button className="primary" onClick={() => handleGrant(skill.manifest.id)}>
                                    Grant &amp; Enable
                                </button>
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
