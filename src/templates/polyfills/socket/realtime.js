export const socketRealtime = `
    // ------------------------------------------------------------------------
    // 1. WebsimSocket (Realtime Multiplayer)
    // ------------------------------------------------------------------------
    class WebsimSocket {
        constructor() {
            this.presence = {};
            this.roomState = {};
            this.peers = {};
            this.clientId = 'user-' + Math.random().toString(36).substr(2, 9);
            this.listeners = {
                presence: new Set(),
                roomState: new Set(),
                updateRequest: new Set(),
                message: null
            };
            this.socket = null;
            this.subscription = null;
            this.isConnected = false;
            this._initPromise = null; // Track initialization state
            this._initialized = false;
            
            // Throttling state
            this._lastUpdateSent = 0;
            this._updatePending = false;
            
            // Disconnect Handling
            this._lastSeen = {};
            this._pruneInterval = null;

            // Singleton logic
            if (window.websimSocketInstance) {
                return window.websimSocketInstance;
            }
            window.websimSocketInstance = this;
            
            // AUTO-INITIALIZE immediately on construction
            // This ensures by the time any code accesses the room, init is in progress
            this._initPromise = this.initialize();

            // Setup disconnect handlers
            window.addEventListener('beforeunload', () => this._sendLeave());
            
            // Prune stale peers every 5s
            this._pruneInterval = setInterval(() => this._pruneStalePeers(), 5000);

            // Heartbeat (Keep-Alive): Every 5s to ensure disconnection detection works
            this._heartbeatInterval = setInterval(() => this._sendHeartbeat(), 5000);
        }

        async _sendHeartbeat() {
            // Only heartbeat if we are connected and have formally joined (have local presence)
            if (this.isConnected && this.presence[this.clientId]) {
                // Send presence update to refresh 'lastSeen' on other clients
                this._sendPresence().catch(e => console.warn("[WebSim] Heartbeat failed", e));
            }
        }

        async initialize() {
            if (this._initialized) return; // Prevent double-init
            
            console.log("[WebSim] Initializing Realtime Socket...");
            try {
                console.log("[WebSim] Connecting to realtime channel 'global_room'...");
                const connectRealtime = window.connectRealtime;

                if (!connectRealtime) throw new Error("connectRealtime not available - verify polyfill header");

                // Use Doc-aligned pattern: await connectRealtime, no onError, no Promise wrapper
                this.subscription = await connectRealtime({
                    channel: 'global_room',
                    onMessage: (msg) => {
                        this._handleMessage(msg);
                    },
                    onConnect: () => {
                        console.log("[WebSim] Realtime Connected. ClientID:", this.clientId);
                        this.isConnected = true;
                    },
                    onDisconnect: () => {
                        console.log("[WebSim] Realtime Disconnected");
                        this.isConnected = false;
                    }
                });
                
                this.isConnected = true;
                
                // CRITICAL: Fetch existing presence from server BEFORE announcing
                // We assume successful connection logic allows us to proceed to API calls
                try {
                    await this._syncExistingPresence();
                    await this._announceJoin();
                } catch (err) {
                    console.warn("[WebSim] Initial presence sync failed:", err);
                }
                
                this._initialized = true;
                console.log("[WebSim] Socket initialization complete. Peers:", Object.keys(this.peers));

            } catch (e) {
                console.warn("[WebSim] Realtime init failed:", e);
                // Fallback: Local loopback for single player testing
                this.clientId = 'local-player';
                this.peers[this.clientId] = {
                    id: this.clientId,
                    username: 'Player',
                    avatarUrl: 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png'
                };
                // We still mark as initialized so games don't hang waiting for init
                this._initialized = true;
            }
        }

        // NEW METHOD: Sync existing presence from Redis
        async _syncExistingPresence() {
            try {
                console.log("[WebSim] Fetching existing presence from server...");
                const res = await fetch('/api/realtime/presence');
                if (!res.ok) throw new Error('Failed to fetch presence');
                
                const data = await res.json();
                const existingPresence = data.presence || [];
                
                console.log(\`[WebSim] Found \${existingPresence.length} existing users\`);
                
                // Process each existing presence
                existingPresence.forEach(item => {
                    const { clientId, user, payload } = item;
                    
                    // Skip ourselves
                    if (clientId === this.clientId) return;
                    
                    // Add to peers
                    if (user) {
                        const originalName = user.username;
                        let displayName = originalName;
                        
                        const others = Object.values(this.peers).filter(p => p.id !== clientId);
                        const names = new Set(others.map(p => p.username));
                        
                        if (names.has(displayName)) {
                            let i = 2;
                            while (names.has(\`\${displayName} (\${i})\`)) i++;
                            displayName = \`\${displayName} (\${i})\`;
                        }
                        
                        this.peers[clientId] = {
                            id: clientId,
                            username: displayName,
                            avatarUrl: sanitizeAvatar(user.avatar_url, originalName)
                        };
                    }
                    
                    // Add to presence
                    this.presence[clientId] = payload || {};
                    this._lastSeen[clientId] = Date.now();
                });
                
                // Notify UI of synced presence
                this._notifyPresence();
                
            } catch(e) {
                console.warn("[WebSim] Failed to sync existing presence:", e);
            }
        }

        // Helper: Ensure initialization before operations
        async _ensureReady() {
            if (!this._initialized && this._initPromise) {
                await this._initPromise;
            }
        }

        // --- Public API (all async now to ensure init) ---

        async _sendToServer(payload) {
            // NOTE: Removed _ensureReady() to avoid deadlocks during initialization (e.g. _announceJoin)
            // Callers must ensure the socket is in a valid state to send.
            try {
                const res = await fetch('/api/realtime/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) console.error("[WebSim] RT Send Failed:", res.status);
            } catch(e) {
                console.error("[WebSim] RT Send Error:", e);
            }
        }

        async updatePresence(data) {
            await this._ensureReady();
            
            // 1. Update Local
            this.presence[this.clientId] = { ...this.presence[this.clientId], ...data };
            this._notifyPresence();

            // 2. Broadcast via Server (Throttled)
            if (this.isConnected) {
                this._schedulePresenceUpdate();
            }
        }

        _schedulePresenceUpdate() {
            if (this._updatePending) return;
            
            const now = Date.now();
            const INTERVAL = 80;
            const timeSinceLast = now - this._lastUpdateSent;

            if (timeSinceLast >= INTERVAL) {
                this._sendPresence();
            } else {
                this._updatePending = true;
                setTimeout(() => {
                    this._updatePending = false;
                    this._sendPresence();
                }, INTERVAL - timeSinceLast);
            }
        }

        async _sendPresence() {
            this._lastUpdateSent = Date.now();
            await this._sendToServer({
                type: '_ws_presence',
                clientId: this.clientId,
                user: window._currentUser,
                payload: this.presence[this.clientId]
            });
        }

        async updateRoomState(data) {
            await this._ensureReady();
            
            // 1. Update Local
            this.roomState = { ...this.roomState, ...data };
            this._notifyRoomState();

            // 2. Broadcast via Server
            if (this.isConnected) {
                await this._sendToServer({
                    type: '_ws_roomstate',
                    payload: data
                });
            }
        }

        async requestPresenceUpdate(targetClientId, update) {
            await this._ensureReady();
            if (this.isConnected) {
                await this._sendToServer({
                    type: '_ws_req_update',
                    targetId: targetClientId,
                    fromId: this.clientId,
                    payload: update
                });
            }
        }

        async send(event) {
            await this._ensureReady();
            if (this.isConnected) {
                await this._sendToServer({
                    type: '_ws_event',
                    clientId: this.clientId,
                    username: window._currentUser?.username || 'Guest',
                    data: event
                });
            }
        }

        async _sendLeave() {
            // Best effort leave notification
            if (this.clientId) {
                const payload = JSON.stringify({
                    type: '_ws_leave',
                    clientId: this.clientId
                });
                if (navigator.sendBeacon) {
                    const blob = new Blob([payload], { type: 'application/json' });
                    navigator.sendBeacon('/api/realtime/message', blob);
                } else {
                    fetch('/api/realtime/message', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: payload,
                        keepalive: true
                    }).catch(() => {});
                }
            }
        }

        // --- Subscriptions (now await ready before calling callback) ---

        async subscribePresence(cb) {
            await this._ensureReady();
            this.listeners.presence.add(cb);
            // Immediate callback with current state
            try { cb(this.presence); } catch(e){}
            return () => this.listeners.presence.delete(cb);
        }

        async subscribeRoomState(cb) {
            await this._ensureReady();
            this.listeners.roomState.add(cb);
            try { cb(this.roomState); } catch(e){}
            return () => this.listeners.roomState.delete(cb);
        }

        async subscribePresenceUpdateRequests(cb) {
            await this._ensureReady();
            this.listeners.updateRequest.add(cb);
            return () => this.listeners.updateRequest.delete(cb);
        }
        
        set onmessage(cb) {
            this.listeners.message = cb;
        }

        // --- Internal Handlers ---

        _handleMessage(msg) {
            let data = msg;
            if (msg.message) data = msg.message;
            else if (msg.data && !msg.type) data = msg.data;

            const type = data.type;

            if (type === '_ws_presence') {
                const { clientId, payload: presenceData, user } = data;
                
                // Track liveness
                this._lastSeen[clientId] = Date.now();
                
                if (user) {
                    const originalName = user.username;
                    let displayName = originalName;
                    
                    const others = Object.values(this.peers).filter(p => p.id !== clientId);
                    const names = new Set(others.map(p => p.username));
                    
                    if (names.has(displayName)) {
                        let i = 2;
                        while (names.has(\`\${displayName} (\${i})\`)) i++;
                        displayName = \`\${displayName} (\${i})\`;
                    }
                    
                    this.peers[clientId] = {
                        id: clientId,
                        username: displayName,
                        avatarUrl: sanitizeAvatar(user.avatar_url, originalName)
                    };
                }

                this.presence[clientId] = { ...this.presence[clientId], ...presenceData };
                this._notifyPresence();
            }
            else if (type === '_ws_leave') {
                const { clientId } = data;
                if (clientId && clientId !== this.clientId) {
                    this._removePeer(clientId);
                }
            }
            else if (type === '_ws_roomstate') {
                this.roomState = { ...this.roomState, ...data.payload };
                this._notifyRoomState();
            }
            else if (type === '_ws_req_update') {
                if (data.targetId === this.clientId) {
                    this.listeners.updateRequest.forEach(cb => cb(data.payload, data.fromId));
                }
            }
            else if (type === '_ws_event') {
                if (this.listeners.message) {
                    const evt = {
                        data: {
                            ...data.data,
                            clientId: data.clientId,
                            username: data.username
                        }
                    };
                    this.listeners.message(evt);
                }
            }
        }

        _notifyPresence() {
            this.listeners.presence.forEach(cb => cb(this.presence));
        }

        _notifyRoomState() {
            this.listeners.roomState.forEach(cb => cb(this.roomState));
        }

        _removePeer(clientId) {
            if (!this.peers[clientId] && !this.presence[clientId]) return;
            
            const username = this.peers[clientId]?.username || 'Unknown';
            
            delete this.peers[clientId];
            delete this.presence[clientId];
            delete this._lastSeen[clientId];
            
            this._notifyPresence();
            
            console.log("[WebSim] Peer Disconnected:", clientId);

            // Synthesize Disconnected Event for Game Logic
            if (this.listeners.message) {
                try {
                    this.listeners.message({
                        data: {
                            type: 'disconnected',
                            clientId: clientId,
                            username: username
                        }
                    });
                } catch(e) { console.error("[WebSim] Error in disconnect handler:", e); }
            }
        }

        _pruneStalePeers() {
            const now = Date.now();
            const TIMEOUT = 15000; // 15s timeout
            
            Object.keys(this._lastSeen).forEach(clientId => {
                if (clientId === this.clientId) return; // Don't prune self
                
                if (now - this._lastSeen[clientId] > TIMEOUT) {
                    console.log("[WebSim] Pruning stale peer:", clientId);
                    this._removePeer(clientId);
                }
            });
        }

        async _announceJoin() {
            // Wait for identity
            let tries = 0;
            while (!window._currentUser && tries < 10) {
                await new Promise(r => setTimeout(r, 100));
                tries++;
            }
            
            const user = window._currentUser || { username: 'Guest', avatar_url: '' };
            
            let displayName = user.username;
            const others = Object.values(this.peers).filter(p => p.id !== this.clientId);
            const names = new Set(others.map(p => p.username));
            
            if (names.has(displayName)) {
                let i = 2;
                while (names.has(\`\${displayName} (\${i})\`)) i++;
                displayName = \`\${displayName} (\${i})\`;
            }

            // ADD TO PEERS IMMEDIATELY
            this.peers[this.clientId] = {
                id: this.clientId,
                username: displayName,
                avatarUrl: sanitizeAvatar(user.avatar_url, user.username)
            };

            // Then broadcast (Directly to avoid deadlock with _ensureReady)
            this.presence[this.clientId] = { ...this.presence[this.clientId], joined: true };
            this._notifyPresence();
            
            if (this.isConnected) {
                await this._sendPresence();
            }
        }
        
        // Collection stub for mixed usage
        collection(name) {
             return window.GenericDB.getAdapter(name);
        }
        
        static updateIdentity(user) {
            if (user) {
                if (user.avatar_url) {
                    user.avatar_url = sanitizeAvatar(user.avatar_url, user.username);
                }
                if (user.avatar_url && !user.avatarUrl) {
                    user.avatarUrl = user.avatar_url;
                }
            }
            window._currentUser = user;
            const inst = window.websimSocketInstance;
            if (inst && inst.peers[inst.clientId]) {
                inst.peers[inst.clientId].username = user.username;
                inst.peers[inst.clientId].avatarUrl = user.avatar_url;
                // Fire and forget - don't block on this update
                inst.updatePresence({}).catch(e => console.warn('[WebSim] Identity update broadcast failed:', e));
            }
        }
    }

    // Expose Global Class
    window.WebsimSocket = WebsimSocket;

    // Auto-create singleton instance and start initialization
    // This happens immediately when the polyfill loads
    if (!window.party) {
         console.log("[WebSim] Creating global party instance...");
         window.party = new WebsimSocket();
         // Initialize is already called in constructor
    }
`;