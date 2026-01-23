export const internalRoutes = (safeTitle) => `
// --- Internal Routes (Menu/Triggers) ---
// Note: All internal endpoints must start with /internal/

// Store active presence in Redis (using a single Hash for compliance)
const PRESENCE_HASH_KEY = 'rt:presence:global';
const PRESENCE_TTL_MS = 20000; // 20 seconds (Aligns with client-side 15s prune + buffer)

router.post('/api/realtime/message', async (req, res) => {
    try {
        let msg = req.body;
        
        // Handle Beacon/Keepalive edge cases (Body might be stringified string if middleware misinterprets blob)
        if (typeof msg === 'string') {
            try { msg = JSON.parse(msg); } catch(e) {}
        }
        
        const type = msg.type;
        
        // 1. Handle presence updates - store in single Hash
        if (type === '_ws_presence') {
            const { clientId, user, payload } = msg;
            if (clientId) {
                const data = JSON.stringify({
                    clientId,
                    user,
                    payload,
                    lastSeen: Date.now()
                });
                
                // Use hSet to store in the global presence hash
                await redis.hSet(PRESENCE_HASH_KEY, { [clientId]: data });
                
                // Note: We cannot set TTL on individual hash fields in Redis.
                // Expiration is handled during the GET read (lazy expiration).
            }
        }
        
        // 2. Handle explicit leave
        if (type === '_ws_leave') {
            const { clientId } = msg;
            if (clientId) {
                await redis.hDel(PRESENCE_HASH_KEY, [clientId]);
                // console.log(`[RT] Client left explicitly: ${clientId}`);
            }
        }
        
        // 3. Broadcast to all connected clients
        await realtime.send('global_room', msg);
        
        res.json({ success: true });
    } catch(e) {
        console.error('[Server] Realtime Relay Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// NEW: Get current presence state (called when client connects)
router.get('/api/realtime/presence', async (req, res) => {
    try {
        // Devvit Redis doesn't support keys() or scan(), so we use hGetAll on our known hash.
        const allPresence = await redis.hGetAll(PRESENCE_HASH_KEY) || {};
        
        const now = Date.now();
        const validPresence = [];
        const staleFields = [];

        Object.entries(allPresence).forEach(([clientId, rawStr]) => {
            try {
                const p = JSON.parse(rawStr);
                // Check TTL (lazy expiration)
                if (now - (p.lastSeen || 0) < PRESENCE_TTL_MS) {
                    validPresence.push(p);
                } else {
                    staleFields.push(clientId);
                }
            } catch(e) {
                staleFields.push(clientId);
            }
        });

        // Async cleanup of stale entries (fire and forget)
        if (staleFields.length > 0) {
            redis.hDel(PRESENCE_HASH_KEY, staleFields).catch(err => 
                console.warn('[RT] Cleanup failed:', err)
            );
        }
        
        console.log(\`[RT] Returning \${validPresence.length} active presences\`);
        res.json({ presence: validPresence });
    } catch(e) {
        console.error('[Server] Presence Fetch Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/internal/onInstall', async (req, res) => {
    console.log('App installed!');
    res.json({ success: true });
});

router.post('/internal/createPost', async (req, res) => {
    console.log('Creating game post...');
    
    try {
        // Use the global context object from @devvit/web/server, fallback to headers if needed
        const subredditName = context?.subredditName || req.headers['x-devvit-subreddit-name'];
        console.log('Context Subreddit:', subredditName);

        if (!subredditName) {
            return res.status(400).json({ error: 'Subreddit name is required (context/header missing)' });
        }

        const post = await reddit.submitCustomPost({
            title: '${safeTitle}',
            subredditName: subredditName,
            entry: 'default', // matches devvit.json entrypoint
            userGeneratedContent: {
                text: 'Play this game built with WebSim!'
            }
        });

        res.json({
            showToast: { text: 'Game post created!' },
            navigateTo: post
        });
    } catch (e) {
        console.error('Failed to create post:', e);
        res.status(500).json({ error: e.message });
    }
});
`;