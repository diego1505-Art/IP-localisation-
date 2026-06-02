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

    // 1. Supprimer l'historique de mouvement
    await client.del(`session_movement:${sessionId}`);

    // 2. Retirer de la liste des sessions actives
    await client.sRem('active_sessions', sessionId);

    // 3. Marquer comme supprimée pour éviter qu'elle ne revienne avec le tracker auto (expire après 24h)
    await client.set(`deleted_session:${sessionId}`, 'true', { EX: 86400 });

    await client.quit();
    return res.status(200).json({ success: true, message: "Session supprimée avec succès." });
  } catch (e) {
    console.error("Erreur suppression Redis:", e);
    if (client.isOpen) await client.quit();
    return res.status(500).json({ error: "Erreur lors de la suppression." });
  }
}
