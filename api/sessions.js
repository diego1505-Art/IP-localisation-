export default async function handler(req, res) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ error: "Vercel KV n'est pas configuré." });
  }

  const { sessionId } = req.query;

  try {
    // Si un sessionId est fourni, on récupère son mouvement
    if (sessionId) {
      const response = await fetch(`${process.env.KV_REST_API_URL}/lrange/session_movement:${sessionId}/0/-1`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      const data = await response.json();
      const movement = (data.result || []).map(m => JSON.parse(decodeURIComponent(m)));
      return res.status(200).json({ sessionId, movement });
    } 
    
    // Sinon on récupère la liste des sessions actives
    else {
      const response = await fetch(`${process.env.KV_REST_API_URL}/smembers/active_sessions`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      const data = await response.json();
      return res.status(200).json({ sessions: data.result || [] });
    }
  } catch (e) {
    console.error("Erreur API Sessions:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
