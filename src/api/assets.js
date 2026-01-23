import { makeRequest, fetchRaw } from './core.js';

// Minimal 1x1 Transparent PNG
const EMPTY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
]);

// Minimal Silence WAV (44 bytes)
const EMPTY_WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
  0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x44, 0xac, 0x00, 0x00, 0x88, 0x58, 0x01, 0x00,
  0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00
]);

// Helper: Process array in chunks to avoid rate limiting
async function mapLimit(items, limit, fn) {
    const results = [];
    const chunks = [];
    for (let i = 0; i < items.length; i += limit) {
        chunks.push(items.slice(i, i + limit));
    }
    for (const chunk of chunks) {
        const chunkResults = await Promise.all(chunk.map(fn));
        results.push(...chunkResults);
    }
    return results;
}

export async function getAssetMetadata(projectId, version, path) {
    try {
        return await makeRequest(`/projects/${projectId}/revisions/${version}/assets/${encodeURIComponent(path)}`);
    } catch(e) {
        return null;
    }
}

export async function getAssets(projectId, version) {
    console.log(`[WebSimAPI] getAssets: Project=${projectId}, Version=${version}`);
    let allAssets = [];
    let nextCursor = null;
    let hasNext = true;
    let page = 0;
    
    while(hasNext && page < 50) { // Safety limit
        console.log(`[WebSimAPI] Fetching asset page ${page}...`);
        const params = new URLSearchParams();
        params.set('first', '50');
        if (nextCursor) params.set('after', nextCursor);

        try {
            const res = await makeRequest(`/projects/${projectId}/revisions/${version}/assets?${params}`);
            
            let pageData = [];
            let meta = null;

            // Verbose response structure check
            console.log(`[WebSimAPI] Page ${page} response keys:`, Object.keys(res));
            if (res.assets) console.log(`[WebSimAPI] res.assets keys:`, Object.keys(res.assets));

            if (Array.isArray(res)) {
                pageData = res;
                hasNext = false; 
            } else if (res.assets && Array.isArray(res.assets)) {
                pageData = res.assets;
                hasNext = false;
            } else if (res.assets && res.assets.data && Array.isArray(res.assets.data)) {
                pageData = res.assets.data;
                meta = res.assets.meta;
            } else if (res.data && Array.isArray(res.data)) {
                pageData = res.data;
                meta = res.meta;
            }

            console.log(`[WebSimAPI] Page ${page} found ${pageData.length} assets.`);
            if (pageData.length > 0) allAssets.push(...pageData);

            if (meta && meta.has_next_page && meta.end_cursor) {
                nextCursor = meta.end_cursor;
            } else {
                hasNext = false;
            }
        } catch(e) {
            console.error(`[WebSimAPI] Asset fetch page ${page} failed:`, e);
            hasNext = false;
        }
        page++;
    }

    console.log(`[WebSimAPI] Total assets fetched: ${allAssets.length}`);
    return allAssets;
}

export async function getAssetContent(projectId, version, path) {
    const ab = await fetchRaw(`/projects/${projectId}/revisions/${version}/assets/${encodeURIComponent(path)}/content`);
    try {
        const text = new TextDecoder().decode(ab);
        if (text.trim().startsWith('{')) {
            const json = JSON.parse(text);
            const content = json.content || json.data;
            if (content && typeof content === 'string') {
                return new TextEncoder().encode(content).buffer;
            }
        }
    } catch(e) {}
    return ab;
}

