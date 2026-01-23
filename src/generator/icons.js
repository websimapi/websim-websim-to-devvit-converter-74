export async function generateGoldIcon() {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Background (Transparent)
        ctx.clearRect(0, 0, 256, 256);

        // Gold Circle
        const grad = ctx.createRadialGradient(128, 128, 20, 128, 128, 120);
        grad.addColorStop(0, '#FFD700'); // Gold
        grad.addColorStop(1, '#DAA520'); // GoldenRod
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(128, 128, 110, 0, Math.PI * 2);
        ctx.fill();
        
        // Border
        ctx.strokeStyle = '#B8860B'; // DarkGold
        ctx.lineWidth = 12;
        ctx.stroke();

        // Reflection
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.arc(90, 90, 45, 0, Math.PI * 2);
        ctx.fill();

        // "G" Symbol
        ctx.fillStyle = '#8B6508';
        ctx.font = 'bold 120px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('G', 128, 134);

        return new Promise(resolve => {
            canvas.toBlob(blob => {
                if (!blob) return resolve(null);
                blob.arrayBuffer().then(ab => resolve(new Uint8Array(ab)));
            }, 'image/png');
        });
    } catch(e) {
        console.error("[Generator] Canvas icon generation failed:", e);
        return null;
    }
}