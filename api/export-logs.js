import { createClient } from 'redis';

export default async function handler(req, res) {
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  
  if (!redisUrl) {
    return res.status(500).json({ error: "Base de données non configurée" });
  }

  const client = createClient({ url: redisUrl });
  client.on('error', (err) => console.error('Redis Error', err));

  try {
    await client.connect();
    const logs = await client.lRange('visitor_logs', 0, 50); // On prend les 50 derniers
    await client.quit();

    const txtContent = logs.join("");

    // Si on demande du JSON (pour le dashboard)
    if (req.query.json === 'true' || req.headers['accept']?.includes('application/json')) {
      return res.status(200).json({ logs: txtContent });
    }

    // Sinon on renvoie le fichier TXT classique
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=ips_visiteurs.txt');
    return res.status(200).send(txtContent || "Aucun log pour le moment.");
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erreur lors de la récupération des logs" });
  }
}
