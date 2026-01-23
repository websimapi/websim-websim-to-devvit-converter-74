import * as acorn from 'https://esm.sh/acorn@8.11.3';
import { simple as walkSimple } from 'https://esm.sh/acorn-walk@8.3.2';
import MagicString from 'https://esm.sh/magic-string@0.30.5';
import { uint8ToString } from './utils.js';
import { normalizeImport } from './imports.js';

export function processJS(jsContent, filename = 'script.js', analyzer) {
    let code = uint8ToString(jsContent);

    // React/JSX Detection: Ensure dependencies are tracked if JSX is present
    if (/<[A-Z][A-Za-z0-9]*[\s>]/g.test(code) || /className=/g.test(code)) {
        if (!analyzer.dependencies['react']) analyzer.dependencies['react'] = '^18.2.0';
        if (!analyzer.dependencies['react-dom']) analyzer.dependencies['react-dom'] = '^18.2.0';
    }
    
    // Generic WebSim URL Replacements (Fix CSP issues & Hot-swap Identity)
    // We replace WebSim avatar URLs with the placeholder "/_websim_avatar_/username".
    // This allows the client-side injector to fetch the real URL via API and handle fallbacks/transitions.
    code = code.replace(/https:\/\/images\.websim\.ai\/avatar\/|https:\/\/images\.websim\.com\/avatar\//g, '/_websim_avatar_/');
    
    // Replace full literal avatar strings if found (e.g. "https://.../avatar/someuser")
    code = code.replace(/["']https:\/\/images\.websim\.(ai|com)\/avatar\/([^"']+)["']/g, '"/_websim_avatar_/$2"');

    // Calculate relative path to root for asset corrections
    const depth = (filename.match(/\//g) || []).length;
    const rootPrefix = depth > 0 ? '../'.repeat(depth) : './';

    let ast;
    const magic = new MagicString(code);
    let hasChanges = false;

    try {
        ast = acorn.parse(code, { sourceType: 'module', ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowHashBang: true });
        
        const rewrite = (node) => {
            if (node.source && node.source.value) {
                const newVal = normalizeImport(node.source.value, analyzer.dependencies);
                if (newVal !== node.source.value) {
                    magic.overwrite(node.source.start, node.source.end, JSON.stringify(newVal));
                    hasChanges = true;
                }
            }
        };

        const rewritePaths = (node) => {
            if (node.type === 'Literal' && typeof node.value === 'string') {
                const val = node.value;

                // 1. Check URL Map (Exact Match for external or remapped assets)
                if (analyzer.urlMap.has(val)) {
                    const cleanName = analyzer.urlMap.get(val);
                    // Serve from root (public folder)
                    const newVal = `/${cleanName}`; 
                    magic.overwrite(node.start, node.end, JSON.stringify(newVal));
                    hasChanges = true;
                    return;
                }

                // 2. Handle standard local paths that weren't mapped
                if (val.startsWith('/') && !val.startsWith('//') && /\.(png|jpg|jpeg|gif|mp3|wav|ogg|glb|gltf|svg|json)$/i.test(val)) {
                    const newVal = rootPrefix + val.substring(1);
                    magic.overwrite(node.start, node.end, JSON.stringify(newVal));
                    hasChanges = true;
                }
            }
        };

        walkSimple(ast, {
            ImportDeclaration: rewrite,
            ExportNamedDeclaration: rewrite,
            ExportAllDeclaration: rewrite,
            ImportExpression: (node) => {
                if (node.source.type === 'Literal') {
                    const newVal = normalizeImport(node.source.value, analyzer.dependencies);
                    if (newVal !== node.source.value) {
                        magic.overwrite(node.source.start, node.source.end, JSON.stringify(newVal));
                        hasChanges = true;
                    }
                }
            },
            Literal: rewritePaths,
            TemplateLiteral: (node) => {
                // Smart Swap: Detect Avatar URLs
                // Pattern: `.../avatar/${user.username}` OR `.../_websim_avatar_/${user.username}`
                if (node.quasis.length === 2 && node.expressions.length === 1) {
                    const prefix = node.quasis[0].value.raw;
                    const isWebSim = prefix.includes('images.websim.ai/avatar/') || prefix.includes('images.websim.com/avatar/');
                    const isPlaceholder = prefix.includes('/_websim_avatar_/');
                    
                    if (isWebSim || isPlaceholder) {
                        const expr = node.expressions[0];
                        if (expr.type === 'MemberExpression' && expr.property.type === 'Identifier' && expr.property.name === 'username') {
                            const objectCode = code.slice(expr.object.start, expr.object.end);
                            // Prefer cached avatar_url, fallback to injector placeholder
                            const replacement = `(${objectCode}.avatar_url || "/_websim_avatar_/" + ${objectCode}.username)`;
                            magic.overwrite(node.start, node.end, replacement);
                            hasChanges = true;
                        }
                    }
                }
            },
            BinaryExpression: (node) => {
                // Smart Swap: Detect Avatar URL Concatenation
                // Pattern: "https://.../avatar/" + post.username
                if (node.operator === '+') {
                    const left = node.left;
                    const right = node.right;
                    
                    if (left.type === 'Literal' && typeof left.value === 'string') {
                        const val = left.value;
                        const isWebSim = val.includes('images.websim.ai/avatar/') || val.includes('images.websim.com/avatar/');
                        const isPlaceholder = val.includes('/_websim_avatar_/');
                        
                        if (isWebSim || isPlaceholder) {
                            if (right.type === 'MemberExpression' && right.property.type === 'Identifier' && right.property.name === 'username') {
                                const objectCode = code.slice(right.object.start, right.object.end);
                                const replacement = `(${objectCode}.avatar_url || "/_websim_avatar_/" + ${objectCode}.username)`;
                                magic.overwrite(node.start, node.end, replacement);
                                hasChanges = true;
                            }
                        }
                    }
                }
            }
        });

    } catch (e) {
        // Regex Fallback for JSX or syntax errors (Acorn fails on JSX)
        // Matches:
        // 1. import ... from "..."
        // 2. import "..."
        // 3. export ... from "..."
        // 4. import("...") (dynamic)
        const importRegex = /(import\s+(?:[\w\s{},*]+)\s+from\s+['"])([^'"]+)(['"])|(import\s+['"])([^'"]+)(['"])|(from\s+['"])([^'"]+)(['"])|(import\s*\(\s*['"])([^'"]+)(['"]\s*\))/g;
        let match;
        const originalCode = code; 
        
        while ((match = importRegex.exec(originalCode)) !== null) {
            const url = match[2] || match[5] || match[8] || match[11];
            const prefix = match[1] || match[4] || match[7] || match[10];
            
            if (url) {
                const newVal = normalizeImport(url, analyzer.dependencies);
                if (newVal !== url) {
                    const start = match.index + prefix.length;
                    const end = start + url.length;
                    magic.overwrite(start, end, newVal);
                    hasChanges = true;
                }
            }
        }
    }

    // [Fix] Game Loading Hang: Detect image loader failures
    // Many games use a pattern like `if (index >= urlList.length) return;` which fails to hide the loader if assets 404.
    // We inject a fallback hideLoader() call.
    // Also handling tighter minified spacing variants
    const loaderHangPattern = /if\s*\(\s*([a-zA-Z0-9_]+)\s*>=\s*([a-zA-Z0-9_.]+)\.length\s*\)\s*\{?\s*(?:\/\/.*[\r\n\s]*)?return;?\s*\}?/g;
    if (loaderHangPattern.test(code)) {
        code = code.replace(loaderHangPattern, (match, idx, list) => {
            return `if (${idx} >= ${list}.length) { try { if(typeof hideLoader === 'function') hideLoader(); else if(window.hideLoader) window.hideLoader(); } catch(e){} return; }`;
        });
        // We modified code string directly, so we reset MagicString to stay in sync if we were doing more complex ops,
        // but here we are returning at the end. However, since we mix MagicString and string replacement, we must be careful.
        // Re-init magic string for the return value or just return code if no other changes pending.
        // Ideally we should use magic.overwrite, but finding the exact indices for regex match is complex with multiple matches.
        // For simplicity in this specific processor flow, we'll return the modified code directly if we changed it here,
        // but we must respect previous changes.
        // Re-creating MagicString from the potentially modified code:
        const newMagic = new MagicString(code);
        return newMagic.toString(); 
    }

    // Remotion License Injection for <Player /> components
    // We iterate all <Player> tags and ensure the prop is present.
    if (code.includes('<Player')) {
            const playerRegex = /<Player([\s\n\r/>])/g;
            let match;
            while ((match = playerRegex.exec(code)) !== null) {
                // Check if the prop already exists in the vicinity (heuristic: next 500 chars)
                // This avoids duplicate injection if the user already added it or if we run multiple times
                const vicinity = code.slice(match.index, match.index + 500);
                const closeIndex = vicinity.indexOf('>');
                const tagContent = closeIndex > -1 ? vicinity.slice(0, closeIndex) : vicinity;
                
                if (!tagContent.includes('acknowledgeRemotionLicense')) {
                    // Insert prop right after <Player, ensuring space
                    magic.appendLeft(match.index + 7, ' acknowledgeRemotionLicense={true}');
                    hasChanges = true;
                }
            }
    }

    return hasChanges ? magic.toString() : code;
}