import { socketUtils } from './socket/utils.js';
import { socketRealtime } from './socket/realtime.js';
import { socketDatabase } from './socket/database.js';

export const websimSocketPolyfill = `
// [WebSim] Realtime & DB Polyfill for Devvit
(function() {
// removed window._currentUser / sanitizeAvatar -> ./socket/utils.js
${socketUtils}

// removed WebsimSocket class -> ./socket/realtime.js
${socketRealtime}

// removed GenericDB / DevvitBridge -> ./socket/database.js
${socketDatabase}

})();
`;