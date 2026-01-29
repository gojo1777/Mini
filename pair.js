const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const router = express.Router();
const pino = require('pino');
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
// 🗄️ DATABASE CONFIG (Crash-Safe)
// ============================================
const MONGO_URL = "mongodb+srv://sayuramini41_db_user:L0MTttjRAvw9viC0@cluster0.ojtdvhh.mongodb.net/?retryWrites=true&w=majority"; 
const mongoClient = new MongoClient(MONGO_URL, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
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
// 🛠️ DB UTILITIES
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
                console.log(`✅ ${sanitizedNumber} Connected!`);
                if (db) await db.collection('active_numbers').updateOne({ id: sanitizedNumber }, { $set: { status: 'active' } }, { upsert: true });
                
                const userJid = jidNormalizedUser(socket.user.id);
                await delay(3000); // ඩේටා sync වෙන්න වෙලාව දෙනවා
                await socket.sendMessage(userJid, { 
                    image: { url: config.RCD_IMAGE_PATH },
                    caption: `🚀 *SAYURA MD MINI V1 CONNECTED*\n\nYour bot is now active on ${sanitizedNumber}.`
                }).catch(e => console.log("Welcome message send failed"));
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== 401) {
                    console.log(`🔄 Reconnecting ${sanitizedNumber}...`);
                    // Recursion වලදී එන crash එක නැති කරන්න delay එකක් එක්ක reconnect කරනවා
                    setTimeout(() => StartSayuraBot(sanitizedNumber, { headersSent: true }), 5000);
                }
            }
        });

        socket.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;

                const sender = msg.key.remoteJid;

                // Status Logic
                if (sender === 'status@broadcast') {
                    if (config.AUTO_VIEW_STATUS === 'true') await socket.readMessages([msg.key]);
                    if (config.AUTO_LIKE_STATUS === 'true') {
                        const emoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                        await socket.sendMessage(sender, { react: { text: emoji, key: msg.key } }, { statusJidList: [msg.key.participant] });
                    }
                    return;
                }

                const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
                if (!text.startsWith(config.PREFIX)) return;
                const command = text.slice(config.PREFIX.length).split(' ')[0].toLowerCase();

                if (command === 'alive') {
                    await socket.sendMessage(sender, { text: "SAYURA MINI MD is Alive! 🟢" }, { quoted: msg });
                }
            } catch (msgErr) { console.error("Message Error:", msgErr.message); }
        });

        // Pairing Code
        if (!socket.authState.creds.registered) {
            await delay(3000);
            try {
                const code = await socket.requestPairingCode(sanitizedNumber);
                if (res && !res.headersSent) res.send({ code });
            } catch (e) {
                if (res && !res.headersSent) res.status(500).send({ error: "Pairing failed" });
            }
        }

    } catch (mainErr) {
        console.error("Critical Crash Prevented:", mainErr.message);
    }
}

// ============================================
// 🌐 ROUTES & BOOT
// ============================================
router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).send({ error: 'Number required.' });
    StartSayuraBot(number, res);
});

async function bootSystem() {
    try {
        await mongoClient.connect();
        db = mongoClient.db("whatsapp_bot_db");
        console.log("✅ MongoDB Connected!");

        const activeDocs = await db.collection('active_numbers').find({ status: 'active' }).toArray();
        for (const doc of activeDocs) {
            StartSayuraBot(doc.id, { headersSent: true });
            await delay(5000);
        }
    } catch (e) { console.error("Boot Error:", e.message); }
}

bootSystem();

module.exports = router;
