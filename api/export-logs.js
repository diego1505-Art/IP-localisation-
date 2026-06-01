export default async function handler(req, res) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).send("Erreur : Vercel KV n'est pas configuré.");
  }

  try {
    const response = await fetch(`${process.env.KV_REST_API_URL}/lrange/visitor_logs/0/-1`, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
    });
    const data = await response.json();
    const logs = data.result || [];
    const txtContent = logs.join("");

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=ips_visiteurs.txt');
    return res.status(200).send(txtContent || "Aucun log pour le moment.");
  } catch (e) {
    return res.status(500).send("Erreur lors de la génération du fichier TXT.");
  }
}
