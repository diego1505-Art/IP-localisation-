import { createClient } from 'redis';

export default async function handler(req, res) {
  if (!process.env.REDIS_URL) {
    return res.status(500).json({ error: "REDIS_URL n'est pas configuré." });
  }

  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (err) => console.log('Redis Client Error', err));
  await client.connect();

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
