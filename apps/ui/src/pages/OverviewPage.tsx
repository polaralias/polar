import { useEffect, useMemo, useState } from 'react';
import { api, type Skill, type SystemStatus, type TrustedPublisher } from '../api.js';

type DashboardStats = {
  sessions: number;
  agents: number;
  skills: number;
  auditEvents: number;
};

const defaultStatus: SystemStatus = {
  mode: 'normal',
  lastModeChange: new Date(0).toISOString(),
  skillPolicyMode: 'developer',
};

export default function OverviewPage() {
  const [stats, setStats] = useState<DashboardStats>({
    sessions: 0,
    agents: 0,
    skills: 0,
    auditEvents: 0,
  });
  const [skills, setSkills] = useState<Skill[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>(defaultStatus);
  const [publishers, setPublishers] = useState<TrustedPublisher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [emergencyReason, setEmergencyReason] = useState('');
  const [newPublisherName, setNewPublisherName] = useState('');
  const [newPublisherKey, setNewPublisherKey] = useState('');
  const [selectedRecoverySkillIds, setSelectedRecoverySkillIds] = useState<string[]>([]);

  const recoverableSkills = useMemo(
    () => skills.filter((skill) => skill.status === 'emergency_disabled'),
    [skills],
  );

  async function loadDashboard() {
    setError(null);
    try {
      const storedSession = localStorage.getItem('polar-session');
      const sessionId = storedSession ? JSON.parse(storedSession).id : 'none';
      const [audit, skillsData, agents, system, trust] = await Promise.all([
        api.getAuditLogs(),
        api.getSkills(),
        sessionId !== 'none' ? api.getAgents(sessionId) : Promise.resolve({ agents: [] }),
        api.getSystemStatus(),
        api.getTrustedPublishers(),
      ]);

      setStats({
        sessions: sessionId === 'none' ? 0 : 1,
        agents: agents.agents.length,
        skills: skillsData.skills.length,
        auditEvents: audit.events.length,
      });
      setSkills(skillsData.skills);
      setSystemStatus(system.status);
      setPublishers(trust.publishers);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    setSelectedRecoverySkillIds((current) => current.filter((id) => recoverableSkills.some((skill) => skill.manifest.id === id)));
  }, [recoverableSkills]);

  async function triggerEmergencyMode(enabled: boolean) {
    setBusy(enabled ? 'enable-emergency' : 'disable-emergency');
    setError(null);
    setSuccess(null);
    try {
      const result = await api.setEmergencyMode(
        enabled,
        enabled ? (emergencyReason.trim() || 'Manual emergency mode activation from Overview') : undefined,
      );
      setSystemStatus(result.status);
      setSuccess(
        enabled
          ? `Emergency mode enabled. Terminated workers: ${result.terminatedWorkers}. Skills disabled: ${result.emergencyDisabledSkills}.`
          : 'Emergency mode disabled. You can now recover selected skills.',
      );
      await loadDashboard();
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function setPolicyMode(mode: 'developer' | 'signed_only') {
    setBusy(`policy-${mode}`);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.setSkillPolicyMode(mode);
      setSystemStatus(result.status);
      setSuccess(`Skill policy mode set to ${mode}.`);
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addPublisher() {
    const name = newPublisherName.trim();
    const publicKey = newPublisherKey.trim();
    if (!name || !publicKey) {
      setError('Publisher name and public key are required.');
      return;
    }

    setBusy('trust-add');
    setError(null);
    setSuccess(null);
    try {
      const result = await api.addTrustedPublisher({ name, publicKey });
      setPublishers((current) => [...current.filter((entry) => entry.id !== result.publisher.id), result.publisher]
        .sort((a, b) => a.name.localeCompare(b.name)));
      setNewPublisherName('');
      setNewPublisherKey('');
      setSuccess(`Trusted publisher added: ${result.publisher.name}.`);
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function removePublisher(id: string) {
    setBusy(`trust-remove-${id}`);
    setError(null);
    setSuccess(null);
    try {
      await api.removeTrustedPublisher(id);
      setPublishers((current) => current.filter((entry) => entry.id !== id));
      setSuccess('Trusted publisher removed.');
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function recoverSkills(all: boolean) {
    setBusy(all ? 'recover-all' : 'recover-selected');
    setError(null);
    setSuccess(null);
    try {
      const result = await api.recoverEmergencySkills(all ? undefined : selectedRecoverySkillIds);
      const label = result.count === 1 ? 'skill' : 'skills';
      setSuccess(`Recovered ${result.count} ${label}.`);
      setSelectedRecoverySkillIds([]);
      await loadDashboard();
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function toggleRecoverySelection(skillId: string, checked: boolean) {
    setSelectedRecoverySkillIds((current) => {
      if (checked) {
        if (current.includes(skillId)) return current;
        return [...current, skillId];
      }
      return current.filter((id) => id !== skillId);
    });
  }

  const runtimeStatusLabel = systemStatus.mode === 'emergency' ? 'EMERGENCY' : 'ACTIVE';
  const policyLabel = systemStatus.skillPolicyMode === 'signed_only' ? 'Signed Only' : 'Developer';

  return (
    <div className="intelligence-page">
      <div className="page-header">
        <h2>System Overview</h2>
        <p>Runtime controls, trust policy, and emergency recovery operations.</p>
      </div>

      {loading ? <div className="loading-state">Loading dashboard...</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      {!loading ? (
        <>
          <div className="overview-stats-grid">
            <div className="card overview-stat-card">
              <label>Runtime Status</label>
              <div className={`overview-value ${systemStatus.mode === 'emergency' ? 'status-danger' : 'status-active'}`}>
                {runtimeStatusLabel}
              </div>
              <small>Last change: {new Date(systemStatus.lastModeChange).toLocaleString()}</small>
            </div>
            <div className="card overview-stat-card">
              <label>Policy Mode</label>
              <div className="overview-value">{policyLabel}</div>
            </div>
            <div className="card overview-stat-card">
              <label>Active Agents</label>
              <div className="overview-value">{stats.agents}</div>
            </div>
            <div className="card overview-stat-card">
              <label>Installed Skills</label>
              <div className="overview-value">{stats.skills}</div>
            </div>
            <div className="card overview-stat-card">
              <label>Trust Entries</label>
              <div className="overview-value">{publishers.length}</div>
            </div>
            <div className="card overview-stat-card">
              <label>Audit Events</label>
              <div className="overview-value">{stats.auditEvents}</div>
            </div>
          </div>

          <div className="card">
            <h3>Emergency Controls</h3>
            <p className="card-description">
              Use kill switch to immediately stop worker activity and place skills into <code>emergency_disabled</code> state.
            </p>
            <div className="overview-controls-row">
              <div className="form-group">
                <label>Emergency reason</label>
                <input
                  type="text"
                  value={emergencyReason}
                  onChange={(event) => setEmergencyReason(event.target.value)}
                  placeholder="Manual containment action"
                />
              </div>
              <div className="overview-button-row">
                <button
                  className="btn-small danger"
                  onClick={() => triggerEmergencyMode(true)}
                  disabled={busy !== null || systemStatus.mode === 'emergency'}
                >
                  Enable Kill Switch
                </button>
                <button
                  className="btn-small primary"
                  onClick={() => triggerEmergencyMode(false)}
                  disabled={busy !== null || systemStatus.mode !== 'emergency'}
                >
                  Disable Emergency Mode
                </button>
              </div>
            </div>
            {systemStatus.mode === 'emergency' ? (
              <div className="error-banner" style={{ marginTop: 12 }}>
                Emergency mode is active. Tool tokens are blocked and affected skills require explicit recovery.
              </div>
            ) : null}
          </div>

          <div className="card">
            <h3>Signing Policy</h3>
            <p className="card-description">
              Configure whether unsigned or locally signed skills are allowed.
            </p>
            <div className="overview-button-row">
              <button
                className="btn-small primary"
                onClick={() => setPolicyMode('signed_only')}
                disabled={busy !== null || systemStatus.skillPolicyMode === 'signed_only'}
              >
                Signed Only
              </button>
              <button
                className="btn-small"
                onClick={() => setPolicyMode('developer')}
                disabled={busy !== null || systemStatus.skillPolicyMode === 'developer'}
              >
                Developer Mode
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Trusted Publishers</h3>
            <p className="card-description">
              Local trust store used by signature verification to mark publisher keys as <code>trusted</code>.
            </p>
            <div className="overview-trust-list">
              {publishers.length === 0 ? (
                <div className="mono">No trusted publishers configured.</div>
              ) : (
                publishers.map((publisher) => (
                  <div key={publisher.id} className="overview-trust-item">
                    <div>
                      <div className="overview-trust-name">{publisher.name}</div>
                      <div className="mono">Fingerprint: {publisher.fingerprint.slice(0, 16)}...</div>
                    </div>
                    <button
                      className="btn-small danger"
                      onClick={() => removePublisher(publisher.id)}
                      disabled={busy !== null}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="overview-trust-form">
              <div className="form-group">
                <label>Publisher name</label>
                <input
                  type="text"
                  value={newPublisherName}
                  onChange={(event) => setNewPublisherName(event.target.value)}
                  placeholder="Acme Skill Labs"
                />
              </div>
              <div className="form-group">
                <label>Public key</label>
                <textarea
                  value={newPublisherKey}
                  onChange={(event) => setNewPublisherKey(event.target.value)}
                  placeholder="-----BEGIN PUBLIC KEY-----"
                  rows={4}
                />
              </div>
              <button className="btn-small primary" onClick={addPublisher} disabled={busy !== null}>
                Add Trusted Publisher
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Emergency Recovery Wizard</h3>
            <p className="card-description">
              Select which <code>emergency_disabled</code> skills to re-enable after emergency mode is cleared.
            </p>
            {recoverableSkills.length === 0 ? (
              <div className="mono">No skills currently waiting for emergency recovery.</div>
            ) : (
              <div className="overview-recovery-list">
                {recoverableSkills.map((skill) => (
                  <label key={skill.manifest.id} className="overview-recovery-item">
                    <input
                      type="checkbox"
                      checked={selectedRecoverySkillIds.includes(skill.manifest.id)}
                      onChange={(event) => toggleRecoverySelection(skill.manifest.id, event.target.checked)}
                      disabled={busy !== null}
                    />
                    <span>{skill.manifest.name}</span>
                    <code>{skill.manifest.id}</code>
                  </label>
                ))}
              </div>
            )}
            <div className="overview-button-row" style={{ marginTop: 12 }}>
              <button
                className="btn-small primary"
                onClick={() => recoverSkills(false)}
                disabled={
                  busy !== null
                  || systemStatus.mode === 'emergency'
                  || selectedRecoverySkillIds.length === 0
                }
              >
                Recover Selected
              </button>
              <button
                className="btn-small"
                onClick={() => recoverSkills(true)}
                disabled={
                  busy !== null
                  || systemStatus.mode === 'emergency'
                  || recoverableSkills.length === 0
                }
              >
                Recover All
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
