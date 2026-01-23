export const coreRoutes = `
// --- API Routes (Client -> Server) ---
// Note: All client-callable endpoints must start with /api/

router.get('/api/init', async (_req, res) => {
    const data = await fetchAllData();
    res.json(data);
});

// Polyfill Endpoint: Get Project/Context Info
router.get('/api/project', async (_req, res) => {
    try {
        const { postId, subredditName, userId } = context;
        // Map Devvit Context to WebSim Project Structure
        res.json({
            id: postId || 'local-dev',
            title: subredditName ? \`r/\${subredditName}\` : 'Devvit Project',
            current_version: '1',
            owner: { 
                id: subredditName || 'community',
                username: subredditName || 'community' 
            },
            context: { postId, subredditName, userId }
        });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/user', async (_req, res) => {
    const { user } = await fetchAllData();
    res.json(user);
});

router.get('/api/identity', async (_req, res) => {
    const { user } = await fetchAllData();
    res.json(user);
});

router.post('/api/save', async (req, res) => {
    try {
        const { collection, key, value } = req.body;
        if (!collection || !key) return res.status(400).json({ error: 'Missing collection or key' });

        // Ensure value is safe to stringify (undefined -> null)
        const safeValue = value === undefined ? null : value;

        await redis.hSet(collection, { [key]: JSON.stringify(safeValue) });
        await redis.zAdd(DB_REGISTRY_KEY, { member: collection, score: Date.now() });
        res.json({ success: true, collection, key });
    } catch(e) {
        console.error('DB Save Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/load', async (req, res) => {
    try {
        const { collection, key } = req.body;
        const value = await redis.hGet(collection, key);
        res.json({ collection, key, value: value ? JSON.parse(value) : null });
    } catch(e) {
        console.error('DB Get Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/delete', async (req, res) => {
    try {
        const { collection, key } = req.body;
        if (!collection || !key) return res.status(400).json({ error: 'Missing collection or key' });

        await redis.hDel(collection, [key]);
        res.json({ success: true, collection, key });
    } catch(e) {
        console.error('DB Delete Error:', e);
        res.status(500).json({ error: e.message });
    }
});
`;