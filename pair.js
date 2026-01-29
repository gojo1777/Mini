const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
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
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_LIKE_EMOJI: ['❤️', '💖', '✨', '🔥', '🌸']
};

const activeSockets = new Map();

// ============================================
// 🛠️ DATABASE UTILITIES
// ============================================
async function saveToDB(number, sessionPath) {
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
    } catch (e) { console.error("DB Save Error:", e.message); }
}

async function restoreFromDB(number, sessionPath) {
    try {
        if (!db) return;
        const result = await db.collection('sessions').findOne({ id: number });
        if (result && result.creds) {
            fs.ensureDirSync(sessionPath);
            fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(result.creds));
            return true;
        }
    } catch (e) { console.error("DB Restore Error:", e.message); }
    return false;
}

// ============================================
// 🤖 BOT ENGINE (EMPIRE PAIR)
// ============================================
async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    // DB එකෙන් Session එක Restore කරගැනීම
    await restoreFromDB(sanitizedNumber, sessionPath);

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

    activeSockets.set(sanitizedNumber, socket);

    socket.ev.on('creds.update', async () => {
        await saveCreds();
        await saveToDB(sanitizedNumber, sessionPath);
    });

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log(`✅ Connected: ${sanitizedNumber}`);
            await db.collection('active_numbers').updateOne({ id: sanitizedNumber }, { $set: { status: 'active' } }, { upsert: true });
            
            const userJid = jidNormalizedUser(socket.user.id);
            await socket.sendMessage(userJid, { 
                image: { url: config.RCD_IMAGE_PATH },
                caption: `*SAYURA MD MINI CONNECTED!* 🚀\n\n*Number:* ${sanitizedNumber}\n*Status:* Active`
            });
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== 401) {
                console.log(`🔄 Reconnecting: ${sanitizedNumber}`);
                EmpirePair(sanitizedNumber, { headersSent: true });
            }
        }
    });

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') {
            // Auto Status View/Like
            if (msg.key.remoteJid === 'status@broadcast') {
                if (config.AUTO_VIEW_STATUS === 'true') await socket.readMessages([msg.key]);
                if (config.AUTO_LIKE_STATUS === 'true') {
                    const emoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                    await socket.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }, { statusJidList: [msg.key.participant] });
                }
            }
            return;
        }

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

        if (text.startsWith(config.PREFIX)) {
            const command = text.slice(config.PREFIX.length).toLowerCase();
            if (command === 'alive') await socket.sendMessage(sender, { text: "SAYURA MINI IS ONLINE 🟢" });
            if (command === 'deleteme') {
                if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath);
                await db.collection('sessions').deleteOne({ id: sanitizedNumber });
                await db.collection('active_numbers').deleteOne({ id: sanitizedNumber });
                await socket.sendMessage(sender, { text: "✅ Session Deleted Successfully." });
                socket.ws.close();
            }
        }
    });

    // Pairing Code Generator
    if (!socket.authState.creds.registered) {
        await delay(3000);
        try {
            const code = await socket.requestPairingCode(sanitizedNumber);
            if (res && !res.headersSent) {
                res.status(200).json({ code: code });
            }
        } catch (err) {
            if (res && !res.headersSent) res.status(500).json({ error: "Pairing failed" });
        }
    }
}

// ============================================
// 🌐 ROUTES
// ============================================

// /code?number=... (ඔයා කලින් try කරපු route එක)
router.get('/code', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.status(400).json({ error: "Number is required" });
    await EmpirePair(number, res);
});

// /pair?number=... (අමතර ආරක්ෂාවට)
router.get('/pair', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.status(400).json({ error: "Number is required" });
    await EmpirePair(number, res);
});

router.get('/', (req, res) => {
    res.status(200).send("SAYURA MD MINI SERVER IS ACTIVE ✅");
});

// ============================================
// 🚀 SYSTEM STARTUP
// ============================================
mongoClient.connect().then(() => {
    db = mongoClient.db("whatsapp_bot_db");
    console.log("✅ MongoDB Connected");

    // කලින් Active තිබුණු සියලුම නම්බර්ස් Auto Reconnect කිරීම
    db.collection('active_numbers').find({ status: 'active' }).toArray().then(docs => {
        docs.forEach(doc => {
            console.log(`🔁 Auto Restoring: ${doc.id}`);
            EmpirePair(doc.id, { headersSent: true });
        });
    });
});

module.exports = router;
