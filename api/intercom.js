import { createClient } from 'redis';

const AUDIO_TTL_SEC = 120;

export default async function handler(req, res) {
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (!redisUrl) {
    return res.status(500).json({ error: 'Base de données non configurée' });
  }

  const client = createClient({
    url: redisUrl,
    socket: { connectTimeout: 10000, reconnectStrategy: false }
  });

  client.on('error', (err) => console.error('Redis Intercom Error:', err));

  try {
    await client.connect();
    const { sessionId, from } = req.method === 'GET' ? req.query : req.body;

    if (!sessionId || !from || !['admin', 'target'].includes(from)) {
      await client.quit();
      return res.status(400).json({ error: 'sessionId et from (admin|target) requis' });
    }

    const key = `intercom:${sessionId}:${from}`;

    if (req.method === 'POST') {
      const { audio, timestamp } = req.body;
      if (!audio) {
        await client.quit();
        return res.status(400).json({ error: 'audio requis' });
      }
      await client.set(key, JSON.stringify({ audio, timestamp: timestamp || Date.now() }), { EX: AUDIO_TTL_SEC });
      await client.set(`session_last_seen:${sessionId}`, String(Date.now()), { EX: 86400 * 30 });
      await client.quit();
      return res.status(200).json({ success: true });
    }

    if (req.method === 'GET') {
      const raw = await client.get(key);
      await client.quit();
      if (!raw) return res.status(200).json({ audio: null });
      return res.status(200).json(JSON.parse(raw));
    }

    await client.quit();
    return res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    console.error('Erreur API intercom:', e);
    try { await client.quit(); } catch (err) {}
    return res.status(500).json({ error: 'Erreur serveur Redis' });
  }
}
