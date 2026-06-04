import { createClient } from 'redis';

const FRAME_TTL_SEC = 30;

export default async function handler(req, res) {
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (!redisUrl) {
    return res.status(500).json({ error: 'Base de données non configurée' });
  }

  const client = createClient({
    url: redisUrl,
    socket: { connectTimeout: 10000, reconnectStrategy: false }
  });

  client.on('error', (err) => console.error('Redis Camera Error:', err));

  try {
    await client.connect();
    const { sessionId } = req.method === 'GET' ? req.query : req.body;

    if (!sessionId) {
      await client.quit();
      return res.status(400).json({ error: 'Session ID requis' });
    }

    const key = `camera_frame:${sessionId}`;

    if (req.method === 'POST') {
      const { frame, timestamp } = req.body;
      if (!frame) {
        await client.quit();
        return res.status(400).json({ error: 'Frame requis' });
      }

      await client.set(
        key,
        JSON.stringify({ frame, timestamp: timestamp || Date.now() }),
        { EX: FRAME_TTL_SEC }
      );
      await client.quit();
      return res.status(200).json({ success: true });
    }

    if (req.method === 'GET') {
      const raw = await client.get(key);
      await client.quit();
      if (!raw) {
        return res.status(200).json({ frame: null });
      }
      return res.status(200).json(JSON.parse(raw));
    }

    await client.quit();
    return res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    console.error('Erreur API camera-frame:', e);
    try { await client.quit(); } catch (err) {}
    return res.status(500).json({ error: 'Erreur serveur Redis' });
  }
}
