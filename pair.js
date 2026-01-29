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
    AUTO_LIKE_STATUS: 'true'
};

const activeSockets = new Map();

// ============================================
// 🛠️ DATABASE & SESSION HELPERS
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
    } catch (e) { console.error("DB Save Error"); }
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
    } catch (e) { console.error("DB Restore Error"); }
    return false;
}

// ============================================
// 🤖 CORE ENGINE
// ============================================
async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

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

    socket.ev.on('creds.update', async () => {
        await saveCreds();
        await saveToDB(sanitizedNumber, sessionPath);
    });

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            activeSockets.set(sanitizedNumber, socket);
            await db.collection('active_numbers').updateOne({ id: sanitizedNumber }, { $set: { status: 'active' } }, { upsert: true });

            // මැසේජ් එක යවන කොටස
            const userJid = jidNormalizedUser(socket.user.id);
            const sessionId = Buffer.from(JSON.stringify(state.creds)).toString('base64'); // Session ID එක හදනවා

            const loginMsg = `🧚‍♂️ *SAYURA MD MINI CONNECTED* 🧚‍♂️\n\n` +
                             `✅ *Status:* Online\n` +
                             `📱 *Number:* ${sanitizedNumber}\n` +
                             `🔑 *Session ID:* \`SAYURA-MD-MINI;;${sessionId}\`\n\n` +
                             `> *Keep this ID safe!*`;

            await socket.sendMessage(userJid, { 
                image: { url: config.RCD_IMAGE_PATH },
                caption: loginMsg 
            });
            
            console.log(`✅ ${sanitizedNumber} connected & message sent.`);
        }

        if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== 401) EmpirePair(sanitizedNumber, { headersSent: true });
        }
    });

    // Pairing Code Request
    if (!socket.authState.creds.registered) {
        await delay(3000);
        try {
            const code = await socket.requestPairingCode(sanitizedNumber);
            if (res && !res.headersSent) res.status(200).json({ code });
        } catch (e) {
            if (res && !res.headersSent) res.status(500).json({ error: "Failed to get code" });
        }
    }
}

// ============================================
// 🌐 ROUTES
// ============================================
router.get('/code', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).json({ error: "Number required" });
    await EmpirePair(number, res);
});

router.get('/', (req, res) => res.send("SAYURA MD MINI SERVER ACTIVE ✅"));

// Start
mongoClient.connect().then(() => {
    db = mongoClient.db("whatsapp_bot_db");
    console.log("✅ MongoDB Connected");
    
    db.collection('active_numbers').find({ status: 'active' }).toArray().then(docs => {
        docs.forEach(doc => EmpirePair(doc.id, { headersSent: true }));
    });
});

module.exports = router;
