import { useEffect, useMemo, useState } from 'react';
import { api, type Channel, type ChannelRoute, type QuarantinedAttachment, type Session } from '../api.js';

export default function ChannelsPage() {
    const [channels, setChannels] = useState<Channel[]>([]);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [routesByChannel, setRoutesByChannel] = useState<Record<string, ChannelRoute[]>>({});
    const [routeDrafts, setRouteDrafts] = useState<Record<string, { conversationId: string; sessionId: string }>>({});
    const [attachments, setAttachments] = useState<QuarantinedAttachment[]>([]);
    const [pairingCode, setPairingCode] = useState<string | null>(null);
    const [pairingExpiresSeconds, setPairingExpiresSeconds] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [busyChannelId, setBusyChannelId] = useState<string | null>(null);
    const [attachmentBusyId, setAttachmentBusyId] = useState<string | null>(null);

    useEffect(() => {
        void refresh();
    }, []);

    async function refresh() {
        setLoading(true);
        try {
            const [channelsData, sessionsData, attachmentsData] = await Promise.all([
                api.getChannels(),
                api.getSessions('active'),
                api.getChannelAttachments(),
            ]);
            setChannels(channelsData.channels);
            setSessions(sessionsData.sessions);
            setAttachments(attachmentsData.attachments);

            const routesEntries = await Promise.all(
                channelsData.channels.map(async (channel) => {
                    const routeData = await api.getChannelRoutes(channel.id);
                    return [channel.id, routeData.routes] as const;
                }),
            );
            setRoutesByChannel(Object.fromEntries(routesEntries));
        } catch (error) {
            console.error('Failed to fetch channels:', error);
        } finally {
            setLoading(false);
        }
    }

    function updateRouteDraft(channelId: string, patch: Partial<{ conversationId: string; sessionId: string }>) {
        setRouteDrafts((prev) => ({
            ...prev,
            [channelId]: {
                conversationId: prev[channelId]?.conversationId || '',
                sessionId: prev[channelId]?.sessionId || '',
                ...patch,
            },
        }));
    }

    async function saveRoute(channelId: string) {
        const draft = routeDrafts[channelId];
        if (!draft?.conversationId || !draft?.sessionId) {
            return;
        }
        setBusyChannelId(channelId);
        try {
            await api.setChannelRoute(channelId, {
                conversationId: draft.conversationId.trim(),
                sessionId: draft.sessionId,
            });
            const routeData = await api.getChannelRoutes(channelId);
            setRoutesByChannel((prev) => ({ ...prev, [channelId]: routeData.routes }));
            setRouteDrafts((prev) => ({
                ...prev,
                [channelId]: { conversationId: '', sessionId: draft.sessionId },
            }));
        } catch (error) {
            console.error(`Failed to set route for channel ${channelId}:`, error);
        } finally {
            setBusyChannelId(null);
        }
    }

    async function generatePairingCode() {
        try {
            const result = await api.generateChannelPairingCode();
            setPairingCode(result.code);
            setPairingExpiresSeconds(result.expiresSeconds);
        } catch (error) {
            console.error('Failed to generate pairing code:', error);
        }
    }

    async function requestAttachmentAnalysis(attachmentId: string) {
        setAttachmentBusyId(attachmentId);
        try {
            const note = window.prompt('Optional analysis note', '');
            await api.requestAttachmentAnalysis(attachmentId, note || undefined);
            const data = await api.getChannelAttachments();
            setAttachments(data.attachments);
        } catch (error) {
            console.error(`Failed to request attachment analysis for ${attachmentId}:`, error);
        } finally {
            setAttachmentBusyId(null);
        }
    }

    const quarantinedAttachments = useMemo(
        () => attachments.filter((attachment) => attachment.status === 'quarantined'),
        [attachments],
    );

    return (
        <div className="page fade-in">
            <div className="section-header">
                <h2>Inbound Channels</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn" onClick={generatePairingCode}>
                        Generate Pairing Code
                    </button>
                    <button className="btn" onClick={() => void refresh()} disabled={loading}>
                        Refresh
                    </button>
                </div>
            </div>

            {pairingCode && (
                <div className="card" style={{ marginBottom: '12px' }}>
                    <h3>Pairing Code</h3>
                    <p style={{ marginTop: '6px' }}>
                        <strong>{pairingCode}</strong>
                        {pairingExpiresSeconds ? ` (expires in ${pairingExpiresSeconds}s)` : ''}
                    </p>
                </div>
            )}

            <div className="grid">
                {channels.map((chan) => (
                    <div key={chan.id} className="card channel-card">
                        <div className="card-header">
                            <h3>{chan.name}</h3>
                            <span className={`status-pill ${chan.enabled ? 'active' : 'inactive'}`}>
                                {chan.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                        </div>
                        <p className="type-tag">{chan.type}</p>
                        <div className="allowlist">
                            <h4>Allowlist</h4>
                            <ul>
                                {chan.allowlist.map((id) => (
                                    <li key={id}>{id}</li>
                                ))}
                                {chan.allowlist.length === 0 && <li>No authorized senders</li>}
                            </ul>
                        </div>
                        <div className="allowlist">
                            <h4>Conversation Routes</h4>
                            <ul>
                                {(routesByChannel[chan.id] || []).map((route) => (
                                    <li key={`${route.channelId}:${route.conversationId}`}>
                                        <code>{route.conversationId}</code>{' -> '}<code>{route.sessionId}</code>
                                    </li>
                                ))}
                                {(routesByChannel[chan.id] || []).length === 0 && <li>No explicit routes yet</li>}
                            </ul>
                            <div style={{ display: 'grid', gap: '6px', marginTop: '8px' }}>
                                <input
                                    value={routeDrafts[chan.id]?.conversationId || ''}
                                    onChange={(event) => updateRouteDraft(chan.id, { conversationId: event.target.value })}
                                    placeholder="Conversation ID (chat/thread)"
                                />
                                <select
                                    value={routeDrafts[chan.id]?.sessionId || ''}
                                    onChange={(event) => updateRouteDraft(chan.id, { sessionId: event.target.value })}
                                >
                                    <option value="">Select session</option>
                                    {sessions.map((session) => (
                                        <option key={session.id} value={session.id}>
                                            {session.id}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    className="btn"
                                    disabled={busyChannelId === chan.id}
                                    onClick={() => void saveRoute(chan.id)}
                                >
                                    Save Route
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="card" style={{ marginTop: '12px' }}>
                <div className="section-header">
                    <h3>Quarantined Attachments</h3>
                    <span className="badge">{quarantinedAttachments.length}</span>
                </div>
                {attachments.length === 0 ? (
                    <p>No attachments in quarantine.</p>
                ) : (
                    <div style={{ display: 'grid', gap: '8px' }}>
                        {attachments.map((attachment) => (
                            <div key={attachment.id} className="skill-item" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
                                <div className="mono" style={{ fontSize: '11px' }}>
                                    ID: {attachment.id.slice(0, 8)}<br />
                                    Channel: {attachment.channelId}<br />
                                    Session: {attachment.sessionId}<br />
                                    Type: {attachment.attachment.mimeType}<br />
                                    Status: {attachment.status}
                                </div>
                                {attachment.status === 'quarantined' && (
                                    <button
                                        className="btn"
                                        disabled={attachmentBusyId === attachment.id}
                                        onClick={() => void requestAttachmentAnalysis(attachment.id)}
                                    >
                                        Request Analysis
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {channels.length === 0 && !loading && (
                <div className="empty-state">
                    <p>No channels configured. Add channels via the API or CLI.</p>
                </div>
            )}
        </div>
    );
}
