const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const router = express.Router();
const pino = require('pino');
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
// 🗄️ SETTINGS
// ============================================
const MONGO_URL = "mongodb+srv://sayuramini41_db_user:L0MTttjRAvw9viC0@cluster0.ojtdvhh.mongodb.net/"; 
const mongoClient = new MongoClient(MONGO_URL);
let db;

const config = {
    RCD_IMAGE: 'https://files.catbox.moe/rcrrvt.png', // Login Image
};

// ============================================
// 🛠️ DATABASE UTILS
// ============================================
async function saveToDB(id, creds) {
    if (db) await db.collection('sessions').updateOne({ id }, { $set: { creds, date: new Date() } }, { upsert: true });
}

// ============================================
// 🤖 PAIRING FUNCTION
// ============================================
async function StartPair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = `./session/${sanitizedNumber}`;
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const socket = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Safari')
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log(`✅ Connected: ${sanitizedNumber}`);
            
            // 💾 Save to MongoDB
            await saveToDB(sanitizedNumber, state.creds);

            // 📤 Send Login Message to WhatsApp
            const userJid = jidNormalizedUser(socket.user.id);
            const sessionId = Buffer.from(JSON.stringify(state.creds)).toString('base64');
            
            const msg = `🧚‍♂️ *SAYURA MD MINI CONNECTED* 🧚‍♂️\n\n` +
                        `✅ *Status:* Online\n` +
                        `📱 *Number:* ${sanitizedNumber}\n` +
                        `🔑 *Session ID:* \`SAYURA-MD-MINI;;${sessionId}\`\n\n` +
                        `> *Keep your session ID safe!*`;

            await socket.sendMessage(userJid, { 
                image: { url: config.RCD_IMAGE }, 
                caption: msg 
            });

            await delay(5000);
            process.exit(0); // Optional: Restart to free memory
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== 401) StartPair(sanitizedNumber, null);
        }
    });

    // --- Pairing Code Generation ---
    if (!socket.authState.creds.registered) {
        await delay(2000);
        try {
            const code = await socket.requestPairingCode(sanitizedNumber);
            if (res && !res.headersSent) {
                return res.status(200).json({ code }); // Frontend එකට Code එක යවනවා
            }
        } catch (e) {
            if (res && !res.headersSent) res.status(500).json({ error: "Service Unavailable" });
        }
    }
}

// ============================================
// 🌐 ROUTES
// ============================================

// Frontend එකෙන් "Submit" එබුවම කෝල් වෙන්නේ මේ Route එක
router.get('/code', async (req, res) => {
    const num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    await StartPair(num, res);
});

// Backup route
router.get('/pair', async (req, res) => {
    const num = req.query.number;
    await StartPair(num, res);
});

// Database Connection
mongoClient.connect().then(() => {
    db = mongoClient.db("whatsapp_bot_db");
    console.log("✅ MongoDB Connected");
});

module.exports = router;
