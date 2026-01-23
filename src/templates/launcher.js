export const generateLauncherHtml = (title, thumbnail) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: white; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; overflow: hidden; }
        .bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: url('${thumbnail || ''}'); background-size: cover; background-position: center; opacity: 0.3; z-index: -1; filter: blur(8px); }
        .card { background: rgba(30, 41, 59, 0.8); backdrop-filter: blur(10px); padding: 30px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; align-items: center; max-width: 80%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
        h1 { margin: 0 0 10px 0; font-size: 1.8rem; text-shadow: 0 2px 4px rgba(0,0,0,0.5); font-weight: 800; }
        p { color: #cbd5e1; margin: 0 0 24px 0; font-size: 1rem; }
        .play-btn { 
            background: #FF4500; color: white; border: none; 
            padding: 14px 40px; font-size: 1.2rem; border-radius: 99px; 
            cursor: pointer; font-weight: 700; 
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(0, 0, 0, 0.1);
            transition: transform 0.1s, background 0.2s;
            display: flex; align-items: center; gap: 10px;
        }
        .play-btn:hover { background: #ff571a; transform: scale(1.05); }
        .play-btn:active { transform: scale(0.95); }
    </style>
</head>
<body>
    <div class="bg"></div>
    <div class="card">
        <h1>${title}</h1>
        <p>Tap below to enter fullscreen</p>
        <button id="btn-play" class="play-btn">
            <span>▶</span> Play Now
        </button>
    </div>
    <script type="module">
        import { requestExpandedMode } from '@devvit/web/client';
        
        const btn = document.getElementById('btn-play');
        btn.addEventListener('click', async (e) => {
            try {
                // Request 'game' entrypoint
                await requestExpandedMode(e, 'game');
            } catch (err) {
                console.error('Failed to expand:', err);
            }
        });
    </script>
</body>
</html>`;