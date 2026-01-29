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
    jidNormalizedUser
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
    RCD_IMAGE_PATH: 'https://files.catbox.moe/rcrrvt.png',
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_LIKE_EMOJI: ['💖', '❤️', '✨', '🌸', '🌹']
};

// ============================================
// 🛠️ DB UTILITIES (SESSION BACKUP)
// ============================================
async function saveSessionToDB(number, sessionPath) {
    try {
        if (!db) return;
        const credsPath = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
            await db.collection('sessions').updateOne(
                { id: number }, { $set: { creds, updatedAt: new Date() } }, { upsert: true }
            );
        }
    } catch (e) { console.error("DB Save Error:", e.message); }
}

async function restoreSessionFromDB(number, sessionPath) {
    try {
        if (!db) return;
        const result = await db.collection('sessions').findOne({ id: number });
        if (result && result.creds) {
            fs.ensureDirSync(sessionPath);
            fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(result.creds));
            console.log(`[ 📥 ] Session Restored from DB for ${number}`);
        }
    } catch (e) { console.error("DB Restore Error:", e.message); }
}

// ============================================
// 🤖 BOT ENGINE
// ============================================
async function StartSayuraBot(number, res) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

        // DB එකේ කලින් සෙෂන් එකක් තියෙනවද බලනවා
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

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            await saveSessionToDB(sanitizedNumber, sessionPath);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                console.log(`\n✅ SUCCESS: ${sanitizedNumber} Connected!`);
                if (db) await db.collection('active_numbers').updateOne({ id: sanitizedNumber }, { $set: { status: 'active' } }, { upsert: true });
                
                const userJid = jidNormalizedUser(socket.user.id);
                await delay(3000); 
                await socket.sendMessage(userJid, { 
                    image: { url: config.RCD_IMAGE_PATH },
                    caption: `🚀 *SAYURA MD MINI V1 CONNECTED*\n\nPrefix: [ ${config.PREFIX} ]\nNumber: ${sanitizedNumber}\n\nType *${config.PREFIX}alive* to check status.`
                });
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== 401) {
                    console.log(`[ 🔄 ] Reconnecting...`);
                    setTimeout(() => StartSayuraBot(sanitizedNumber, { headersSent: true }), 5000);
                }
            }
        });

        socket.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;

                const sender = msg.key.remoteJid;

                // 🌈 AUTO STATUS VIEW/LIKE
                if (sender === 'status@broadcast') {
                    if (config.AUTO_VIEW_STATUS === 'true') await socket.readMessages([msg.key]);
                    if (config.AUTO_LIKE_STATUS === 'true') {
                        const emoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                        await socket.sendMessage(sender, { react: { text: emoji, key: msg.key } }, { statusJidList: [msg.key.participant] });
                    }
                    return;
                }

                const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
                console.log(`[ 📩 ] Msg from ${sender}: ${text}`);

                if (!text.startsWith(config.PREFIX)) return;
                
                const args = text.slice(config.PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();

                // 🟢 ALIVE COMMAND
                if (command === 'alive') {
                    const aliveMsg = `🧚‍♂️ *SAYURA MD MINI IS ALIVE* 🧚‍♂️\n\n🕒 *Time:* ${moment().tz('Asia/Colombo').format('HH:mm:ss')}\n🚀 *Status:* Online\n\n> *Created by Sayura Mihiranga*`;
                    await socket.sendMessage(sender, { image: { url: config.RCD_IMAGE_PATH }, caption: aliveMsg }, { quoted: msg });
                }

                // ⚡ PING COMMAND
                if (command === 'ping') {
                    const start = Date.now();
                    const { key } = await socket.sendMessage(sender, { text: 'Testing...' }, { quoted: msg });
                    const end = Date.now();
                    await socket.sendMessage(sender, { text: `🚀 *Pong!* \nSpeed: ${end - start}ms`, edit: key });
                }

            } catch (err) { console.log(err); }
        });

        // 🔑 PAIRING CODE GENERATOR
        if (!socket.authState.creds.registered) {
            await delay(3000);
            try {
                const code = await socket.requestPairingCode(sanitizedNumber);
                console.log(`[ 🔑 ] CODE FOR ${sanitizedNumber}: ${code}`);
                if (res && !res.headersSent) res.send({ code });
            } catch (e) {
                if (res && !res.headersSent) res.status(500).send({ error: "Pairing failed" });
            }
        }

    } catch (e) { console.log("Critical Error:", e.message); }
}

// ============================================
// 🌐 ROUTES & STARTUP
// ============================================
router.get('/code', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).send({ error: 'Number required.' });
    StartSayuraBot(number, res);
});

router.get('/', (req, res) => res.send("SAYURA MINI WORKING ✅"));

async function bootSystem() {
    try {
        await mongoClient.connect();
        db = mongoClient.db("whatsapp_bot_db");
        console.log("✅ [ DB ] MongoDB Connected!");

        // කලින් Active වෙලා තිබුණ නම්බර්ස් ඔක්කොම ආයේ දුවවනවා
        const activeDocs = await db.collection('active_numbers').find({ status: 'active' }).toArray();
        for (const doc of activeDocs) {
            StartSayuraBot(doc.id, { headersSent: true });
            await delay(5000);
        }
    } catch (e) { console.log("Boot Error:", e.message); }
}

bootSystem();

module.exports = router;
