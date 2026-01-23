export const paymentRoutes = `
// --- Tip & Supporter Endpoints (WebSim Porting) ---

router.get('/api/tips', async (req, res) => {
  try {
    const userId = req.query.userId;
    const postId = context.postId;
    
    // 1. Redis Source (Primary for Consistency)
    let orderIds = [];
    try {
      const rawIds = await redis.zRange(\`post_orders:\${postId}\`, 0, -1) || [];
      orderIds = rawIds.map(x => typeof x === 'string' ? x : x.member);
    } catch (e) {
      console.warn("Redis fetch failed:", e);
    }

    // 2. Payments API Fallback (Recovery)
    if (orderIds.length === 0) {
        try {
            const { orders } = await payments.getOrders({ postId: postId, limit: 100 });
            orderIds = (orders || [])
                .filter(o => o.status === 'PAID')
                .map(o => o.id);
        } catch(e) { console.warn("Payments API fallback failed:", e); }
    }
    
    if (orderIds.length === 0) {
        return res.json({ comments: { data: [], meta: { has_next_page: false } } });
    }

    // 3. Fetch Full Order Details from Redis
    const orderPromises = orderIds.map(id => redis.get(\`order:\${id}\`));
    const orderStrings = await Promise.all(orderPromises);
    const orders = orderStrings
      .filter(s => s !== null)
      .map(s => JSON.parse(s));
    
    // 4. Filter by User (if requested)
    const filtered = userId 
      ? orders.filter(o => o.userId === userId)
      : orders;
    
    // 5. Transform to WebSim Comment Format
    const mapped = await Promise.all(filtered.map(async (o) => {
      // Try to get associated comment metadata
      const commentMeta = await redis.hGetAll(\`tip_comment:\${o.id}\`) || {};
      
      const username = commentMeta.username || 'Supporter';
      const avatarUrl = commentMeta.avatar || \`/_websim_avatar_/\${o.userId}\`; 
      
      // Ensure numeric amount
      const amount = typeof o.amount === 'number' ? o.amount : parseInt(o.amount || '0');

      return {
        comment: {
          id: o.id,
          project_id: 'local',
          raw_content: commentMeta.text || \`Tipped \${amount} Gold\`,
          content: { type: 'doc', content: [] },
          created_at: o.createdAt || new Date().toISOString(),
          author: {
            id: o.userId,
            username: username,
            avatar_url: avatarUrl
          },
          card_data: {
            type: 'tip_comment',
            credits_spent: amount
          }
        }
      };
    }));
    
    // Sort by most recent
    mapped.sort((a, b) => new Date(b.comment.created_at) - new Date(a.comment.created_at));

    res.json({
      comments: {
        data: mapped,
        meta: { has_next_page: false }
      }
    });
  } catch (e) {
    console.error("GET /api/tips failed:", e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/user-total/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    let total = await redis.get(\`user_total:\${userId}\`);
    
    if (!total || total === '0') {
        const recalc = await recalculateUserTotal(userId);
        total = String(recalc);
    }
    
    res.json({ total: parseInt(total || '0') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/supporters', async (req, res) => {
  try {
    const postId = context.postId;
    
    const rawIds = await redis.zRange(\`post_orders:\${postId}\`, 0, -1) || [];
    const orderIds = rawIds.map(x => typeof x === 'string' ? x : x.member);
    
    const orderPromises = orderIds.map(id => redis.get(\`order:\${id}\`));
    const orderStrings = await Promise.all(orderPromises);
    const orders = orderStrings
      .filter(s => s !== null)
      .map(s => JSON.parse(s));
    
    const userMap = new Map();

    for (const o of orders) {
      const current = userMap.get(o.userId) || 0;
      userMap.set(o.userId, current + o.amount);
    }
    
    const supporters = Array.from(userMap.entries())
      .map(([uid, amt]) => ({
        userId: uid,
        totalTips: amt,
        username: 'Supporter', 
        avatarUrl: \`/_websim_avatar_/\${uid}\`
      }))\
      .sort((a, b) => b.totalTips - a.totalTips);
    
    res.json({ supporters });
  } catch (e) {
    console.error("GET /api/supporters failed:", e);
    res.status(500).json({ error: e.message });
  }
});

// --- Payments Endpoints (Fulfillment) ---
router.post('/internal/payments/fulfill', async (req, res) => {
  try {
    const order = req.body.order || req.body;
    
    if (!order || order.status !== 'PAID') {
      return res.json({ success: false, reason: 'Order not paid or invalid' });
    }
    
    const product = order.products && order.products[0];
    const sku = product ? product.sku : '';
    const match = sku.match(/(\\d+)/); 
    const amount = match ? parseInt(match[1]) : 0;
    
    if (amount === 0) {
      return res.json({ success: false, reason: 'Invalid SKU' });
    }
    
    let userId = order.userId || order.user?.id || order.author?.id || order.customerId || req.body.userId || context.userId;
    const orderId = order.id;
    let postId = order.postId || order.post?.id || context.postId;
    
    // Recovery Phase 1
    if (!userId && amount > 0) {
        try {
            const pattern = \`pending_tip:*:\${amount}\`;
            const keys = await redis.keys(pattern);
            if (keys && keys.length > 0) {
                const recoveredKey = keys[0];
                const parts = recoveredKey.split(':');
                if (parts.length >= 3) userId = parts[1];
            }
        } catch(e) {}
    }

    if (!userId) {
      return res.json({ success: false, reason: 'Missing userId' });
    }
    
    // Recovery Phase 2
    let pendingCommentData = null;
    let pendingKey = \`pending_tip:\${userId}:\${amount}\`;
    
    try {
        const rawPending = await redis.get(pendingKey);
        if (rawPending) {
            pendingCommentData = JSON.parse(rawPending);
            if (!postId && pendingCommentData.postId) {
                postId = pendingCommentData.postId;
                console.log(\`[Fulfill] Recovered postId \${postId} from pending tip\`);
            }
        }
    } catch(e) { console.warn("[Fulfill] Pending read error", e); }

    console.log(\`[Fulfill] Order \${orderId} | User \${userId} | Amount \${amount} | Post \${postId}\`);

    const existingOrder = await redis.get(\`order:\${orderId}\`);
    if (!existingOrder) {
        const totalKey = \`user_total:\${userId}\`;
        const currentTotal = await redis.get(totalKey) || '0';
        await redis.set(totalKey, String(parseInt(currentTotal) + amount));
        
        if (postId) {
          await redis.incrBy(\`tips:\${postId}:\${userId}\`, amount);
        }
    }

    await redis.set(\`order:\${orderId}\`, JSON.stringify({
      id: orderId,
      userId: userId,
      postId: postId,
      amount: amount,
      sku: sku,
      createdAt: order.createdAt || new Date().toISOString(),
      status: 'PAID'
    }));
    
    await redis.zAdd(\`user_orders:\${userId}\`, { member: orderId, score: Date.now() });
    
    if (postId) {
      await redis.zAdd(\`post_orders:\${postId}\`, { member: orderId, score: Date.now() });
    }
    
    if (pendingCommentData) {
      try {
        console.log(\`[Fulfill] Linking Pending Comment \${pendingCommentData.commentId} to Order \${orderId}\`);
        
        const metadata = {
          text: pendingCommentData.text || '',
          credits: String(amount),
          username: pendingCommentData.username || 'Supporter',
          avatar: pendingCommentData.avatar || '',
          type: 'tip_comment',
          credits_spent: String(amount)
        };
        
        await redis.hSet(\`tip_comment:\${orderId}\`, metadata);
        
        if (pendingCommentData.commentId) {
            await redis.hSet(\`tip_comment:\${pendingCommentData.commentId}\`, metadata);
        }
        
        await redis.del(pendingKey);
      } catch(e) {}
    }
    
    return res.json({ success: true });
  } catch (e) {
    console.error('Payment Fulfillment Error:', e);
    res.status(500).json({ success: false, reason: e.message });
  }
});

router.post('/internal/payments/refund', async (req, res) => {
    res.json({ success: true });
});
`;