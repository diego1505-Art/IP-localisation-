import { createClient } from 'redis';

export default async function handler(req, res) {
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  
  if (!redisUrl) {
    return res.status(500).json({ error: "Base de données non configurée (REDIS_URL/KV_URL manquant)" });
  }

  const client = createClient({ 
    url: redisUrl,
    socket: {
      connectTimeout: 10000,
      reconnectStrategy: false
    }
  });

  client.on('error', (err) => {
    console.error('Erreur Client Redis:', err);
  });

  try {
    await client.connect();
  } catch (err) {
    console.error("Échec de connexion Redis:", err);
    return res.status(500).json({ error: "Impossible de se connecter à la base de données" });
  }

  const { sessionId } = req.query;

  try {
    // Si un sessionId est fourni, on récupère son mouvement
    if (sessionId) {
      const data = await client.lRange(`session_movement:${sessionId}`, 0, -1);
      const movement = data.map(m => JSON.parse(m));
      await client.quit();
      return res.status(200).json({ sessionId, movement });
    } 
    
    // Sinon on récupère la liste des sessions actives
    else {
      const sessions = await client.sMembers('active_sessions');
      await client.quit();
      return res.status(200).json({ sessions: sessions || [] });
    }
  } catch (e) {
    console.error("Erreur API Sessions:", e);
    await client.quit();
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
