import { makeRequest } from './core.js';

export function searchAssets(query, mimeTypePrefix, limit = 20) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (mimeTypePrefix) params.set('mime_type_prefix', mimeTypePrefix);
    if (limit) params.set('limit', limit);
    return makeRequest(`/search/assets?${params.toString()}`);
}

export function searchRelevantAssets(query, limit = 20) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (limit) params.set('limit', limit);
    return makeRequest(`/search/assets/relevant?${params.toString()}`);
}