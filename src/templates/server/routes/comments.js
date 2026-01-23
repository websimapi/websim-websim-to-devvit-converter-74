export const commentRoutes = `
// --- Comment API (WebSim Polyfill) ---
router.get('/api/comments', async (req, res) => {
    try {
        const postId = context.postId;
        if (!postId) return res.json({ comments: { data: [], meta: {} } });

        const onlyTips = req.query.only_tips === 'true';

        // Get comments from Reddit
        let comments = [];
        try {
            // reddit.getComments returns a Promise<Listing<Comment>>
            const listing = await reddit.getComments({
                postId: postId,
                limit: onlyTips ? 100 : 50
            });
            // Convert listing to array safely if it's iterable
            comments = listing || [];
            if (listing && typeof listing.all === 'function') {
                 // Some versions of Devvit client expose .all()
                 comments = await listing.all();
            }
        } catch (e) {
            console.warn('Reddit API getComments failed:', e);
            comments = [];
        }

        // Transform to WebSim format
        let data = await Promise.all(comments.map(async (c) => {
            // Check for tip metadata (Standardized on tip_comment: prefix)
            const metaKey = \`tip_comment:\${c.id}\`;
            const meta = await redis.hGetAll(metaKey);
            const isTip = meta && (meta.type === 'tip_comment' || parseInt(meta.credits || '0') > 0);
            
            // Filter early if we only want tips
            if (onlyTips && !isTip) return null;

            return {
                comment: {
                    id: c.id,
                    project_id: 'local',
                    raw_content: c.body,
                    content: { type: 'doc', content: [] }, // simplified structure
                    author: {
                        id: c.authorId,
                        username: c.authorName,
                        avatar_url: '/_websim_avatar_/' + c.authorName
                    },
                    reply_count: 0, 
                    created_at: c.createdAt.toISOString(),
                    parent_comment_id: c.parentId.startsWith('t1_') ? c.parentId : null,
                    card_data: isTip ? {
                        type: 'tip_comment',
                        credits_spent: parseInt(meta.credits_spent || meta.credits || '0')\n                    } : null
                }
            };
        }));

        // Remove filtered items
        data = data.filter(item => item !== null);

        res.json({
            comments: {
                data: data,
                meta: { has_next_page: false, end_cursor: null }
            }
        });

    } catch (e) {
        console.error('Fetch Comments Endpoint Error:', e);
        // Return valid empty response on error to prevent client "Failed to fetch" crashes
        res.json({ comments: { data: [], meta: {} } });
    }
});

router.post('/api/comments', async (req, res) => {
  try {
    const { content, parentId, credits } = req.body;
    const postId = context.postId;
    
    const text = content || '';
    const targetId = parentId || postId;
    
    if (!targetId) return res.status(400).json({ error: 'No target ID (Post Context missing)' });

    // Submit comment to Reddit
    const result = await reddit.submitComment({
      id: targetId,
      text: text || ' ', // Reddit requires non-empty body
      runAs: 'USER'
    });
    
    // If this comment is a TIP, create a "Pending Link" for the fulfillment handler to find
    if (credits && parseInt(credits) > 0) {
      const user = await reddit.getCurrentUser();
      const userId = user?.id || context.userId;
      const amount = parseInt(credits);
      
      // Key: pending_tip:{userId}:{amount}
      const pendingKey = \`pending_tip:\${userId}:\${amount}\`;
      
      await redis.set(pendingKey, JSON.stringify({
        commentId: result.id,
        postId: postId,
        text: text,
        username: user?.username || 'User',
        avatar: user?.profileImage || '',
        timestamp: Date.now()
      }), { 
        ex: 300 // Expire after 5 minutes
      });
      
      console.log(\`[Comment] Pending Tip Link: \${pendingKey} (User: \${userId}, Amount: \${amount}) -> Comment: \${result.id}\`);
      
      // Also store by comment ID immediately, just in case
      await redis.hSet(\`tip_comment:\${result.id}\`, {
        text: text,
        credits: String(credits),
        username: user?.username || 'User',
        avatar: user?.profileImage || '' 
      });
    }
    
    res.json({ success: true, id: result.id });
  } catch (e) {
    console.error('Post Comment Error:', e);
    res.status(500).json({ error: e.message });
  }
});
`;