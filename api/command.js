import { createClient } from 'redis';

export default async function handler(req, res) {
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (!redisUrl) {
    return res.status(500).json({ error: "Base de données non configurée" });
  }

  const client = createClient({ 
    url: redisUrl,
    socket: {
      connectTimeout: 10000,
      reconnectStrategy: false
    }
  });
  
  client.on('error', (err) => console.error('Redis Command Error:', err));
  
  try {
    await client.connect();

    // POST: Envoyer une commande à une session
    if (req.method === 'POST') {
      const { sessionId, command, payload } = req.body;
      if (!sessionId || !command) {
        await client.quit();
        return res.status(400).json({ error: "Session ID et commande requis" });
      }

      console.log(`Envoi commande ${command} vers ${sessionId}`);

      // On stocke la commande dans une liste pour cette session
      await client.rPush(`pending_commands:${sessionId}`, JSON.stringify({
        command,
        payload: payload || {},
        timestamp: Date.now()
      }));

      // On limite la taille de la file d'attente pour éviter les débordements
      await client.lTrim(`pending_commands:${sessionId}`, -10, -1);

      await client.quit();
      return res.status(200).json({ success: true, message: `Commande ${command} envoyée.` });
    }

    // GET: Récupérer la prochaine commande pour une session (côté tracker)
    if (req.method === 'GET') {
      const { sessionId } = req.query;
      if (!sessionId) {
        await client.quit();
        return res.status(400).json({ error: "Session ID requis" });
      }

      // On récupère la commande la plus ancienne
      const commandData = await client.lPop(`pending_commands:${sessionId}`);
      
      if (commandData) {
        const parsed = JSON.parse(commandData);
        const now = Date.now();
        
        // Si la commande a plus de 5 minutes, on l'ignore (plus généreux que 2 min)
        if (now - parsed.timestamp > 300000) {
          console.log(`Commande expirée ignorée pour ${sessionId}`);
          await client.quit();
          return res.status(200).json({ command: null });
        }

        await client.quit();
        return res.status(200).json({ command: parsed });
      }

      await client.quit();
      return res.status(200).json({ command: null });
    }

    await client.quit();
    return res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    console.error("Erreur API Command fatale:", e);
    try { await client.quit(); } catch(err) {}
    return res.status(500).json({ error: "Erreur serveur Redis" });
  }
}
