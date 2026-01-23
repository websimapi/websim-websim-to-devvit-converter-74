export const hotswapStub = `
    // --- Global State Hotswap / Persistence ---
    // Aggressively sync userTotalTipped to any app/game object found in the window scope
    function syncAppState(user) {
        if (!user) return;
        const total = parseInt(user.total_tipped || user.totalTipped || 0);
        
        // Potential roots where games store state
        const candidates = [window.app, window.game, window.UI, window.Game, window.state, window.store];
        
        candidates.forEach(root => {
            if (root && typeof root === 'object') {
                // Direct property injection
                if (typeof root.userTotalTipped !== 'undefined') root.userTotalTipped = total;
                if (typeof root.totalTipped !== 'undefined') root.totalTipped = total;
                if (typeof root.credits !== 'undefined') root.credits = total;
                
                // Nested state injection
                if (root.state) {
                     if (typeof root.state.userTotalTipped !== 'undefined') root.state.userTotalTipped = total;
                     if (typeof root.state.totalTipped !== 'undefined') root.state.totalTipped = total;
                }
                
                // Trigger updates if methods exist
                try {
                    if (typeof root.renderTiers === 'function') root.renderTiers();
                    if (typeof root.updateUI === 'function') root.updateUI();
                    if (typeof root.refresh === 'function') root.refresh();
                } catch(e) {}
            }
        });
        
        // Update generic DOM elements for lightweight UIs
        document.querySelectorAll('[data-user-total], .user-total-credits').forEach(el => {
            el.textContent = total;
        });
    }

    if (typeof window !== 'undefined') {
        // 1. Sync on Game Data Ready (Initial Load)
        window.addEventListener('GAMEDATA_READY', (e) => {
            // e.detail usually contains dbData, but user is on window._currentUser
            if (window._currentUser) syncAppState(window._currentUser);
        });

        // 2. Sync on Realtime Updates (Post-Purchase)
        window.addEventListener('tip:total-updated', (e) => {
            const { newTotal } = e.detail;
            if (window._currentUser) window._currentUser.total_tipped = newTotal;
            syncAppState({ total_tipped: newTotal });
        });

        // 3. Periodic Check (Persistent Hotswap)
        // Ensures state is set even if the app loads slowly or overwrites variables
        const hotswapInterval = setInterval(() => {
            if (window._currentUser) {
                syncAppState(window._currentUser);
            }
        }, 2000);
        
        // Stop checking after 60s to save resources, assuming stable state
        setTimeout(() => clearInterval(hotswapInterval), 60000);

        // 4. Presence Recovery (Hotswap support)
        // If the socket exists but the user might have been dropped or state lost during HMR/Reload
        setTimeout(() => {
             if (window.websimSocketInstance && window.websimSocketInstance.isConnected) {
                 // Force a presence broadcast to ensure we appear in lists immediately
                 window.websimSocketInstance._sendPresence().catch(() => {});
             }
        }, 1000);
    }
`;