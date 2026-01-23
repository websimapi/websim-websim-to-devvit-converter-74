import { 
    parseProjectIdentifier, 
    fetchProjectMetadata, 
    getAllProjectRevisions, 
    getAssets,
    getProjectHtml,
    processAssets 
} from './websim-api.js';

import { generateDevvitZip } from './generator.js';
import JSZip from 'jszip';

// Simple file save helper to avoid dependency issues
const saveAs = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// DOM Elements
const inputEl = document.getElementById('project-input');
const btnFetch = document.getElementById('btn-fetch');
const btnProcessZip = document.getElementById('btn-process-zip');
const zipInput = document.getElementById('zip-input');
const stepInput = document.getElementById('step-input');
const stepVersion = document.getElementById('step-version');
const versionSelect = document.getElementById('version-select');
const btnDownload = document.getElementById('btn-download');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const errorEl = document.getElementById('fetch-error');
const projectTitle = document.getElementById('project-title');
const projectAuthor = document.getElementById('project-author');
const projectThumb = document.getElementById('project-thumb');
const tabBtns = document.querySelectorAll('.tab-btn');

let currentProjectMeta = null;
let uploadedAssets = null; // For zip upload mode

// Tab Handling
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        document.querySelectorAll('.mode-content').forEach(el => el.classList.add('hidden'));
        document.getElementById(`mode-${btn.dataset.mode}`).classList.remove('hidden');
        
        errorEl.classList.add('hidden');
    });
});

// Helper: Show/Hide Loading
const toggleLoading = (show, text = 'Processing...') => {
    loadingText.textContent = text;
    loading.classList.toggle('hidden', !show);
};

// Helper: Show Error
const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
};

// 1. Fetch Project Handler
btnFetch.addEventListener('click', async () => {
    const rawInput = inputEl.value.trim();
    if (!rawInput) return showError("Please enter a URL or ID.");

    errorEl.classList.add('hidden');
    uploadedAssets = null; // Clear upload state
    toggleLoading(true, 'Fetching project details...');

    try {
        const identifier = parseProjectIdentifier(rawInput);
        const meta = await fetchProjectMetadata(identifier);
        
        if (!meta || !meta.project) throw new Error("Project not found.");

        currentProjectMeta = meta;

        // Populate UI
        projectTitle.textContent = meta.project.title;
        projectAuthor.textContent = `by @${meta.project.owner?.username || 'unknown'}`;
        if (meta.project.thumbnail_url) {
            projectThumb.src = meta.project.thumbnail_url;
            projectThumb.classList.remove('hidden');
        } else {
            projectThumb.classList.add('hidden');
        }

        // Fetch Versions
        toggleLoading(true, 'Fetching version history...');
        const revisions = await getAllProjectRevisions(meta.project.id);

        // Populate Select
        versionSelect.innerHTML = '';
        versionSelect.disabled = false;
        
        // Add current version option if not in list (sometimes happens)
        const currentOpt = document.createElement('option');
        currentOpt.value = meta.project.current_version;
        currentOpt.textContent = `Latest (v${meta.project.current_version})`;
        versionSelect.appendChild(currentOpt);

        revisions.forEach(rev => {
            if (rev.id === meta.project.current_version) return; // Skip duplicate
            const opt = document.createElement('option');
            opt.value = rev.id;
            const date = new Date(rev.created_at).toLocaleDateString();
            opt.textContent = `v${rev.id} - ${date}`;
            versionSelect.appendChild(opt);
        });

        // Switch Steps
        stepInput.classList.add('hidden');
        stepVersion.classList.remove('hidden');

    } catch (err) {
        showError(err.message || "Failed to fetch project.");
        console.error(err);
    } finally {
        toggleLoading(false);
    }
});

// 2. Zip Upload Handler
btnProcessZip.addEventListener('click', async () => {
    const file = zipInput.files[0];
    if (!file) return showError("Please select a .zip file first.");
    
    toggleLoading(true, 'Reading zip file...');
    errorEl.classList.add('hidden');

    try {
        const zip = await JSZip.loadAsync(file);
        const assets = {};
        
        // Process zip files
        const promises = [];
        zip.forEach((relativePath, zipEntry) => {
            if (zipEntry.dir) return; // Skip directories
            
            const promise = (async () => {
                // Determine if we need text or binary
                const isText = /\.(html|js|css|json|txt|md)$/i.test(relativePath);
                if (isText) {
                    const content = await zipEntry.async('string');
                    assets[relativePath] = content;
                } else {
                    const content = await zipEntry.async('uint8array');
                    assets[relativePath] = content;
                }
            })();
            promises.push(promise);
        });
        
        await Promise.all(promises);
        
        uploadedAssets = assets;
        
        // Create dummy metadata for the UI and generator
        currentProjectMeta = {
            project: {
                id: 'imported-zip',
                slug: 'imported-game',
                title: file.name.replace(/\.zip$/i, ''),
                current_version: '1',
                owner: { username: 'you' }
            }
        };

        // Populate UI
        projectTitle.textContent = currentProjectMeta.project.title;
        projectAuthor.textContent = "Imported from Zip";
        projectThumb.classList.add('hidden');

        // Setup Version Select (Disable it since we have static files)
        versionSelect.innerHTML = '<option value="zip">Uploaded Zip Content</option>';
        versionSelect.disabled = true;

        // Switch Steps
        stepInput.classList.add('hidden');
        stepVersion.classList.remove('hidden');

    } catch(err) {
        showError("Failed to process zip: " + err.message);
        console.error(err);
    } finally {
        toggleLoading(false);
    }
});

