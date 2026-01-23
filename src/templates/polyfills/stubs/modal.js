export const modalStub = `
    // Helper function exposed for websim.postComment to use
    function _showWebSimModal(data, resolve, originalFetch) {
        // UI Injection for Comment/Tip Modal
        // We render a custom HTML modal to mimic the WebSim "staging" step
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:sans-serif;color:white;';
        
        const prefilled = data.content || '';
        
        // Resolve Tier Upfront
        let tipTier = 0;
        if (data.credits && Number(data.credits) > 0) {
            const validTiers = [5, 25, 50, 100, 150, 250, 500, 1000, 2500];
            const requested = Number(data.credits);
            tipTier = validTiers.find(t => t >= requested) || validTiers[validTiers.length - 1];
        }

        const isTip = tipTier > 0;
        
        let innerHtml = '';
        
        if (isTip) {
            innerHtml = \`
                <div style="background:#1e293b;padding:24px;border-radius:12px;width:90%;max-width:400px;text-align:center;border:1px solid #334155;box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
                    <h3 style="margin:0 0 16px 0;">💛 Support the Creator</h3>
                    <p style="color:#94a3b8;margin-bottom:24px;line-height:1.5;">
                        This app is requesting a <strong>\${tipTier} Gold</strong> tip.
                    </p>
                    <div id="ws-tip-status" style="margin-bottom:20px; font-size:0.9rem; color:#f8fafc; min-height:1.2em;"></div>
                    <div style="display:flex;gap:12px;">
                        <button id="ws-modal-cancel" style="background:transparent;color:#94a3b8;border:1px solid #334155;padding:10px 16px;border-radius:6px;cursor:pointer;flex:1;">Cancel</button>
                        <button id="ws-modal-tip" style="background:#FF4500;color:white;border:none;padding:10px 24px;border-radius:6px;font-weight:bold;cursor:pointer;flex:2;">Send Tip</button>
                    </div>
                </div>
            \`;
        } else {
            innerHtml = \`
                <div style="background:#1e293b;padding:24px;border-radius:12px;width:90%;max-width:500px;display:flex;flex-direction:column;gap:16px;border:1px solid #334155;">
                    <h3 style="margin:0;">💬 Post a Comment</h3>
                    <textarea id="ws-comment-input" style="width:100%;height:100px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:white;padding:12px;font-family:inherit;resize:none;box-sizing:border-box;">\${prefilled}</textarea>
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button id="ws-modal-cancel" style="background:transparent;color:#94a3b8;border:none;padding:10px 16px;cursor:pointer;font-weight:600;">Cancel</button>
                        <button id="ws-modal-post" style="background:#FF4500;color:white;border:none;padding:10px 24px;border-radius:6px;font-weight:bold;cursor:pointer;">Post Comment</button>
                    </div>
                </div>
            \`;
        }
        
        modal.innerHTML = innerHtml;
        document.body.appendChild(modal);
        
        const close = () => { document.body.removeChild(modal); };

        if (isTip) {
            modal.querySelector('#ws-modal-cancel').onclick = () => {
                close();
                resolve({ error: 'User cancelled' });
            };
            modal.querySelector('#ws-modal-tip').onclick = async () => {
                const btn = modal.querySelector('#ws-modal-tip');
                const status = modal.querySelector('#ws-tip-status');
                btn.disabled = true;
                btn.style.opacity = '0.7';
                btn.textContent = 'Processing...';
                
                try {
                    if (!window.purchase) throw new Error("Purchase API not available");
                    
                    const tier = tipTier;
                    
                    // NEW FLOW: Post Comment/Pending Link FIRST
                    // This ensures the metadata is waiting on the server when the webhook hits
                    await originalFetch('/api/comments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            content: data.content || '',
                            parentId: data.parent_comment_id,
                            credits: tier // Send tier (actual cost) so it matches sku amount
                        })
                    });

                    // Then Trigger Purchase
                    const sku = \`tip_\${tier}_gold\`;
                    const result = await window.purchase(sku);
                    
                    if (result.status === window.OrderResultStatus.STATUS_SUCCESS) {
                        status.style.color = '#10b981';
                        status.textContent = 'Success! Thank you for your support.';
                        
                        // Trigger UI Refresh
                        try {
                            const user = await window.websim.getCurrentUser();
                            
                            // 1. Dispatch comment:created event (for Latest feed)
                            const evt = {
                                comment: {
                                    id: 'temp_tip_' + Date.now(),
                                    raw_content: data.content || '',
                                    author: user,
                                    created_at: new Date().toISOString(),
                                    parent_comment_id: data.parent_comment_id,
                                    card_data: {
                                        type: 'tip_comment',
                                        credits_spent: tier
                                    }
                                }
                            };
                            const listeners = window._websim_comment_listeners || [];
                            listeners.forEach(cb => cb(evt));

                            // 2. Fetch and dispatch updated user total (for Tiers)
                            try {
                                const totalResp = await originalFetch(\`/api/user-total/\${user.id}\`);
                                if (totalResp.ok) {
                                    const totalData = await totalResp.json();
                                    const newTotal = totalData.total || 0;
                                    
                                    window.dispatchEvent(new CustomEvent('tip:total-updated', { 
                                        detail: { 
                                            userId: user.id, 
                                            newTotal: newTotal, 
                                            tipAmount: tier 
                                        } 
                                    }));
                                }
                            } catch(e) { console.warn("Failed to fetch updated total:", e); }
                            
                            // 3. Force reload active tab if it's Tips/Supporters/Best
                            setTimeout(() => {
                                const activeTab = document.querySelector('.tab-btn.active, .tab.active');
                                if (activeTab) {
                                    const tabName = (activeTab.dataset.tab || activeTab.textContent || '').toLowerCase();
                                    if (tabName.includes('tip') || tabName.includes('support') || tabName.includes('best')) {
                                            activeTab.click(); 
                                    }
                                }
                            }, 500);

                        } catch(e) { console.warn("UI update dispatch failed:", e); }

                        setTimeout(() => {
                            close();
                            resolve({});
                        }, 1500);
                    } else {
                        throw new Error(result.errorMessage || 'Purchase failed or was cancelled');
                    }
                } catch(e) {
                    console.error("Tipping Failed:", e);
                    status.style.color = '#ef4444';
                    status.textContent = e.message;
                    btn.disabled = false;
                    btn.textContent = 'Retry Tip';
                }
            };
        } else {
            const input = modal.querySelector('#ws-comment-input');
            input.focus();
            
            modal.querySelector('#ws-modal-cancel').onclick = () => {
                close();
                resolve({ error: 'User cancelled' });
            };
            
            modal.querySelector('#ws-modal-post').onclick = async () => {
                const text = input.value;
                if (!text.trim()) return;
                
                const btn = modal.querySelector('#ws-modal-post');
                btn.textContent = 'Posting...';
                btn.disabled = true;
                
                try {
                    const res = await originalFetch('/api/comments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            content: text,
                            parentId: data.parent_comment_id
                        })
                    });
                    
                    if (!res.ok) {
                        const errData = await res.json().catch(() => ({}));
                        throw new Error(errData.error || 'Server Error ' + res.status);
                    }

                    const json = await res.json();
                    
                    // Emit local event
                    const user = await window.websim.getCurrentUser();
                    const evt = {
                        comment: {
                            id: json.id || 'temp_' + Date.now(),
                            raw_content: text,
                            author: user,
                            created_at: new Date().toISOString(),
                            parent_comment_id: data.parent_comment_id
                        }
                    };
                    
                    const listeners = window._websim_comment_listeners || [];
                    listeners.forEach(cb => cb(evt));
                    
                    close();
                    resolve({});
                } catch(e) {
                    console.error("Comment Post Failed:", e);
                    alert("Failed to post comment: " + e.message);
                    btn.textContent = 'Retry';
                    btn.disabled = false;
                }
            };
        }
    }
`;