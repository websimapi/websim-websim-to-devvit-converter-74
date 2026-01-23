import { API_BASE } from './core.js';

export async function getProjectHtml(projectId, version) {
    // 1. Priority: Fetch Revision Data (Metadata + potential content)
    // This is more reliable as the dedicated /html endpoint often returns 403
    try {
        console.log(`[API] Fetching revision metadata for HTML...`);
        const response = await fetch(`${API_BASE}/projects/${projectId}/revisions/${version}`);
        if (response.ok) {
            const data = await response.json();
            const rev = data.revision || data; // Handle nested or flat return
            
            // Check common fields where HTML content might be stored
            if (rev.html) return rev.html;
            if (rev.content && typeof rev.content === 'string') return rev.content;
            if (rev.content && rev.content.html) return rev.content.html;
            // Extra fallback fields for various API versions
            if (rev.source) return rev.source;
            if (rev.code) return rev.code;
            if (rev.files && rev.files['index.html']) {
                 const f = rev.files['index.html'];
                 return typeof f === 'string' ? f : f.content;
            }
        }
    } catch (e) {
        console.warn("[API] Revision metadata fetch error:", e);
    }

    // 2. Fallback: Dedicated HTML Endpoint
    try {
        console.log(`[API] Attempting fallback to direct HTML endpoint...`);
        // Remove Content-Type header to avoid 403 on some endpoints
        const response = await fetch(`${API_BASE}/projects/${projectId}/revisions/${version}/html`);
        
        if (response.ok) {
            const text = await response.text();
            if (text.trim().startsWith('{')) {
                try {
                    const json = JSON.parse(text);
                    if (json.content) return json.content;
                    if (json.html) return json.html;
                } catch(e) {
                    console.warn("[API] Failed to parse JSON response for HTML:", e);
                    // If it looks like JSON but failed to parse, it's likely corrupt metadata, NOT valid HTML.
                    // Return null to trigger fallback reconstruction rather than returning raw JSON string.
                    return null;
                }
                // If it parses as JSON but lacks content/html keys, it's not the HTML we want.
                return null; 
            }
            return text;
        }
        console.warn(`[API] Direct HTML fetch failed (${response.status}).`);
    } catch (e) {
        console.warn("[API] HTML fetch error:", e);
    }

    return null;
}