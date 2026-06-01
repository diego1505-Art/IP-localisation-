// Fonction pour récupérer l'IP locale via WebRTC
async function getLocalIP() {
    return new Promise((resolve) => {
        const ips = [];
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        
        pc.createDataChannel("");
        pc.createOffer().then(offer => pc.setLocalDescription(offer));
        
        pc.onicecandidate = (event) => {
            if (!event || !event.candidate) {
                if (ips.length > 0) resolve(ips[0]);
                else resolve("Inconnue (Bloqué/VPN)");
                return;
            }
            
            const parts = event.candidate.candidate.split(' ');
            const ip = parts[4];
            if (!ips.includes(ip) && ip.includes('.')) {
                ips.push(ip);
            }
        };

        // Timeout plus long pour laisser le temps au STUN de répondre
        setTimeout(() => {
            if (ips.length > 0) resolve(ips[0]);
            else resolve("Inconnue (Timeout)");
            pc.close();
        }, 2000);
    });
}

async function logVisitor() {
    try {
        const localIp = await getLocalIP();
        const response = await fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                localIp: localIp,
                userAgent: navigator.userAgent,
                language: navigator.language,
                screenResolution: `${window.screen.width}x${window.screen.height}`,
                referrer: document.referrer || 'Direct',
                page: window.location.pathname
            })
        });
    } catch (error) {
        console.error("Erreur lors du logging:", error);
    }
}

if (document.readyState === 'complete') {
    logVisitor();
} else {
    window.addEventListener('load', logVisitor);
}