// 3. Download Handler
btnDownload.addEventListener('click', async () => {
    if (!currentProjectMeta) return;

    const includeReadme = document.getElementById('include-readme').checked;
    
    // Determine source: URL or Upload
    let finalAssets = {};

    toggleLoading(true, 'Preparing assets...');

    try {
        if (uploadedAssets) {
            console.log("[Main] Using uploaded zip assets.");
            // Use uploaded zip content
            finalAssets = uploadedAssets;
        } else {
            // Fetch from WebSim
            const version = versionSelect.value;
            console.log(`[Main] Starting Fetch for Project ${currentProjectMeta.project.id} v${version}`);
            toggleLoading(true, 'Downloading assets from WebSim...');
            
            // Fetch assets and HTML independently to prevent HTML 403 blocking assets
            const assetPromise = getAssets(currentProjectMeta.project.id, version);
            const htmlPromise = getProjectHtml(currentProjectMeta.project.id, version).catch(e => {
                console.error("[Main] HTML fetch failed (non-fatal):", e);
                return null;
            });

            const [assetResponse, htmlContent] = await Promise.all([assetPromise, htmlPromise]);

            console.log(`[Main] Fetched ${assetResponse ? assetResponse.length : 0} assets.`);
            console.log(`[Main] HTML Content Present: ${!!htmlContent}`);

            toggleLoading(true, 'Processing files & generating zip...');
            
            finalAssets = await processAssets(assetResponse, currentProjectMeta.project.id, version);
            console.log(`[Main] Final Processed Assets Count: ${Object.keys(finalAssets).length}`);
            console.log(`[Main] Asset Keys:`, Object.keys(finalAssets));

            // Inject the fetched HTML as index.html
            if (htmlContent) {
                finalAssets['index.html'] = new TextEncoder().encode(htmlContent);
            } else if (!finalAssets['index.html']) {
                // If HTML API failed and no index.html in assets, try to synthesize or find fallback
                
                // 1. Try finding any HTML file
                const anyHtml = Object.keys(finalAssets).find(k => k.endsWith('.html'));
                if (anyHtml) {
                    console.warn(`Missing index.html, defaulting to ${anyHtml}`);
                    finalAssets['index.html'] = finalAssets[anyHtml];
                } 
                // 2. Synthesize index.html from script/css if they exist (headless project)
                else {
                    const jsFile = Object.keys(finalAssets).find(k => k.endsWith('.js') && !k.includes('polyfill'));
                    const cssFile = Object.keys(finalAssets).find(k => k.endsWith('.css'));
                    
                    if (jsFile || cssFile) {
                         console.warn("Generating synthetic index.html from assets");
                         const synthHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${currentProjectMeta.project.title || 'Game'}</title>
    ${cssFile ? `<link rel="stylesheet" href="./${cssFile}">` : ''}
    <style>body { margin: 0; background: #000; color: #fff; }</style>
</head>
<body>
    <div id="app"></div>
    ${jsFile ? `<script type="module" src="./${jsFile}"></script>` : ''}
</body>
</html>`;
                        finalAssets['index.html'] = new TextEncoder().encode(synthHtml);
                    } else {
                        console.error("Available Assets:", Object.keys(finalAssets));
                        throw new Error("Failed to retrieve project HTML. API refused access and no 'index.html' or script files found to reconstruct app.");
                    }
                }
            }
        }

        // Generate Zip
        const launchMode = document.getElementById('launch-mode').value;
        const result = await generateDevvitZip(currentProjectMeta, finalAssets, includeReadme, launchMode);

        // Trigger Download
        saveAs(result.blob, result.filename);

    } catch (err) {
        alert("Error generating download: " + err.message);
        console.error(err);
    } finally {
        toggleLoading(false);
    }
});

