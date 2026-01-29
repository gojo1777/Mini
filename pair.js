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
    DisconnectReason,
    getContentType
} = require('neno-baileys');

// ============================================
// 🗄️ DATABASE CONFIG
// ============================================
const MONGO_URL = "mongodb+srv://sayuramini41_db_user:L0MTttjRAvw9viC0@cluster0.ojtdvhh.mongodb.net/?retryWrites=true&w=majority"; 
const mongoClient = new MongoClient(MONGO_URL, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
    tls: true,
    connectTimeoutMS: 60000,
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

    console.log(`\n[ ⚡ SYSTEM ] Starting Bot Engine for: ${sanitizedNumber}`);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const socket = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Safari'),
        syncFullHistory: false
    });

    socket.ev.on('creds.update', saveCreds);

    // 📡 CONNECTION UPDATES
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log(`\n============================================`);
            console.log(`✅ SUCCESS: ${sanitizedNumber} IS CONNECTED!`);
            console.log(`============================================\n`);
            
            const userJid = jidNormalizedUser(socket.user.id);
            await delay(3000);
            await socket.sendMessage(userJid, { 
                image: { url: config.RCD_IMAGE_PATH },
                caption: `🚀 *SAYURA MD MINI V1 CONNECTED*\n\nPrefix: [ ${config.PREFIX} ]\nTry *${config.PREFIX}alive* or *${config.PREFIX}ping*`
            });
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log(`[ 🔄 ] Connection Closed. Retrying in 5s...`);
                setTimeout(() => StartSayuraBot(sanitizedNumber, { headersSent: true }), 5000);
            }
        }
    });

    // 📩 MESSAGE HANDLER (Alive & Ping Fixed)
    socket.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const mType = getContentType(msg.message);
            const pushName = msg.pushName || "User";
            
            let body = (mType === 'conversation') ? msg.message.conversation : 
                       (mType === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : '';
            body = body.trim();

            if (body) console.log(`[ 📨 MSG ] From: ${pushName} | Content: ${body}`);

            if (!body.startsWith(config.PREFIX)) return;

            const args = body.slice(config.PREFIX.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // 🟢 ALIVE COMMAND
            if (command === "alive") {
                console.log(`[ ⚡ CMD ] Executing ALIVE`);
                await socket.sendMessage(from, { 
                    image: { url: config.RCD_IMAGE_PATH },
                    caption: `🧚‍♂️ *SAYURA MD MINI IS ALIVE* 🧚‍♂️\n\n🕒 *Time:* ${moment().tz('Asia/Colombo').format('HH:mm:ss')}\n🚀 *Status:* Running on Heroku\n\n> *Created by Sayura Mihiranga*`
                }, { quoted: msg });
            }

            // ⚡ PING COMMAND
            if (command === "ping") {
                console.log(`[ ⚡ CMD ] Executing PING`);
                const start = Date.now();
                const { key } = await socket.sendMessage(from, { text: 'Testing Ping...' }, { quoted: msg });
                const end = Date.now();
                await socket.sendMessage(from, { 
                    text: `🚀 *Pong!* \nSpeed: ${end - start}ms`, 
                    edit: key 
                });
            }

        } catch (e) { console.log(`[ ⚠️ ERR ]`, e.message); }
    });

    // Pairing Code Request
    if (!socket.authState.creds.registered) {
        await delay(2000);
        try {
            const code = await socket.requestPairingCode(sanitizedNumber);
            console.log(`[ 🔑 CODE ] Your Pairing Code: ${code}`);
            if (res && !res.headersSent) res.send({ code });
        } catch (e) {
            console.log(`[ ❌ ] Code Error:`, e.message);
            if (res && !res.headersSent) res.status(500).send({ error: "Failed" });
        }
    }
}

// 🌐 ROUTES
router.get('/code', async (req, res) => {
    const num = req.query.number;
    if (!num) return res.status(400).send({ error: 'Number required' });
    StartSayuraBot(num, res);
});

router.get('/', (req, res) => res.send("SAYURA MINI WORKING ✅"));

async function boot() {
    try {
        await mongoClient.connect();
        db = mongoClient.db("whatsapp_bot_db");
        console.log("✅ [ DB ] Connected Successfully");
    } catch (e) { console.log(`❌ [ DB ] Error: ${e.message}`); }
}
boot();

module.exports = router;
