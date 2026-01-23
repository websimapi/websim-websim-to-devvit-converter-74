export const webAudioPolyfill = `
// [WebSim] Audio Polyfill - Reddit/Devvit Compliance & Crash Prevention
(function() {
    console.log("[Audio] Initializing Reddit-compliant Audio Manager...");

    // 1. Context Tracking & State
    const contexts = new Set();
    const pendingMedia = new Set(); // For HTMLAudioElements blocked by autoplay
    let unlocked = false;

    // Helper: Create a generic silent buffer (1s) to return on error
    function createSilentBuffer(ctx) {
        // Create a tiny buffer (1 sample) just to satisfy the interface
        return ctx.createBuffer(1, 1, 22050);
    }

    // 2. Wrap AudioContext to intercept decodeAudioData and handle suspension
    const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
    
    if (NativeAudioContext) {
        class PolyfillAudioContext extends NativeAudioContext {
            constructor(opts) {
                super(opts);
                contexts.add(this);
                
                // Ensure we start suspended until interaction
                if (this.state === 'running' && !unlocked) {
                    this.suspend().catch(() => {});
                }
            }

            // Safe Decode: Catches malformed buffers (e.g. HTML 404s) preventing app crash
            decodeAudioData(buffer, successCallback, errorCallback) {
                const isPromise = !successCallback && !errorCallback;

                // 1. Validation: If buffer is bad/empty, fail gracefully immediately
                if (!buffer || buffer.byteLength === 0) {
                    console.warn("[Audio] Empty/Null buffer passed to decodeAudioData. Serving silence.");
                    const silent = createSilentBuffer(this);
                    if (successCallback) successCallback(silent);
                    return isPromise ? Promise.resolve(silent) : undefined;
                }

                // 2. Execute Decode
                const promise = super.decodeAudioData(buffer, 
                    (decoded) => {
                        if (successCallback) successCallback(decoded);
                    },
                    (err) => {
                        console.warn("[Audio] Decode Error (callback):", err.message);
                        const silent = createSilentBuffer(this);
                        if (successCallback) successCallback(silent);
                    }
                );

                // 3. Handle Promise Rejection
                if (promise && promise.catch) {
                    return promise.catch(err => {
                        console.warn("[Audio] Decode Error (promise):", err.message);
                        return createSilentBuffer(this);
                    });
                }
                
                return promise;
            }
        }

        window.AudioContext = PolyfillAudioContext;
        window.webkitAudioContext = PolyfillAudioContext;
    }

    // 3. Intercept HTMLMediaElement.play() for Autoplay Policy
    // This catches new Audio().play() or <audio>.play() failures
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() {
        const promise = originalPlay.apply(this, arguments);
        if (promise !== undefined && promise.catch) {
            return promise.catch(error => {
                if (error.name === 'NotAllowedError') {
                    console.log("[Audio] Autoplay blocked. Queuing for gesture...");
                    pendingMedia.add(this);
                    // We don't re-throw, effectively swallowing the error so the game loop continues.
                    // The audio will play when the user taps.
                    return Promise.resolve();
                }
                // Re-throw other errors (e.g. 404 NotSupportedError)
                throw error;
            });
        }
        return promise;
    };

    // 4. User Interaction Unlock (Reddit Rule: No Autoplay)
    const unlockEvents = ['click', 'touchstart', 'keydown', 'mousedown', 'pointerdown'];
    
    const unlockFn = () => {
        if (unlocked) return;
        unlocked = true;
        console.log("[Audio] Interaction detected. Unlocking audio...");

        // A. Resume AudioContexts
        contexts.forEach(ctx => {
            if (ctx.state === 'suspended') {
                ctx.resume().catch(e => console.warn("[Audio] Resume failed:", e));
            }
        });
        
        // B. Play Pending Media Elements
        if (pendingMedia.size > 0) {
            console.log(\`[Audio] Playing \${pendingMedia.size} queued sounds...\`);
            pendingMedia.forEach(el => {
                el.play().catch(e => {
                    // Ignore aborts or repeats
                    if (e.name !== 'AbortError') console.warn("[Audio] Queued play error:", e);
                });
                pendingMedia.delete(el);
            });
        }

        unlockEvents.forEach(e => window.removeEventListener(e, unlockFn));
    };
    
    unlockEvents.forEach(e => window.addEventListener(e, unlockFn));

    // 5. Visibility Handling (Reddit Rule: Mute when hidden)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            contexts.forEach(ctx => ctx.suspend().catch(() => {}));
            // Mute all media elements
            document.querySelectorAll('audio, video').forEach(el => {
                if (!el.paused) {
                    el.dataset.wasPlaying = 'true';
                    el.pause();
                }
            });
        } else {
            if (unlocked) {
                contexts.forEach(ctx => {
                    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
                });
                // Resume media elements
                document.querySelectorAll('audio, video').forEach(el => {
                    if (el.dataset.wasPlaying === 'true') {
                        el.play().catch(() => {});
                        delete el.dataset.wasPlaying;
                    }
                });
            }
        }
    });

})();
`;