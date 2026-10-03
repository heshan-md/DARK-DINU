require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const chalk = require('chalk');
const pino = require('pino');
const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay
} = require('@whiskeysockets/baileys');
const { useMongoAuthState, SessionModel } = require('./auth');

const app = express();
app.use(express.json());

// MongoDB Connection URL
const MONGO_URL = process.env.MONGODB_URL || "mongodb+srv://heshanxmd43_db_user:FEMEM3yjl69L0SuF@cluster0.b6nhi22.mongodb.net/?appName=Cluster0";
const PORT = process.env.PORT || 3000;
const BOT_TAG = "DARK-DINU";

// Active Bot sockets Map
const activeBots = new Map();

/**
 * තනි Bot instance එකක් ආරම්භ කර run කිරීම
 */
async function startSingleBot(sessionId, phoneNumber = null, res = null) {
    try {
        const { state, saveCreds, clearSession } = await useMongoAuthState(sessionId);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            syncFullHistory: false
        });

        // අලුත් අංකයක් සඳහා Pairing Code ලබා දීම
        if (!sock.authState.creds.registered && phoneNumber) {
            await delay(2500);
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            try {
                const code = await sock.requestPairingCode(cleanNumber);
                if (res && !res.headersSent) {
                    res.json({ status: true, sessionId, pairingCode: code });
                }
            } catch (err) {
                if (res && !res.headersSent) {
                    res.status(500).json({ status: false, error: err.message });
                }
            }
        }

        // Credentials save කිරීම
        sock.ev.on('creds.update', saveCreds);

        // Connection State
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(chalk.red(`[${BOT_TAG}] [${sessionId}] Disconnected. Code: ${statusCode}`));

                if (shouldReconnect) {
                    console.log(chalk.yellow(`[${BOT_TAG}] [${sessionId}] Reconnecting...`));
                    setTimeout(() => startSingleBot(sessionId), 5000);
                } else {
                    console.log(chalk.red(`[${BOT_TAG}] [${sessionId}] Logged out. Clearing data...`));
                    await clearSession();
                    activeBots.delete(sessionId);
                }
            } else if (connection === 'open') {
                console.log(chalk.green(`[${BOT_TAG}] [${sessionId}] Connected Successfully!`));
                activeBots.set(sessionId, sock);
            }
        });

        // Message Handling (Basic Commands)
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            let body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const prefix = '.';

            if (!body.startsWith(prefix)) return;

            const [cmd, ...args] = body.slice(prefix.length).trim().split(/ +/);

            if (cmd === 'ping') {
                await sock.sendMessage(from, { text: `📍 *${BOT_TAG} is Online!* (Session: ${sessionId})` }, { quoted: msg });
            } else if (cmd === 'alive') {
                await sock.sendMessage(from, {
                    text: `*👋 DARK-DINU MD Multi-Bot Active!*\n⚡ Running smoothly on MongoDB.`
                }, { quoted: msg });
            }
        });

        return sock;
    } catch (e) {
        console.error(chalk.red(`Error in bot ${sessionId}:`), e);
        if (res && !res.headersSent) {
            res.status(500).json({ status: false, error: e.message });
        }
    }
}

/**
 * Server Restart වූ විට MongoDB හි ඇති සියලු Bots Auto-Reconnect කිරීම
 */
async function autoReconnectAllBots() {
    console.log(chalk.cyan(`[${BOT_TAG}] Searching saved sessions in MongoDB...`));
    const distinctSessions = await SessionModel.distinct('sessionId');
    console.log(chalk.green(`[${BOT_TAG}] Found ${distinctSessions.length} sessions. Starting them up...`));

    for (const sessionId of distinctSessions) {
        startSingleBot(sessionId);
        await delay(3000); // Server overload නොවීමට delay එකක්
    }
}

// ================= Express Endpoints =================

// අලුත් Bot කෙනෙක් Add කර Pairing Code එක ගන්න API එක
// GET /pair?number=947xxxxxxxx&botId=bot_1
app.get('/pair', async (req, res) => {
    const { number, botId } = req.query;
    if (!number) {
        return res.status(400).json({ status: false, message: 'Please provide ?number=947xxxxxxxx' });
    }

    const sessionId = botId || `bot_${Date.now()}`;
    await startSingleBot(sessionId, number, res);
});

// දැනට Run වෙන Bots ගණන බැලීමට
app.get('/status', (req, res) => {
    res.json({
        botName: BOT_TAG,
        activeBotsCount: activeBots.size,
        activeSessions: Array.from(activeBots.keys())
    });
});

app.get('/', (req, res) => {
    res.send(`<h3>⚡ ${BOT_TAG} Multi-Bot Server is Running! Active Bots: ${activeBots.size}</h3>`);
});

// Server සහ Database Start කිරීම
mongoose.connect(MONGO_URL)
    .then(async () => {
        console.log(chalk.green(`[${BOT_TAG}] MongoDB Connected Successfully!`));
        
        // කලින් තිබූ සියලුම bots auto start කරන්න
        await autoReconnectAllBots();

        app.listen(PORT, () => {
            console.log(chalk.blue(`[${BOT_TAG}] Server is running on port: ${PORT}`));
        });
    })
    .catch((err) => {
        console.error(chalk.red('MongoDB Connection Error:'), err);
    });
