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
// 🗄️ CONFIGURATION
// ============================================
const MONGO_URL = "mongodb+srv://sayuramini41_db_user:L0MTttjRAvw9viC0@cluster0.ojtdvhh.mongodb.net/"; 
const mongoClient = new MongoClient(MONGO_URL);
let db;

// ============================================
// 🤖 BOT ENGINE
// ============================================
async function StartPair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(__dirname, `../session_${sanitizedNumber}`);
    
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
            console.log(`✅ ${sanitizedNumber} Connected!`);
            
            // Generate Session ID (Base64)
            const sessionId = Buffer.from(JSON.stringify(state.creds)).toString('base64');
            const userJid = jidNormalizedUser(socket.user.id);

            // WhatsApp එකට Login Message එක යැවීම
            await socket.sendMessage(userJid, { 
                text: `🧚‍♂️ *SAYURA MD MINI CONNECTED* 🧚‍♂️\n\n✅ *Status:* Online\n🔑 *Session ID:* \`SAYURA-MD-MINI;;${sessionId}\`\n\n> *Created by Sayura Mihiranga*` 
            });

            // MongoDB එකට සේව් කිරීම
            if (db) {
                await db.collection('sessions').updateOne(
                    { id: sanitizedNumber }, 
                    { $set: { creds: state.creds, updatedAt: new Date() } }, 
                    { upsert: true }
                );
            }

            // සර්වර් එකේ ඉඩ ඉතිරි කර ගැනීමට තාවකාලික ෆයිල් මැකීම
            await delay(5000);
            if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath);
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== 401) {
                console.log("🔄 Reconnecting...");
            }
        }
    });

    // --- Pairing Code එක ලබා ගැනීම ---
    if (!socket.authState.creds.registered) {
        await delay(2000);
        try {
            const code = await socket.requestPairingCode(sanitizedNumber);
            if (res && !res.headersSent) {
                // HTML එක බලාපොරොත්තු වන JSON Response එක
                return res.status(200).json({ code: code });
            }
        } catch (e) {
            console.error("Pairing Error:", e);
            if (res && !res.headersSent) res.status(500).json({ error: "Service Unavailable" });
        }
    }
}

// ============================================
// 🌐 ROUTES (ඔයාගේ HTML එකට ගැලපෙන ලෙස)
// ============================================

// ඔයාගේ HTML එකෙන් '/code?number=...' ලෙස Request එක එන නිසා මෙය අනිවාර්යයි
router.get('/code', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.status(400).json({ error: "Number is required" });
    await StartPair(number, res);
});

// Root Path
router.get('/', (req, res) => {
    res.send("SAYURA MINI MD SERVER IS RUNNING ✅");
});

// ============================================
// 🚀 DATABASE STARTUP
// ============================================
mongoClient.connect().then(() => {
    db = mongoClient.db("whatsapp_bot_db");
    console.log("✅ MongoDB Connected Successfully");
}).catch(err => console.error("MongoDB Connection Failed:", err));

module.exports = router;
