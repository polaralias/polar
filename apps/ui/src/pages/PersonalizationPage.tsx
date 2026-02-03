import { useState, useEffect } from 'react';
import { api } from '../api.js';

// Types from API
type Goal = {
    id: string;
    description: string;
    category: 'professional' | 'personal' | 'learning';
    createdAt: string;
    checkInScheduled: boolean;
};

type UserPreferences = {
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
        goals: Goal[];
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
};

export default function PersonalizationPage() {
    const [prefs, setPrefs] = useState<UserPreferences | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Form state
    const [aboutUser, setAboutUser] = useState('');
    const [responseStyle, setResponseStyle] = useState('');
    const [workRole, setWorkRole] = useState('');
    const [workIndustry, setWorkIndustry] = useState('');
    const [workHours, setWorkHours] = useState('');
    const [timezone, setTimezone] = useState('');

    // New goal
    const [newGoalDesc, setNewGoalDesc] = useState('');
    const [newGoalCategory, setNewGoalCategory] = useState<'professional' | 'personal' | 'learning'>('professional');

    useEffect(() => {
        loadPreferences();
    }, []);

    async function loadPreferences() {
        try {
            setLoading(true);
            setError(null);
            const data = await api.getPreferences();
            setPrefs(data);

            // Populate form
            setAboutUser(data.customInstructions.aboutUser || '');
            setResponseStyle(data.customInstructions.responseStyle || '');
            setWorkRole(data.userContext.work.role || '');
            setWorkIndustry(data.userContext.work.industry || '');
            setWorkHours(data.userContext.work.typicalHours || '');
            setTimezone(data.userContext.work.timezone || '');
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }

    async function handleSaveInstructions() {
        try {
            setSaving(true);
            setError(null);
            await api.updateCustomInstructions({ aboutUser, responseStyle });
            setSuccess('Custom instructions saved!');
            setTimeout(() => setSuccess(null), 3000);
            await loadPreferences();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function handleSaveContext() {
        try {
            setSaving(true);
            setError(null);

            // Build work object only with non-empty values
            const work: { role?: string; industry?: string; typicalHours?: string; timezone?: string } = {};
            if (workRole) work.role = workRole;
            if (workIndustry) work.industry = workIndustry;
            if (workHours) work.typicalHours = workHours;
            if (timezone) work.timezone = timezone;

            await api.updateUserContext({ work });
            setSuccess('Work context saved!');
            setTimeout(() => setSuccess(null), 3000);
            await loadPreferences();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function handleToggleEnabled() {
        if (!prefs) return;
        try {
            setSaving(true);
            await api.setPersonalizationEnabled(!prefs.enabled);
            await loadPreferences();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function handleAddGoal() {
        if (!newGoalDesc.trim()) return;
        try {
            setSaving(true);
            await api.addGoal({ description: newGoalDesc, category: newGoalCategory });
            setNewGoalDesc('');
            setSuccess('Goal added!');
            setTimeout(() => setSuccess(null), 3000);
            await loadPreferences();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function handleRemoveGoal(goalId: string) {
        try {
            setSaving(true);
            await api.removeGoal(goalId);
            await loadPreferences();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <div className="loading-state">Loading preferences...</div>;
    }

    return (
        <div className="intelligence-page">
            <div className="page-header">
                <h2>Personalization</h2>
                <p>Customize how the assistant behaves and what it knows about you.</p>
            </div>

            {error && <div className="error-banner">{error}</div>}
            {success && <div className="success-banner">{success}</div>}

            {/* Master Toggle */}
            <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3>Personalization Active</h3>
                        <p className="card-description">
                            When enabled, your custom instructions and context are included in every conversation.
                        </p>
                    </div>
                    <button
                        className={`btn-small ${prefs?.enabled ? 'primary' : ''}`}
                        onClick={handleToggleEnabled}
                        disabled={saving}
                    >
                        {prefs?.enabled ? '✓ Enabled' : 'Disabled'}
                    </button>
                </div>
            </div>

            {/* Custom Instructions */}
            <div className="card">
                <h3>Custom Instructions</h3>
                <p className="card-description">
                    These are injected into every conversation. They help the assistant understand you better.
                </p>

                <div className="config-form">
                    <div className="form-group">
                        <label>About You</label>
                        <textarea
                            value={aboutUser}
                            onChange={(e) => setAboutUser(e.target.value)}
                            placeholder="Tell the assistant about yourself...&#10;Example: I'm a software engineer who prefers TypeScript. I work on cloud infrastructure."
                            rows={4}
                            style={{
                                width: '100%',
                                background: 'rgba(0, 0, 0, 0.2)',
                                border: '1px solid var(--panel-border)',
                                borderRadius: '10px',
                                padding: '12px 16px',
                                color: 'white',
                                fontSize: '14px',
                                resize: 'vertical',
                            }}
                        />
                        <span className="form-hint">
                            {aboutUser.length}/2000 characters • Facts the assistant should know about you
                        </span>
                    </div>

                    <div className="form-group">
                        <label>Response Style</label>
                        <textarea
                            value={responseStyle}
                            onChange={(e) => setResponseStyle(e.target.value)}
                            placeholder="How should the assistant respond?&#10;Example: Be concise. Use bullet points when listing things. No yapping."
                            rows={3}
                            style={{
                                width: '100%',
                                background: 'rgba(0, 0, 0, 0.2)',
                                border: '1px solid var(--panel-border)',
                                borderRadius: '10px',
                                padding: '12px 16px',
                                color: 'white',
                                fontSize: '14px',
                                resize: 'vertical',
                            }}
                        />
                        <span className="form-hint">
                            {responseStyle.length}/1000 characters • How you want responses formatted
                        </span>
                    </div>

                    <div className="save-section">
                        <button
                            className="btn-primary"
                            onClick={handleSaveInstructions}
                            disabled={saving}
                        >
                            {saving ? 'Saving...' : 'Save Instructions'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Work Context */}
            <div className="card">
                <h3>Work Context</h3>
                <p className="card-description">
                    Help the assistant understand your professional life for better scheduling and context.
                </p>

                <div className="config-form">
                    <div className="form-row">
                        <div className="form-group">
                            <label>Role / Title</label>
                            <input
                                type="text"
                                value={workRole}
                                onChange={(e) => setWorkRole(e.target.value)}
                                placeholder="e.g., Senior Engineer, Product Manager"
                            />
                        </div>
                        <div className="form-group">
                            <label>Industry</label>
                            <input
                                type="text"
                                value={workIndustry}
                                onChange={(e) => setWorkIndustry(e.target.value)}
                                placeholder="e.g., FinTech, Healthcare"
                            />
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label>Typical Hours</label>
                            <input
                                type="text"
                                value={workHours}
                                onChange={(e) => setWorkHours(e.target.value)}
                                placeholder="e.g., 9 AM - 5 PM"
                            />
                        </div>
                        <div className="form-group">
                            <label>Timezone</label>
                            <input
                                type="text"
                                value={timezone}
                                onChange={(e) => setTimezone(e.target.value)}
                                placeholder="e.g., America/New_York, Europe/London"
                            />
                        </div>
                    </div>

                    <div className="save-section">
                        <button
                            className="btn-primary"
                            onClick={handleSaveContext}
                            disabled={saving}
                        >
                            {saving ? 'Saving...' : 'Save Work Context'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Goals */}
            <div className="card">
                <h3>Goals & Projects</h3>
                <p className="card-description">
                    Track your active goals. The assistant can check in on these periodically.
                </p>

                {/* Goal list */}
                <div className="provider-status-grid" style={{ marginBottom: '20px' }}>
                    {prefs?.userContext.goals.map((goal) => (
                        <div key={goal.id} className="provider-status-item">
                            <div className="provider-status-header">
                                <span className="provider-name">
                                    {goal.category === 'professional' && '💼'}
                                    {goal.category === 'personal' && '🏠'}
                                    {goal.category === 'learning' && '📚'}{' '}
                                    {goal.category.charAt(0).toUpperCase() + goal.category.slice(1)}
                                </span>
                                <button
                                    className="btn-small danger"
                                    onClick={() => handleRemoveGoal(goal.id)}
                                    disabled={saving}
                                >
                                    Remove
                                </button>
                            </div>
                            <p className="provider-desc">{goal.description}</p>
                            <div className="status-indicator not-configured" style={{ fontSize: '11px' }}>
                                Added {new Date(goal.createdAt).toLocaleDateString()}
                            </div>
                        </div>
                    ))}

                    {(!prefs?.userContext.goals || prefs.userContext.goals.length === 0) && (
                        <p className="mono" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                            No goals added yet. Add some to help the assistant track your progress!
                        </p>
                    )}
                </div>

                {/* Add Goal */}
                <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '20px' }}>
                    <h4 style={{ marginBottom: '12px', fontSize: '14px' }}>Add New Goal</h4>
                    <div className="config-form">
                        <div className="form-row">
                            <div className="form-group" style={{ flex: 2 }}>
                                <label>Description</label>
                                <input
                                    type="text"
                                    value={newGoalDesc}
                                    onChange={(e) => setNewGoalDesc(e.target.value)}
                                    placeholder="e.g., Learn Rust, Complete the Q1 project"
                                />
                            </div>
                            <div className="form-group">
                                <label>Category</label>
                                <select
                                    value={newGoalCategory}
                                    onChange={(e) => setNewGoalCategory(e.target.value as 'professional' | 'personal' | 'learning')}
                                    style={{
                                        background: 'rgba(0, 0, 0, 0.2)',
                                        border: '1px solid var(--panel-border)',
                                        borderRadius: '10px',
                                        padding: '12px 16px',
                                        color: 'white',
                                        fontSize: '14px',
                                    }}
                                >
                                    <option value="professional">💼 Professional</option>
                                    <option value="personal">🏠 Personal</option>
                                    <option value="learning">📚 Learning</option>
                                </select>
                            </div>
                        </div>
                        <button
                            className="btn-small primary"
                            onClick={handleAddGoal}
                            disabled={saving || !newGoalDesc.trim()}
                        >
                            Add Goal
                        </button>
                    </div>
                </div>
            </div>

            {/* Onboarding Status */}
            <div className="card">
                <h3>Onboarding Status</h3>
                <p className="card-description">
                    The onboarding process helps the assistant get to know you during your first conversations.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: prefs?.onboarding.completed
                            ? 'linear-gradient(135deg, var(--success), rgba(16, 185, 129, 0.5))'
                            : prefs?.onboarding.phase === 'in_progress'
                                ? 'linear-gradient(135deg, var(--accent), rgba(99, 102, 241, 0.5))'
                                : 'rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '24px',
                    }}>
                        {prefs?.onboarding.completed ? '✓' : prefs?.onboarding.phase === 'in_progress' ? '⏳' : '○'}
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                            {prefs?.onboarding.completed
                                ? 'Onboarding Complete'
                                : prefs?.onboarding.phase === 'in_progress'
                                    ? 'Onboarding In Progress'
                                    : 'Not Started'}
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                            {prefs?.onboarding.completed && prefs.onboarding.completedAt
                                ? `Completed on ${new Date(prefs.onboarding.completedAt).toLocaleDateString()}`
                                : prefs?.onboarding.phase === 'in_progress'
                                    ? `Topics covered: ${prefs.onboarding.coveredTopics.join(', ') || 'none yet'}`
                                    : 'Start chatting to begin!'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
