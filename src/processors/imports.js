// Detects libraries and converts CDN URLs to NPM package names
export function normalizeImport(source, dependencies) {
    if (!source || typeof source !== 'string') return source;
    if (source.startsWith('.') || source.startsWith('/') || source.startsWith('data:') || source.startsWith('blob:')) return source;

    // 1. Remotion Handling
    if (source.includes('@websim/remotion')) {
        dependencies['remotion'] = '^4.0.0';
        dependencies['@remotion/player'] = '^4.0.0';
        dependencies['react'] = '^18.2.0';
        dependencies['react-dom'] = '^18.2.0';
        // Route via bridge to handle mixed exports (Player + hooks)
        return '/remotion_bridge';
    }

    // 2. Three.js Handling
    if (source.includes('/three') || source === 'three') {
        dependencies['three'] = '^0.160.0';
        
        // Handle Addons (OrbitControls, GLTFLoader, etc.)
        // Detect "examples/jsm" or "addons"
        if (source.includes('examples/jsm') || source.includes('addons') || source.includes('controls')) {
            // Try to extract the path after 'jsm'
            const match = source.match(/(?:examples\/jsm|addons)\/(.+)/);
            if (match) {
                let suffix = match[1];
                // Strip query params if any
                suffix = suffix.split('?')[0];
                if (!suffix.endsWith('.js')) suffix += '.js';
                return `three/examples/jsm/${suffix}`;
            }
        }
        return 'three';
    }

    // 2. Tween.js
    if (source.toLowerCase().includes('tween')) {
        dependencies['@tweenjs/tween.js'] = '^23.1.0';
        return '@tweenjs/tween.js';
    }

    // 3. Pixi.js
    if (source.toLowerCase().includes('pixi')) {
        dependencies['pixi.js'] = '^7.0.0';
        return 'pixi.js';
    }
    
    // 3.5 React CDN Runtime Fix
    if (source.includes('react')) {
            if (source.includes('jsx-dev-runtime') || source.includes('jsx-runtime')) {
                dependencies['react'] = '^18.2.0';
                // We preserve the dev-runtime import path so our Vite alias can intercept it with a proxy
                // Rewriting to jsx-runtime directly breaks code expecting jsxDEV export
                return source.includes('jsx-dev-runtime') ? 'react/jsx-dev-runtime' : 'react/jsx-runtime';
            }
    }

    // 4. Generic esm.sh / unpkg Handling
    // Capture package name, optional version, AND subpath
    // Updated to handle scoped packages correctly (e.g. @remotion/player)
    const pkgMatch = source.match(/(?:esm\.sh|unpkg\.com|jsdelivr\.net)\/(?:npm\/)?((?:@[^/@]+\/)?[^/@]+)(?:@([^/?]+))?(\/[^?]*)?/);
    if (pkgMatch) {
        const pkg = pkgMatch[1];
        const ver = pkgMatch[2];
        const path = pkgMatch[3] || '';

        // Filter out common non-packages or mistakes
        if (pkg !== 'gh' && pkg !== 'npm') {
            // Update dependency if new or more specific than 'latest'
            const current = dependencies[pkg];
            if (!current || (current === 'latest' && ver)) {
                dependencies[pkg] = ver ? `^${ver}` : 'latest';
            }
            // Return package + subpath (e.g. react/jsx-dev-runtime)
            return pkg + path;
        }
    }

    // 5. Bare Specifiers (Import Maps / Node Resolution)
    // If it looks like a package name (no path separators, not a URL), add to dependencies.
    if (!source.match(/^https?:/)) {
        if (source === 'websim') return 'websim'; // Handled by Vite alias, do not add to dependencies

        // Handle scoped packages (@org/pkg) or regular (pkg) potentially followed by /path
        const bareMatch = source.match(/^(@[^/]+\/[^/]+|[^/]+)/);
        if (bareMatch) {
            const pkgName = bareMatch[1];
            
            // Prevent adding scope-only packages (e.g. "@remotion") which cause npm install errors
            if (pkgName.startsWith('@') && !pkgName.includes('/')) {
                // If it's specifically @remotion, the user might mean 'remotion' package
                if (pkgName === '@remotion') {
                        if (!dependencies['remotion']) dependencies['remotion'] = 'latest';
                        return 'remotion';
                }
                return source; 
            }

            if (!dependencies[pkgName]) {
                dependencies[pkgName] = 'latest';
            }
            return source;
        }
    }
    
    // Return original if we can't map it (Vite might fail, but best effort)
    return source;
}