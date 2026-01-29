const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require('neno-baileys');

// ============================================
// 🗄️ DATABASE & CONFIGURATION
// ============================================
const MONGO_URL = "mongodb+srv://sayuramini41_db_user:L0MTttjRAvw9viC0@cluster0.ojtdvhh.mongodb.net/"; 
const SESSION_BASE_PATH = './session';
const mongoClient = new MongoClient(MONGO_URL);
let db;

const config = {
    PREFIX: '.',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/rcrrvt.png',
    NEWSLETTER_JID: '120363402466616623@newsletter',
    OWNER_NUMBER: '94743826406',
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_LIKE_EMOJI: ['💖', '❤️', '✨', '🌸', '🌹']
};

const activeSockets = new Map();

// ============================================
// 🛠️ DATABASE UTILITIES
// ============================================
async function saveSessionToDB(number, sessionPath) {
    try {
        if (!db) return;
        const credsPath = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
            await db.collection('sessions').updateOne(
                { id: number },
                { $set: { creds, updatedAt: new Date() } },
                { upsert: true }
            );
        }
    } catch (e) { console.error("DB Save Error:", e); }
}

async function restoreSessionFromDB(number, sessionPath) {
    try {
        if (!db) return;
        const result = await db.collection('sessions').findOne({ id: number });
        if (result && result.creds) {
            fs.ensureDirSync(sessionPath);
            fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(result.creds));
        }
    } catch (e) { console.error("DB Restore Error:", e); }
}

// ============================================
// 🤖 BOT CORE ENGINE
// ============================================
async function StartSayuraBot(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await restoreSessionFromDB(sanitizedNumber, sessionPath);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const socket = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Safari')
    });

    // --- Connection Updates ---
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log(`✅ ${sanitizedNumber} Connected!`);
            activeSockets.set(sanitizedNumber, socket);
            await db.collection('active_numbers').updateOne({ id: sanitizedNumber }, { $set: { status: 'active' } }, { upsert: true });
            
            const userJid = jidNormalizedUser(socket.user.id);
            await socket.sendMessage(userJid, { 
                image: { url: config.RCD_IMAGE_PATH },
                caption: `*SAYURA MD MINI V1 CONNECTED!* 🚀\n\n*Number:* ${sanitizedNumber}\n*Status:* Active ✅`
            });
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== 401) { // 401 කියන්නේ logout වීමක්, ඒ ඇරෙන්න අනිත් වෙලාවට reconnect වෙනවා
                console.log(`🔄 Reconnecting ${sanitizedNumber}...`);
                StartSayuraBot(sanitizedNumber, { headersSent: true });
            }
        }
    });

    socket.ev.on('creds.update', async () => {
        await saveCreds();
        await saveSessionToDB(sanitizedNumber, sessionPath);
    });

    // --- Status & Command Handlers ---
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;

        // Auto Status View & Like
        if (sender === 'status@broadcast') {
            if (config.AUTO_VIEW_STATUS === 'true') await socket.readMessages([msg.key]);
            if (config.AUTO_LIKE_STATUS === 'true') {
                const emoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                await socket.sendMessage(sender, { react: { text: emoji, key: msg.key } }, { statusJidList: [msg.key.participant] });
            }
            return;
        }

        // Commands
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        if (!text.startsWith(config.PREFIX)) return;
        
        const command = text.slice(config.PREFIX.length).split(' ')[0].toLowerCase();

        switch (command) {
            case 'alive':
                await socket.sendMessage(sender, { text: "SAYURA MD MINI IS ALIVE 🟢" }, { quoted: msg });
                break;
            
            case 'menu':
                const menu = `*SAYURA MD MINI MENU*\n\n.alive\n.system\n.owner\n.repo\n.deleteme`;
                await socket.sendMessage(sender, { text: menu }, { quoted: msg });
                break;

            case 'system':
                await socket.sendMessage(sender, { text: `*System:* Functional\n*Platform:* Heroku\n*Database:* MongoDB ✅` });
                break;

            case 'deleteme':
                if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath);
                await db.collection('sessions').deleteOne({ id: sanitizedNumber });
                await db.collection('active_numbers').deleteOne({ id: sanitizedNumber });
                await socket.sendMessage(sender, { text: "❌ Session Deleted. Bot Stopping..." });
                socket.ws.close();
                break;
        }
    });

    // Pairing Code Request (For Web Login)
    if (!socket.authState.creds.registered) {
        await delay(2000);
        const code = await socket.requestPairingCode(sanitizedNumber);
        if (res && !res.headersSent) res.send({ code });
    }
}

// ============================================
// 🌐 API ROUTES
// ============================================
router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).send({ error: 'Number required' });
    await StartSayuraBot(number, res);
});

// Start Database
mongoClient.connect().then(() => {
    db = mongoClient.db("whatsapp_bot_db");
    console.log("✅ MongoDB Connected");
});

module.exports = router;
