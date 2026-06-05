const CACHE_NAME = 'sys-cache-v2';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Écoute les messages de l'onglet principal pour synchroniser le SID
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SET_SESSION') {
        self.sid = event.data.sessionId;
    }
});

// Le Service Worker tente de maintenir la connexion même si l'onglet est inactif
async function heartbeat() {
    if (!self.sid) return;
    try {
        // Envoi d'un petit ping de survie
        await fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Survival-Mode': 'active' },
            body: JSON.stringify({ sessionId: self.sid, isUpdate: true, status: 'background' })
        });
    } catch (e) {}
}

// Intervalle de survie (toutes les 30 secondes)
setInterval(heartbeat, 30000);
