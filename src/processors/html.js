import { uint8ToString } from './utils.js';
import { normalizeImport } from './imports.js';
import { processJS } from './js.js';

export function processHTML(htmlContent, filename, analyzer) {
    let html = uint8ToString(htmlContent);

    // Rewrite Mapped URLs in HTML
    analyzer.urlMap.forEach((cleanName, originalUrl) => {
        // Replace instances of originalUrl with /cleanName
        if (originalUrl && html.includes(originalUrl)) {
            html = html.split(originalUrl).join(`/${cleanName}`);
        }
    });

    const extractedScripts = [];
    let scriptCounter = 0;

    // Ensure DOCTYPE
    if (!html.trim().toLowerCase().startsWith('<!doctype')) {
        html = '<!DOCTYPE html>\n' + html;
    }

    // 1. Remove Import Maps but extract dependencies
    html = html.replace(/<script\s+type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi, (match, content) => {
        try {
            const map = JSON.parse(content);
            if (map.imports) {
                Object.values(map.imports).forEach(url => normalizeImport(url, analyzer.dependencies));
            }
        } catch (e) { /* ignore parse errors */ }
        return '<!-- Import Map Removed -->';
    });

    // 2. Identify and Process Remote Scripts (CDNs)
    html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, content) => {
        const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
        
        // Case A: Remote Script
        if (srcMatch && srcMatch[1].match(/^(https?:|\/\/)/i)) {
            const src = srcMatch[1];
            
            // Tailwind CSS (Play CDN)
            if (src.includes('cdn.tailwindcss.com')) {
                analyzer.hasTailwind = true;
                analyzer.dependencies['tailwindcss'] = '^3.4.0';
                analyzer.dependencies['postcss'] = '^8.4.0';
                analyzer.dependencies['autoprefixer'] = '^10.4.0';
                return '<!-- Tailwind CDN converted to Build Step -->';
            }

            // Babel Standalone
            if (src.includes('babel-standalone') || src.includes('babel.min.js')) {
                return '<!-- Babel Standalone removed (Vite handles JSX) -->';
            }

            // General CDN Map
            const pkgName = normalizeImport(src, analyzer.dependencies);
            if (pkgName && pkgName !== src) {
                const barePkg = pkgName.split('/')[0].replace(/^@/, '').split('/')[0]; // Extract base package
                
                if (['react', 'react-dom', 'three', 'pixi.js', 'jquery', 'p5', 'phaser'].includes(barePkg) || 
                    ['react', 'react-dom'].includes(pkgName)) {
                    analyzer.globalShims.add(barePkg === 'react' ? 'react' : (barePkg === 'react-dom' ? 'react-dom' : barePkg));
                }
                
                return `<!-- Remote Script ${src} bundled as ${pkgName} -->`;
            }
            
            return `<!-- BLOCKED REMOTE SCRIPT: ${src} -->`;
        }

        // Case B: Local Script
        if (srcMatch) {
            let newTag = match;
            if (!attrs.includes('type="module"')) {
                if (attrs.includes('type=')) {
                    newTag = newTag.replace(/type=["'](text\/javascript|application\/javascript)["']/i, 'type="module"');
                } else {
                    newTag = newTag.replace(/<script/i, '<script type="module"');
                }
            }
            if (attrs.includes('type="text/babel"')) {
                newTag = newTag.replace('type="text/babel"', 'type="module"');
            }
            return newTag;
        }

        // Case C: Inline Script
        if (!content.trim()) return match;
        if (attrs.includes('application/json')) return match;

        scriptCounter++;
        const safeName = filename.replace(/[^\w]/g, '_');
        // Use .jsx extension if babel type or typical React code to hint Vite
        const isBabel = attrs.includes('type="text/babel"') || 
                       content.includes('React.') || 
                       content.includes('ReactDOM.') ||
                       /<[A-Z][A-Za-z0-9]*[\s>]/g.test(content) || 
                       /className=/g.test(content);
        const ext = isBabel ? 'jsx' : 'js';
        const newScriptName = `${safeName}_inline_${scriptCounter}.${ext}`;
        
        const processedContent = processJS(content, newScriptName, analyzer);
        extractedScripts.push({ filename: newScriptName, content: processedContent });

        // Force module
        let newAttrs = attrs;
        if (attrs.includes('type="text/babel"')) newAttrs = newAttrs.replace('type="text/babel"', 'type="module"');
        else if (!newAttrs.includes('type="module"') && !newAttrs.includes('type="importmap"')) newAttrs += ' type="module"';

        return `<script src="./${newScriptName}" ${newAttrs}></script>`;
    });

    // 3. Inject Polyfills & Styles
    // We add a style to hide images that are waiting for the avatar injector to prevent broken icon flash
    // Use single quotes for selector to avoid attribute parsing issues in some environments
    const styles = `<style>img[src*='/_websim_avatar_/'] { opacity: 0; transition: opacity 0.2s; }</style>`;
    const polyfills = `<script type="module" src="./websim_polyfills.js"></script>`;
    
    if (html.includes('<head>')) {
        html = html.replace('<head>', '<head>' + styles + polyfills);
    } else {
        html = styles + polyfills + '\n' + html;
    }

    // 4. Remove inline event handlers
    html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');

    // 5. Replace WebSim Avatar URLs in HTML attributes
    // Replaces https://images.websim.ai/avatar/username with /_websim_avatar_/username (triggering client-side injector)
    html = html.replace(/https:\/\/images\.websim\.(?:ai|com)\/avatar\/([^"'\s]+)/g, '/_websim_avatar_/$1');

    return { html, extractedScripts };
}