export const API_BASE = '/api/v1';

export async function makeRequest(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    console.log(`[WebSimAPI] Requesting: ${url}`);
    
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WebSimAPI] Request Failed: ${url} (${response.status})`, errorText);
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    
    return response.json();
}

export async function fetchRaw(endpoint) {
    const response = await fetch(`${API_BASE}${endpoint}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
}