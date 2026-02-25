// src/api.js
export async function fetchApi(endpoint, body = null) {
    try {
        const res = await fetch(`/api/${endpoint}`, {
            method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        return data;
    } catch (err) {
        console.error(`API Error on ${endpoint}:`, err);
        throw err;
    }
}
