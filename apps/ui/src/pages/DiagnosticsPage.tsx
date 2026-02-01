import { useEffect, useState } from 'react';
import { api } from '../api.js';

type DoctorResult = {
    id: string;
    name: string;
    status: 'OK' | 'WARNING' | 'CRITICAL';
    message: string;
    remediation?: string;
};

export default function DiagnosticsPage() {
    const [results, setResults] = useState<DoctorResult[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        refresh();
    }, []);

    async function refresh() {
        setLoading(true);
        try {
            const data = await api.getDoctorResults();
            setResults(data.results);
        } catch (error) {
            console.error('Failed to fetch diagnostics:', error);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="page fade-in">
            <div className="section-header">
                <h2>System Diagnostics</h2>
                <button className="btn" onClick={refresh} disabled={loading}>
                    {loading ? 'Checking...' : 'Run Doctor'}
                </button>
            </div>

            <div className="card">
                <div className="doctor-list">
                    {results.map((res) => (
                        <div key={res.id} className={`doctor-item status-${res.status.toLowerCase()}`}>
                            <div className="doctor-item-header">
                                <span className="status-badge">{res.status}</span>
                                <h3>{res.name}</h3>
                            </div>
                            <p>{res.message}</p>
                            {res.remediation && (
                                <div className="remediation">
                                    <strong>Remediation:</strong> {res.remediation}
                                </div>
                            )}
                        </div>
                    ))}
                    {results.length === 0 && !loading && <p>No results yet. Run the doctor check.</p>}
                </div>
            </div>
        </div>
    );
}
