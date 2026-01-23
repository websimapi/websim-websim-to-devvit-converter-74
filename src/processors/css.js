import { uint8ToString } from './utils.js';

export function processCSS(cssContent, filename = 'style.css') {
    const css = uint8ToString(cssContent);
    
    const depth = (filename.match(/\//g) || []).length;
    const rootPrefix = depth > 0 ? '../'.repeat(depth) : './';

    // Replace absolute paths in url() with relative ones
    // e.g. url(/images/bg.png) -> url(./images/bg.png) or url(../images/bg.png)
    return css.replace(/url\(\s*(['"]?)(\/[^)'"]+)\1\s*\)/gi, (match, quote, path) => {
        if (path.startsWith('//')) return match; // Skip protocol-relative
        return `url(${quote}${rootPrefix}${path.substring(1)}${quote})`;
    });
}