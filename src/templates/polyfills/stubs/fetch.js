export const fetchStub = `
    // --- 1. Monkeypatch Fetch for Comments API ---
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
        let url = input;
        if (typeof input === 'string') {
            // Intercept WebSim Comment API calls
            // Matches: /api/v1/projects/{UUID}/comments... (Capture query params)
            const commentMatch = input.match(/\\/api\\/v1\\/projects\\/[^/]+\\/comments(.*)/);
            if (commentMatch) {
                const query = commentMatch[1] || '';
                // Hotswap: If filtering by tips, use the dedicated financial endpoint
                // Add cache-busting to prevent stale data on hotswap
                const ts = Date.now();
                const separator = query.includes('?') ? '&' : '?';
                const bust = separator + '_t=' + ts;

                if (query.includes('only_tips=true')) {
                     // console.log("[Polyfill] Redirecting tip fetch to /api/tips");
                     return originalFetch('/api/tips' + query + bust, init);
                }
                return originalFetch('/api/comments' + query + bust, init);
            }
        }
        return originalFetch(input, init);
    };
`;