export async function processAssets(assetList, projectId, version) {
    console.log(`[WebSimAPI] processAssets: Processing ${assetList?.length || 0} items`);
    const files = {};
    const encoder = new TextEncoder();

    if (!assetList || !Array.isArray(assetList)) {
        console.warn("[WebSimAPI] Invalid assetList provided to processAssets");
        return files;
    }

    const processItem = async (asset) => {
        if (!asset.path) return;
        
        const path = asset.path.replace(/^(\.|\/)+/, ''); // Clean path
        if (path.endsWith('/')) return; // Skip explicitly marked directories

        // 1. Embedded Content (String/JSON)
        if (typeof asset.content === 'string' && asset.content.length > 0) {
            files[path] = encoder.encode(asset.content);
            return;
        }
        if (asset.content && typeof asset.content === 'object') {
            files[path] = encoder.encode(JSON.stringify(asset.content));
            return;
        }

        const isText = /\.(html|js|mjs|jsx|ts|tsx|css|json|txt|md|xml|svg|csv)$/i.test(path);
        
        // 2. Identify URL & Metadata Recovery
        // Sometimes the asset list is sparse, so we check various keys or fetch detailed metadata
        let url = asset.url || asset.src || asset.uri || asset.download_url;
        
        // Prefer our new CDN-style URL pattern when WebSim doesn't give us one
        // Example: https://iur9h4n4su3ibzjwudyq.c.websim.com/success.mp3?v=76&t=1766724292663
        if (!url && !isText && projectId && version) {
            const filename = path.split('/').pop();
            if (filename) {
                const ts = Date.now();
                url = `https://${projectId}.c.websim.com/${encodeURIComponent(filename)}?v=${version}&t=${ts}`;
                console.log(`[WebSimAPI] ${path} -> Synthesized CDN URL: ${url}`);
            }
        }
        
        // Legacy fallback: try metadata endpoint only if we still failed to get a URL
        if (!url && !isText) {
             console.log(`[WebSimAPI] ${path} -> Missing URL, fetching metadata (legacy path)...`);
             const meta = await getAssetMetadata(projectId, version, path);
             if (meta) {
                 url = meta.url || meta.src || meta.download_url;
                 if (url) {
                     console.log(`[WebSimAPI] ${path} -> Recovered URL from metadata: ${url}`);
                 } else {
                     console.warn(`[WebSimAPI] ${path} -> Metadata retrieved but no URL found. Keys:`, Object.keys(meta));
                 }
             }
        }

        const isAbsolute = url && url.startsWith('http');
        
        // Helper to fetch via API Content
        const tryFetchContent = async () => {
             if (!projectId || !version) return null;
             try {
                 const ab = await getAssetContent(projectId, version, path);
                 if (ab && ab.byteLength > 0) return new Uint8Array(ab);
             } catch(e) { 
                 console.warn(`[WebSimAPI] ${path} -> API content fetch error:`, e.message);
             }
             return null;
        };

        // Strategy A: API Content (Text Files)
        // We prefer API content for text as it's often more up-to-date or cleaner than CDN
        if (isText) {
            const content = await tryFetchContent();
            if (content) {
                files[path] = content;
                return;
            }
        }

        // Strategy B: CDN URL (Binary / Absolute)
        if (isAbsolute) {
            try {
                // Jitter to avoid rate limits
                await new Promise(r => setTimeout(r, Math.random() * 50));
                
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                
                const blob = await res.arrayBuffer();

                // Validate content
                if (/\.(mp3|wav|ogg|glb|gltf|png|jpg|jpeg|gif)$/i.test(path)) {
                    const contentType = res.headers.get('content-type');
                    // Sanity check: don't save HTML error pages as MP3s
                    if (contentType && (contentType.includes('text/html') || contentType.includes('application/json'))) {
                         throw new Error(`Invalid content-type: ${contentType}`);
                    }
                    if (blob.byteLength > 0) {
                        const header = new Uint8Array(blob.slice(0, 100));
                        const textHeader = new TextDecoder().decode(header).trim().toLowerCase();
                        if (textHeader.startsWith('<!doctype') || textHeader.startsWith('<html')) {
                             throw new Error(`Content sniffer detected HTML signature in binary file`);
                        }
                    }
                }
                
                console.log(`[WebSimAPI] ${path} -> CDN fetch success (${blob.byteLength} bytes)`);
                files[path] = new Uint8Array(blob);
                return;

            } catch(e) {
                console.warn(`[WebSimAPI] ${path} -> CDN load failed: ${e.message}`);
                // Proceed to fallback
            }
        }

        // Strategy C: API Content Fallback (Binary)
        // If CDN failed or was missing, try the /content endpoint (note: often fails 400 for binary)
        if (!files[path] && !isText) {
             console.log(`[WebSimAPI] ${path} -> Attempting API Content Fallback...`);
             const content = await tryFetchContent();
             if (content) {
                 files[path] = content;
                 console.log(`[WebSimAPI] ${path} -> API Content Fallback Success`);
                 return;
             }
        }

        // 4. Default Fail-safes (Empty Placeholders)
        if (isText) {
             console.warn(`[WebSimAPI] ${path} -> FAILED ALL STRATEGIES. Creating placeholder.`);
             files[path] = encoder.encode(`// Missing file: ${path}\n// Failed to download from WebSim.`);
        }

        // 4. Default Fail-safes
        if (/\.(mp3|wav|ogg)$/i.test(path)) {
            files[path] = EMPTY_WAV;
        } else if (/\.(png|jpg|jpeg|gif)$/i.test(path)) {
            files[path] = EMPTY_PNG;
        } else if (isText) {
             // If we failed to get text content, do NOT create an empty file, 
             // because an empty JS file might break imports. 
             // Better to let it be missing so the bundler warns or we handle it elsewhere.
             // BUT, if it's index.html, we might want to handle it.
             if (path === 'index.html') {
                 console.error("Critical: Failed to fetch index.html");
             }
        }
    };

    // Limit concurrency
    await mapLimit(assetList, 5, processItem);
    return files;
}