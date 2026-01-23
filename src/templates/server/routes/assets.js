export const assetRoutes = `
// --- Avatar Lookup Route (Client Injection) ---
router.get('/_websim_avatar_/:username', async (req, res) => {
    // Redirect to proxy which handles the lookup
    res.redirect('/api/proxy/avatar/' + req.params.username);
});

router.get('/api/lookup/avatar/:username', async (req, res) => {
    const { username } = req.params;
    const defaultAvatar = 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png';
    
    if (username === 'guest' || username === 'null' || !username) {
        return res.json({ url: defaultAvatar });
    }

    try {
        let user;
        // Handle Reddit User IDs (t2_...) used in /api/tips and /api/supporters
        if (username.startsWith('t2_')) {
            user = await reddit.getUserById(username);
        } else {
            user = await reddit.getUserByUsername(username);
        }

        let url = null;
        if (user) {
            url = await user.getSnoovatarUrl();
        }
        res.json({ url: url || defaultAvatar });
    } catch (e) {
        console.warn('Avatar lookup failed for', username, e.message);
        res.json({ url: defaultAvatar });
    }
});

// --- WebSim Search Proxies ---
router.get('/api/v1/search/assets', async (req, res) => {
    try {
        const query = new URLSearchParams(req.query).toString();
        const response = await fetch(\`https://websim.ai/api/v1/search/assets?\${query}\`);
        if (!response.ok) return res.status(response.status).json({ error: 'Upstream Error' });
        const data = await response.json();
        res.json(data);
    } catch (e) {
        console.error('Search Proxy Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/v1/search/assets/relevant', async (req, res) => {
    try {
        const query = new URLSearchParams(req.query).toString();
        const response = await fetch(\`https://websim.ai/api/v1/search/assets/relevant?\${query}\`);
        if (!response.ok) return res.status(response.status).json({ error: 'Upstream Error' });
        const data = await response.json();
        res.json(data);
    } catch (e) {
        console.error('Search Proxy Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// --- Avatar Proxy Route (Legacy/Fallback) ---
router.get('/api/proxy/avatar/:username', async (req, res) => {
    const { username } = req.params;
    try {
        let user;
        // Handle Reddit User IDs (t2_...)
        if (username.startsWith('t2_')) {
            user = await reddit.getUserById(username);
        } else {
            user = await reddit.getUserByUsername(username);
        }

        let url = null;
        if (user) {
            url = await user.getSnoovatarUrl();
        }
        res.redirect(url || 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png');
    } catch (e) {
        // Fallback silently if user not found or API error
        res.redirect('https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png');
    }
});

// --- JSON "File" Upload Routes (Redis-backed) ---
router.post('/api/json/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const data = req.body;
        // Persist JSON to Redis
        await redis.set('json:' + key, JSON.stringify(data));
        res.json({ ok: true, url: '/api/json/' + key });
    } catch(e) {
        console.error('JSON Upload Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/json/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const data = await redis.get('json:' + key);
        if (!data) return res.status(404).json({ error: 'Not found' });
        
        // Return as proper JSON
        res.header('Content-Type', 'application/json');
        res.send(data);
    } catch(e) {
        console.error('JSON Load Error:', e);
        res.status(500).json({ error: e.message });
    }
});
`;