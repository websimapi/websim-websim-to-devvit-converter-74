export const socketDatabase = `
    // ------------------------------------------------------------------------
    // 2. Generic DB (Persistent Storage)
    // ------------------------------------------------------------------------
    window._genericDB = {};
    window._listCache = {};
    window._subscribers = {};

    const DevvitBridge = {
        init: async () => {
            console.log("[Bridge] Initializing DB...");
            try {
                const data = await fetch('/api/init').then(r => r.json());
                if (data.dbData) {
                    window._genericDB = data.dbData;
                    window._currentUser = data.user;
                    
                    if (window.WebsimSocket) {
                        window.WebsimSocket.updateIdentity(data.user);
                    }
                    
                    // Dispatch Ready
                    window.dispatchEvent(new CustomEvent('GAMEDATA_READY', { detail: data.dbData }));
                }
            } catch (e) { console.warn("[Bridge] Init failed", e); }
        },
        notifySubscribers: (collection) => {
            delete window._listCache[collection];
            const list = Object.values(window._genericDB[collection] || {}).sort((a,b) => (b.created_at || 0) < (a.created_at || 0) ? -1 : 1);
            if (window._subscribers[collection]) {
                window._subscribers[collection].forEach(cb => cb(list));
            }
        }
    };

    window.GenericDB = {
        save: async (col, key, val) => {
            if (!window._genericDB[col]) window._genericDB[col] = {};
            window._genericDB[col][key] = val;
            DevvitBridge.notifySubscribers(col);
            fetch('/api/save', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({collection:col, key, value:val})
            }).catch(console.error);
        },
        get: (col, key) => window._genericDB[col]?.[key],
        getList: (col) => Object.values(window._genericDB[col] || {}),
        delete: async (col, key) => {
            if (window._genericDB[col]) delete window._genericDB[col][key];
            DevvitBridge.notifySubscribers(col);
            fetch('/api/delete', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({collection:col, key})
            }).catch(console.error);
        },
        subscribe: (col, cb) => {
            if (!window._subscribers[col]) window._subscribers[col] = [];
            window._subscribers[col].push(cb);
            cb(window.GenericDB.getList(col));
            return () => window._subscribers[col] = window._subscribers[col].filter(f => f !== cb);
        },
        getAdapter: (name) => ({
             getList: () => window.GenericDB.getList(name),
             create: (d) => {
                 const id = Math.random().toString(36).substr(2,10);
                 const r = { id, ...d, created_at: new Date().toISOString() };
                 if(window._currentUser) { r.username = window._currentUser.username; r.avatar_url = window._currentUser.avatar_url; }
                 window.GenericDB.save(name, id, r);
                 return Promise.resolve(r);
             },
             update: (id, d) => {
                 const curr = window.GenericDB.get(name, id) || {};
                 const r = { ...curr, ...d };
                 window.GenericDB.save(name, id, r);
                 return Promise.resolve(r);
             },
             delete: (id) => window.GenericDB.delete(name, id),
             subscribe: (cb) => window.GenericDB.subscribe(name, cb),
             filter: (criteria) => {
                 const matches = (item) => {
                     for (const key in criteria) {
                         if (item[key] !== criteria[key]) return false;
                     }
                     return true;
                 };
                 return {
                     getList: () => window.GenericDB.getList(name).filter(matches),
                     subscribe: (cb) => {
                         const filterAndCall = (list) => cb(list.filter(matches));
                         // GenericDB.subscribe calls callback immediately with current data
                         return window.GenericDB.subscribe(name, filterAndCall);
                     }
                 };
             }
        })
    };

    if (document.readyState === 'complete') setTimeout(DevvitBridge.init, 100);
    else window.addEventListener('load', () => setTimeout(DevvitBridge.init, 100));
`;