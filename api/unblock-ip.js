import { createClient } from 'redis';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (!redisUrl) {
    return res.status(500).json({ error: "Base de données non configurée (REDIS_URL/KV_URL manquant)" });
  }

  const { publicIp } = req.query;

  if (!publicIp) {
    return res.status(400).json({ error: "IP manquante." });
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

    // Supprimer l'IP de la liste ip_kill
    await client.del(`ip_kill:${publicIp}`);

    await client.quit();
    return res.status(200).json({ success: true, message: `IP ${publicIp} débloquée avec succès.` });
  } catch (e) {
    console.error("Erreur déblocage Redis:", e);
    if (client.isOpen) await client.quit();
    return res.status(500).json({ error: "Erreur lors du déblocage." });
  }
}
