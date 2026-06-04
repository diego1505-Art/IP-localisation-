const CACHE_NAME = 'saada-survival-v1';
const SESSION_ID_KEY = 'tracker_session_id';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Le Service Worker tourne en arrière-plan même si l'onglet est fermé
// On vérifie les commandes toutes les 5 secondes
async function backgroundCheck() {
    try {
        const allClients = await self.clients.matchAll();
        // Si aucun onglet n'est ouvert, on tente d'exécuter des actions de survie
        // Note: Le SW a des capacités limitées sans onglet, mais il peut envoyer des notifications 
        // ou tenter de rouvrir la page sur certains navigateurs.
        
        // On récupère le sessionId via indexedDB ou message (simulé ici)
        // Pour une vraie persistance, on utiliserait le stockage synchronisé
    } catch (e) {}
}

setInterval(backgroundCheck, 5000);

// Écoute les messages de l'onglet principal
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SET_SESSION') {
        self.sessionId = event.data.sessionId;
    }
});
