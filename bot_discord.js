const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const BOT_TOKEN = 'VOTRE_TOKEN_ICI'; // REMPLACEZ PAR VOTRE TOKEN MAIS NE PUSHEZ PAS SUR GITHUB
const CHANNEL_ID = '1511034707314217022'; // Ton ID de salon (#général)
const LOG_FILE = path.join(__dirname, 'visiteurs.txt');
// ---------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', () => {
    console.log(`✅ Bot connecté en tant que : ${client.user.tag}`);
    console.log(`📁 Les logs seront enregistrés dans : ${LOG_FILE}`);
    console.log('🚀 En attente de nouvelles visites...');
});

client.on('messageCreate', async (message) => {
    if (message.channelId !== CHANNEL_ID) return;

    if (message.embeds.length > 0) {
        const embed = message.embeds[0];
        let logEntry = `--- Nouvelle Visite (${new Date().toLocaleString()}) ---\n`;
        
        embed.fields.forEach(field => {
            logEntry += `${field.name}: ${field.value.replace(/`/g, '')}\n`;
        });
        
        logEntry += `-------------------------------------------\n\n`;

        // Écriture forcée et immédiate dans le fichier .txt
        try {
            fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
            console.log('📝 Visite enregistrée dans visiteurs.txt');
        } catch (err) {
            console.error('❌ Erreur écriture fichier:', err);
        }
    } 
    // Si c'est un message texte normal
    else if (!message.author.bot || message.webhookId) {
        const logLine = `[${new Date().toLocaleString()}] ${message.author.username}: ${message.content}\n`;
        try {
            fs.appendFileSync(LOG_FILE, logLine, 'utf8');
        } catch (err) {
            console.error('❌ Erreur écriture fichier:', err);
        }
    }
});

client.login(BOT_TOKEN).catch(err => {
    console.error('❌ Erreur de connexion : Vérifie ton Token !');
});
