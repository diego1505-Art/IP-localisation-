# SAADAA.LE.GOAT - Tracker IP & GPS Ultra-Précis

Ce projet est une galerie d'art déguisée servant de système de tracking en temps réel.adaptez le port pour corespondre avotre service de hacking

## 🚀 Fonctionnement
1. **Le Piège** : L'utilisateur arrive sur `index.html`. Un overlay invisible le force à cliquer.
2. **La Capture** : Au clic, le script récupère l'IP publique, l'IP locale (via WebRTC) et demande la position GPS.
3. **Le Suivi** : Une fois capturé, le script envoie la position toutes les 10 secondes.
4. **Le Dashboard** : L'interface `/admin.html` permet de voir les victimes sur une carte en direct.

## 🛠 Installation & Déploiement
Ce projet utilise **Vercel Serverless Functions** et **Vercel KV (Redis)**.

1. **Déploiement** : Pousse le code sur GitHub et lie-le à un projet Vercel.
2. **Base de données** : Dans Vercel, crée un storage **KV** et lie-le au projet.
3. **Variables d'environnement** :
   - `DISCORD_WEBHOOK_URL` : Pour recevoir les alertes sur Discord.
   - `KV_REST_API_URL` & `KV_REST_API_TOKEN` : (Auto-configurées par Vercel KV).

## ⚠️ Note Importante sur le Test Local
L'interface d'administration (`admin.html`) **ne fonctionnera pas** si tu l'ouvres avec Live Server (127.0.0.1:5500). Les API (`/api/sessions`) sont des fonctions serveurs qui ne tournent que sur Vercel.
<img width="1912" height="876" alt="image" src="https://github.com/user-attachments/assets/2431b98f-11d5-4217-a8ba-ee2178aec0d2" />

Pour tester localement, utilise la CLI Vercel :
```bash
npm i -g vercel
vercel dev
```
