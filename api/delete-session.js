import { createClient } from 'redis';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (!redisUrl) {
    return res.status(500).json({ error: "Base de données non configurée (REDIS_URL/KV_URL manquant)" });
  }

  const { sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({ error: "ID de session manquant." });
  }

  const client = createClient({ 
    url: redisUrl,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: false
    }
  });
  client.on('error', (err) => console.log('Redis Client Error', err));
  
  try {
    await client.connect();

    // 1. Récupérer l'IP publique depuis l'historique de mouvement
    const movement = await client.lRange(`session_movement:${sessionId}`, -1, -1);
    let publicIp = null;
    if (movement.length > 0) {
      try {
        const lastMovement = JSON.parse(movement[0]);
        publicIp = lastMovement.publicIp;
      } catch (e) {
        console.error("Erreur parsing mouvement:", e);
      }
    }

    // 2. Supprimer l'historique de mouvement
    await client.del(`session_movement:${sessionId}`);

    // 3. Retirer de la liste des sessions actives
    await client.sRem('active_sessions', sessionId);

    // 4. AJOUTER L'IP À LA LISTE IP_KILL (désactive les pings auto PERMANEMMENT)
    // L'IP reste bloquée jusqu'à une vraie visite (isUpdate=false)
    if (publicIp) {
      await client.sAdd('ip_kill', publicIp);
      console.log(`💀 IP tuée PERMANENT (pings auto bloqués): ${publicIp}`);
    }

    await client.quit();
    return res.status(200).json({ success: true, message: "Session supprimée. IP tuée (pings auto bloqués)." });
  } catch (e) {
    console.error("Erreur suppression Redis:", e);
    if (client.isOpen) await client.quit();
    return res.status(500).json({ error: "Erreur lors de la suppression." });
  }
}
