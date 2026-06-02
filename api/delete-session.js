import { createClient } from 'redis';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  if (!process.env.REDIS_URL) {
    return res.status(500).json({ error: "REDIS_URL n'est pas configuré." });
  }

  const { sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({ error: "ID de session manquant." });
  }

  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (err) => console.log('Redis Client Error', err));
  
  try {
    await client.connect();

    // 1. Supprimer l'historique de mouvement
    await client.del(`session_movement:${sessionId}`);

    // 2. Retirer de la liste des sessions actives
    await client.sRem('active_sessions', sessionId);

    await client.quit();
    return res.status(200).json({ success: true, message: "Session supprimée avec succès." });
  } catch (e) {
    console.error("Erreur suppression Redis:", e);
    if (client.isOpen) await client.quit();
    return res.status(500).json({ error: "Erreur lors de la suppression." });
  }
}
