export const socketUtils = `
    // Shared user state
    window._currentUser = null;

    // Helper: Sanitize Avatar URLs (Fix CSP & Loader Hangs)
    function sanitizeAvatar(url, username) {
        if (!url) return 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png';
        // If it's a WebSim URL, rewrite to placeholder to allow injector to resolve it
        if (url.includes('images.websim.ai') || url.includes('images.websim.com')) {
            return '/_websim_avatar_/' + (username || 'guest');
        }
        return url;
    }
`;