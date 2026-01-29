const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const { MongoClient, ServerApiVersion } = require('mongodb');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    DisconnectReason
} = require('neno-baileys');

// ============================================
// 🗄️ DATABASE CONFIG
// ============================================
const MONGO_URL = "mongodb+srv://sayuramini41_db_user:L0MTttjRAvw9viC0@cluster0.ojtdvhh.mongodb.net/?retryWrites=true&w=majority"; 
const mongoClient = new MongoClient(MONGO_URL, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
    tls: true
});

const SESSION_BASE_PATH = './session';
let db;

const config = {
    PREFIX: '.',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/rcrrvt.png'
};

// ============================================
// 🤖 BOT ENGINE
// ============================================
async function StartSayuraBot(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    console.log(`\n[ 🛠️ ] Starting session for: ${sanitizedNumber}`);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const socket = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'info' })), // Console එකේ වැඩි විස්තර පෙන්වීමට 'info' කළා
        },
        logger: pino({ level: 'info' }), 
        browser: Browsers.macOS('Safari'),
        printQRInTerminal: false
    });

    socket.ev.on('creds.update', saveCreds);

    // 📡 CONNECTION LOGS
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'connecting') {
            console.log(`[ ⏳ ] Connecting to WhatsApp... (${sanitizedNumber})`);
        }

        if (connection === 'open') {
            console.log(`\n============================================`);
            console.log(`✅ SUCCESS: ${sanitizedNumber} is Connected!`);
            console.log(`📱 Device: ${socket.user.name || 'WhatsApp Web'}`);
            console.log(`============================================\n`);
            
            const userJid = jidNormalizedUser(socket.user.id);
            await delay(3000);
            await socket.sendMessage(userJid, { 
                image: { url: config.RCD_IMAGE_PATH },
                caption: `🚀 *SAYURA MD MINI CONNECTED*\n\nPrefix: [ ${config.PREFIX} ]\nType *${config.PREFIX}alive* to test.`
            });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`[ ❌ ] Connection Closed. Reason: ${lastDisconnect?.error?.message}`);
            if (shouldReconnect) {
                console.log(`[ 🔄 ] Retrying in 5 seconds...`);
                setTimeout(() => StartSayuraBot(sanitizedNumber, { headersSent: true }), 5000);
            }
        }
    });

    // 📩 MESSAGE LOGS & PLUGINS
    socket.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const msg = chatUpdate.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const pushName = msg.pushName || "Unknown";
            const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            // Console එකේ මැසේජ් එක පෙන්වනවා
            console.log(`[ 📩 New Msg ] From: ${pushName} (${from}) -> Text: ${body}`);

            if (!body.startsWith(config.PREFIX)) return;

            const command = body.slice(config.PREFIX.length).trim().split(/ +/).shift().toLowerCase();

            // 🟢 ALIVE COMMAND
            if (command === "alive") {
                console.log(`[ ⚡ ] Executing: Alive Command`);
                await socket.sendMessage(from, { 
                    image: { url: config.RCD_IMAGE_PATH },
                    caption: `🧚‍♂️ *SAYURA MD MINI IS ALIVE* 🧚‍♂️\n\n🕒 *Time:* ${moment().tz('Asia/Colombo').format('HH:mm:ss')}\n🚀 *Speed:* Optimized\n\n> *Created by Sayura Mihiranga*`
                }, { quoted: msg });
            }

            // ⚡ PING COMMAND
            if (command === "ping") {
                console.log(`[ ⚡ ] Executing: Ping Command`);
                const start = Date.now();
                const { key } = await socket.sendMessage(from, { text: 'Testing Speed...' });
                const end = Date.now();
                await socket.sendMessage(from, { text: `🚀 *Pong!* ${end - start}ms`, edit: key });
            }

        } catch (e) {
            console.error(`[ ⚠️ Error ] Message Handler:`, e);
        }
    });

    // Pairing Code Request
    if (!socket.authState.creds.registered) {
        await delay(2000);
        try {
            const code = await socket.requestPairingCode(sanitizedNumber);
            console.log(`[ 🔑 ] Pairing Code Generated: ${code}`);
            if (res && !res.headersSent) res.send({ code });
        } catch (e) {
            console.log(`[ ❌ ] Pairing Code Failed:`, e.message);
            if (res && !res.headersSent) res.status(500).send({ error: "Failed" });
        }
    }
}

// ============================================
// 🌐 ROUTES & STARTUP
// ============================================
router.get('/code', async (req, res) => {
    const num = req.query.number;
    if (!num) return res.status(400).send({ error: 'Number required' });
    StartSayuraBot(num, res);
});

router.get('/', (req, res) => res.send("SAYURA SERVER IS ONLINE 🟢"));

async function startServer() {
    try {
        await mongoClient.connect();
        db = mongoClient.db("whatsapp_bot_db");
        console.log("✅ MongoDB Connected Successfully");
    } catch (e) {
        console.error("❌ DB Connection Error:", e.message);
    }
}
startServer();

module.exports = router;
