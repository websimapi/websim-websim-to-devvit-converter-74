export const jsxDevProxy = `
// Shim for react/jsx-dev-runtime to work in production Vite builds
import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';

export const Fragment = _Fragment;
export const jsx = _jsx;
export const jsxs = _jsxs;

// Proxy jsxDEV to jsx (ignores the extra dev-only arguments)
export const jsxDEV = (type, props, key, isStaticChildren, source, self) => {
  return _jsx(type, props, key);
};
`;

export const websimPackageJs = `
// Bridge for "import websim from 'websim'"
const w = window.websim || {};
export default w;
// Export common methods if destructured
export const getProject = w.getProject;
export const getCurrentProject = w.getCurrentProject;
export const getCurrentUser = w.getCurrentUser;
export const upload = w.upload;
export const collection = w.collection;
`;

export const protobufInquireStub = `
// Stub for @protobufjs/inquire to avoid eval() usage in CSP-strict environments
export default function inquire(moduleName) {
  return null;
}
`;

export const avatarInjector = `
// [WebSim] Avatar Injector - Hot-swaps placeholder URLs for real Snoovatars
(function() {
    const TAG = "[AvatarInjector]";
    const PLACEHOLDER_PREFIX = '/_websim_avatar_/';
    const CACHE = new Map();
    const PENDING = new Map();

    async function resolve(username, imgEl) {
        if (!username) return;
        
        const applyUrl = (url) => {
             const currentSrc = imgEl.getAttribute('src') || imgEl.src;
             
             // Define transition logic
             const show = () => {
                 imgEl.style.transition = 'opacity 0.2s ease-in';
                 requestAnimationFrame(() => imgEl.style.opacity = '1');
             };

             // If already correct, just show
             if (currentSrc === url) {
                 show();
                 return;
             }

             // If swapping
             // 1. Force opacity 0 if not already (handled by CSS for initial placeholders)
             // imgEl.style.opacity = '0'; 

             const onFinish = () => show();
             
             imgEl.addEventListener('load', onFinish, { once: true });
             imgEl.addEventListener('error', onFinish, { once: true });
             
             imgEl.src = url;
             
             // If cached/immediate
             if (imgEl.complete && imgEl.naturalWidth > 0) show();
        };

        // 1. Check Cache
        if (CACHE.has(username)) {
            applyUrl(CACHE.get(username));
            return;
        }

        // 2. Fetch (deduplicated)
        if (!PENDING.has(username)) {
             // console.log(TAG, "Fetching avatar for", username);
             PENDING.set(username, fetch('/api/lookup/avatar/' + username)
                 .then(r => r.json())
                 .then(d => {
                     const url = d.url;
                     CACHE.set(username, url);
                     return url;
                 })
                 .catch(e => {
                     console.warn(TAG, "Failed to lookup", username, e);
                     const def = 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png';
                     CACHE.set(username, def);
                     return def;
                 })
             );
        }

        // 3. Apply when ready
        try {
            const url = await PENDING.get(username);
            // Verify the img still wants this avatar (hasn't been reused/changed while waiting)
            const currentSrc = imgEl.getAttribute('src') || imgEl.src;
            if (currentSrc && currentSrc.includes(PLACEHOLDER_PREFIX + username)) {
                applyUrl(url);
            }
        } catch(e) { console.error(TAG, e); }
    }

    function check(node) {
        if (node.tagName !== 'IMG') return;
        const src = node.getAttribute('src') || node.src;
        if (!src) return;
        
        // Check for our marker
        if (src.includes(PLACEHOLDER_PREFIX)) {
            // Hide immediately to prevent glitch
            node.style.opacity = '0';
            
            const parts = src.split(PLACEHOLDER_PREFIX);
            if (parts.length > 1) {
                // Remove any trailing query params or hashes
                let username = parts[1].split(/[?#]/)[0];
                if (username === 'null' || username === 'undefined') username = 'guest';
                resolve(username, node);
            }
        }
    }

    // Observer
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === 'childList') {
                m.addedNodes.forEach(node => {
                    if (node.tagName === 'IMG') check(node);
                    if (node.querySelectorAll) node.querySelectorAll('img').forEach(check);
                });
            } else if (m.type === 'attributes' && m.attributeName === 'src') {
                check(m.target);
            }
        }
    });

    // Start
    const startObserver = () => {
        const root = document.documentElement || document.body;
        if (!root) return;
        
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
        document.querySelectorAll('img').forEach(check);
    };

    if (document.readyState === 'loading') {
        if (document.documentElement) startObserver();
        window.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }
})();
`;