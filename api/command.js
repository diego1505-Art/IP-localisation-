import { createClient } from 'redis';

export default async function handler(req, res) {
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (!redisUrl) {
    return res.status(500).json({ error: "Base de données non configurée" });
  }

  const client = createClient({ url: redisUrl });
  client.on('error', (err) => console.error('Redis Client Error', err));
  
  try {
    await client.connect();

    // POST: Envoyer une commande à une session
    if (req.method === 'POST') {
      const { sessionId, command, payload } = req.body;
      if (!sessionId || !command) {
        return res.status(400).json({ error: "Session ID et commande requis" });
      }

      // On stocke la commande dans une liste pour cette session
      await client.rPush(`pending_commands:${sessionId}`, JSON.stringify({
        command,
        payload: payload || {},
        timestamp: Date.now()
      }));

      await client.quit();
      return res.status(200).json({ success: true, message: `Commande ${command} envoyée.` });
    }

    // GET: Récupérer la prochaine commande pour une session (côté tracker)
    if (req.method === 'GET') {
      const { sessionId } = req.query;
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID requis" });
      }

      // On récupère la commande la plus ancienne
      const commandData = await client.lPop(`pending_commands:${sessionId}`);
      
      if (commandData) {
        const parsed = JSON.parse(commandData);
        const now = Date.now();
        // SI LA COMMANDE A PLUS DE 2 MINUTES, ON L'IGNORE
        if (now - parsed.timestamp > 120000) {
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

    return res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    console.error("Erreur API Command:", e);
    if (client.isOpen) await client.quit();
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
