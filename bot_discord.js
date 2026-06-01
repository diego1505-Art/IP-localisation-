require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN; 
const CHANNEL_ID = process.env.CHANNEL_ID; // Ton ID de salon (#général) vérifié
const LOG_FILE = path.join(process.cwd(), 'visiteurs.txt');
// ---------------------

if (!BOT_TOKEN) {
    console.error("❌ ERREUR : DISCORD_BOT_TOKEN manquant dans le fichier .env");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildWebhooks, // AJOUTÉ : Pour voir les messages du Webhook
    ],
});

client.once('ready', () => {
    console.log('------------------------------------------');
    console.log(`✅ BOT ACTIF : ${client.user.tag}`);
    console.log(`📁 SERVEURS REJOINTS : ${client.guilds.cache.size}`);
    client.guilds.cache.forEach(g => console.log(`   > ${g.name}`));
    console.log(`📁 CHEMIN DU FICHIER : ${LOG_FILE}`);
    console.log("🚀 EN ATTENTE DE TOUS LES MESSAGES...");
    console.log('------------------------------------------');
    
    // Test d'écriture immédiat
    fs.appendFileSync(LOG_FILE, `--- Bot relance le ${new Date().toLocaleString()} ---\n`, 'utf8');
});

client.on('messageCreate', async (message) => {
    // LOG DANS LA CONSOLE POUR DEBUG
    console.log(`📩 [CONSOLE] Message recu de : ${message.author.username}`);
    console.log(`🆔 ID du Salon : ${message.channelId}`);

    // ON ECRIT TOUT DANS LE FICHIER TXT, SANS AUCUNE CONDITION
    let logLine = `[${new Date().toLocaleString()}] De: ${message.author.username} | Salon: ${message.channelId}\n`;
    
    if (message.embeds.length > 0) {
        logLine += `📦 Type: Visite de site (Embed)\n`;
        message.embeds[0].fields.forEach(f => {
            logLine += `   > ${f.name}: ${f.value}\n`;
        });
    } else {
        logLine += `💬 Type: Texte | Contenu: ${message.content}\n`;
    }
    logLine += `-------------------------------------------\n`;

    try {
        fs.appendFileSync(LOG_FILE, logLine, 'utf8');
        console.log('✅ NOTÉ DANS LE FICHIER TXT !');
    } catch (err) {
        console.error('❌ ERREUR ECRITURE :', err.message);
    }
});

client.login(BOT_TOKEN).catch(err => {
    console.error('❌ ERREUR CONNEXION :', err.message);
});
