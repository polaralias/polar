import { useEffect, useState } from 'react';
import { api } from '../api.js';

type Channel = {
    id: string;
    type: string;
    name: string;
    enabled: boolean;
    allowlist: string[];
};

export default function ChannelsPage() {
    const [channels, setChannels] = useState<Channel[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        refresh();
    }, []);

    async function refresh() {
        setLoading(true);
        try {
            const data = await api.getChannels();
            setChannels(data.channels);
        } catch (error) {
            console.error('Failed to fetch channels:', error);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="page fade-in">
            <div className="section-header">
                <h2>Inbound Channels</h2>
                <button className="btn" onClick={refresh} disabled={loading}>
                    Refresh
                </button>
            </div>

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
                    </div>
                ))}
            </div>

            {channels.length === 0 && !loading && (
                <div className="empty-state">
                    <p>No channels configured. Add channels via the API or CLI.</p>
                </div>
            )}
        </div>
    );
}
