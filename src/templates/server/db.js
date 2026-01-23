export const dbHelpers = `
// --- Database Helpers ---
const DB_REGISTRY_KEY = 'sys:registry';

// Helper: Calculate total from order history (Self-healing)
async function recalculateUserTotal(userId) {
    try {
        // 1. Fetch all order IDs for user
        const orderIds = await redis.zRange(\`user_orders:\${userId}\`, 0, -1);
        if (!orderIds || orderIds.length === 0) return 0;

        // 2. Fetch order details
        let total = 0;
        const promises = orderIds.map(id => redis.get(\`order:\${id}\`));
        const results = await Promise.all(promises);
        
        results.forEach(r => {
            if (r) {
                const o = JSON.parse(r);
                if (o.amount) total += parseInt(o.amount) || 0;
            }
        });

        // 3. Heal the cache
        if (total > 0) {
            await redis.set(\`user_total:\${userId}\`, String(total));
        }
        return total;
    } catch (e) {
        console.warn("Recalculate total failed:", e);
        return 0;
    }
}

async function fetchAllData() {
    try {
        const collections = await redis.zRange(DB_REGISTRY_KEY, 0, -1);
        const dbData = {};

        await Promise.all(collections.map(async (item) => {
            const colName = typeof item === 'string' ? item : item.member;
            const raw = await redis.hGetAll(colName);
            const parsed = {};
            for (const [k, v] of Object.entries(raw)) {
                try { parsed[k] = JSON.parse(v); } catch(e) { parsed[k] = v; }
            }
            dbData[colName] = parsed;
        }));

        let user = { 
            id: 'anon', 
            username: 'Guest', 
            avatar_url: 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png' 
        };
        
        try {
            // Try to get current user from context or Reddit API
            if (context.userId) {
                user = { 
                    id: context.userId, 
                    username: context.username || 'RedditUser',
                    avatar_url: user.avatar_url // Default
                };
            }
            
            // Always try to fetch rich profile for snoovatar (Server Source of Truth)
            const currUser = await reddit.getCurrentUser();
            if (currUser) {
                const snoovatarUrl = await currUser.getSnoovatarUrl();
                user = {
                    id: currUser.id,
                    username: currUser.username,
                    // Use Snoovatar if available, else fallback to standard Reddit static default
                    avatar_url: snoovatarUrl ?? 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png'
                };
            }
        } catch(e) { 
            console.warn('User fetch failed', e); 
        }

        // Hydrate User Total (for immediate UI availability)
        if (user && user.id !== 'anon') {
             let total = await redis.get(\`user_total:\${user.id}\`);
             if (!total) {
                 total = await recalculateUserTotal(user.id);
             }
             user.total_tipped = parseInt(total || '0') || 0;
        }

        return { dbData, user };
    } catch(e) {
        console.error('Hydration Error:', e);
        return { dbData: {}, user: null };
    }
}
`;