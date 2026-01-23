import { cleanName } from '../processors/utils.js';

export async function downloadExternalAssets(externalUrls, staticFiles, urlMap) {
    if (externalUrls.size > 0) {
        const downloadPromises = Array.from(externalUrls).map(async (url) => {
            try {
                const res = await fetch(url);
                if (!res.ok) return;
                const blob = await res.arrayBuffer();

                let name = url.split('/').pop().split('?')[0];
                if (!name || name.length > 50) name = 'asset';
                
                if (!name.includes('.')) {
                    const type = res.headers.get('content-type') || '';
                    if (type.includes('audio')) name += '.mp3';
                    else if (type.includes('image')) name += '.png';
                }

                const clean = cleanName(name);
                let finalName = clean;
                let counter = 1;
                while (staticFiles[finalName]) {
                    const parts = clean.split('.');
                    const ext = parts.pop();
                    const base = parts.join('.');
                    finalName = `${base}_${counter}.${ext}`;
                    counter++;
                }

                staticFiles[finalName] = new Uint8Array(blob);
                urlMap.set(url, finalName);
            } catch (e) {
                console.warn("Failed to download external asset:", url);
            }
        });
        
        await Promise.all(downloadPromises);
    }
}