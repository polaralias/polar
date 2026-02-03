import React, { useEffect, useState } from 'react';
import { fetchMemory, deleteMemory, type MemoryItem } from '../api.js';

const MemoryPage: React.FC = () => {
    const [items, setItems] = useState<MemoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadData = async () => {
        try {
            setLoading(true);
            const data = await fetchMemory();
            setItems(data.items);
            setError(null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this memory item?')) return;
        try {
            await deleteMemory(id);
            await loadData();
        } catch (err) {
            alert(`Failed to delete: ${(err as Error).message}`);
        }
    };

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'profile': return '#a855f7'; // Purple
            case 'project': return '#3b82f6'; // Blue
            case 'session': return '#10b981'; // Green
            case 'tool-derived': return '#f59e0b'; // Amber
            default: return '#6b7280';
        }
    };

    return (
        <div className="page">
            <header className="page-header">
                <h1>Memory</h1>
                <p>Inspect and manage what the system remembers.</p>
            </header>

            {error && <div className="error-banner">{error}</div>}

            <div className="memory-list">
                {loading && items.length === 0 ? (
                    <p>Loading memory...</p>
                ) : items.length === 0 ? (
                    <div className="empty-state">
                        <p>No memory items found.</p>
                        <p className="hint">Memory is populated when agents propose facts or summaries during sessions.</p>
                    </div>
                ) : (
                    <div className="grid">
                        {items.map((item) => (
                            <div key={item.id} className="card memory-card">
                                <div className="card-header">
                                    <span className="badge" style={{ backgroundColor: getTypeColor(item.type) }}>
                                        {item.type}
                                    </span>
                                    <span className="timestamp">{new Date(item.provenance.timestamp).toLocaleString()}</span>
                                </div>

                                <div className="card-body">
                                    <pre className="memory-content">
                                        {JSON.stringify(item.content, null, 2)}
                                    </pre>

                                    <div className="memory-footer">
                                        <div className="provenance">
                                            <strong>Source:</strong> {item.provenance.skillId || item.provenance.agentId || 'direct'}
                                            <br />
                                            <strong>Scope:</strong> {item.scopeId}
                                        </div>
                                        {item.metadata.expiresAt && (
                                            <div className="expiry">
                                                Expires: {new Date(item.metadata.expiresAt).toLocaleTimeString()}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="card-actions">
                                    <button onClick={() => handleDelete(item.id)} className="btn btn-danger">
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MemoryPage;
