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
app.use(express.urlencoded({ extended: true }));

// Bot Settings & MongoDB Config
const MONGO_URL = process.env.MONGODB_URL || "mongodb+srv://heshanxmd43_db_user:FEMEM3yjl69L0SuF@cluster0.b6nhi22.mongodb.net/?appName=Cluster0";
const PORT = process.env.PORT || 3000;
const BOT_TAG = "DARK-DINU";
const PREFIX = ".";

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
            generateHighQualityLinkPreview: true,
            syncFullHistory: false
        });

        // අලුත් අංකයක් සඳහා Pairing Code ලබා දීම
        if (!sock.authState.creds.registered && phoneNumber) {
            await delay(2500);
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            try {
                const code = await sock.requestPairingCode(cleanNumber);
                if (res && !res.headersSent) {
                    return res.json({ status: true, sessionId, pairingCode: code });
                }
            } catch (err) {
                if (res && !res.headersSent) {
                    return res.status(500).json({ status: false, error: err.message });
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

                console.log(chalk.red(`[${BOT_TAG}] [${sessionId}] Disconnected. Reason: ${statusCode}`));

                if (shouldReconnect) {
                    console.log(chalk.yellow(`[${BOT_TAG}] [${sessionId}] Reconnecting in 5s...`));
                    setTimeout(() => startSingleBot(sessionId), 5000);
                } else {
                    console.log(chalk.red(`[${BOT_TAG}] [${sessionId}] Logged out. Clearing session...`));
                    await clearSession();
                    activeBots.delete(sessionId);
                }
            } else if (connection === 'open') {
                console.log(chalk.green.bold(`[${BOT_TAG}] [${sessionId}] Connected Successfully!`));
                activeBots.set(sessionId, sock);
            }
        });

        // Message Handling
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            let body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

            if (!body.startsWith(PREFIX)) return;

            const [cmd, ...args] = body.slice(PREFIX.length).trim().split(/ +/);
            const command = cmd.toLowerCase();

            switch (command) {
                case 'ping': {
                    const start = Date.now();
                    const latency = Date.now() - start;
                    const pingText = `*Pong!* 🏓\n` +
                                     `⚡ *Speed:* ${latency}ms\n` +
                                     `🤖 *Bot:* ${BOT_TAG}\n` +
                                     `📁 *Session:* ${sessionId}`;
                    await sock.sendMessage(from, { text: pingText }, { quoted: msg });
                    break;
                }

                case 'alive': {
                    const aliveText = `╭━━━〔 *${BOT_TAG}* 〕━━━╮\n` +
                                      `┃ ⚡ Status: *Active & Online*\n` +
                                      `┃ ⚙️ Prefix: *${PREFIX}*\n` +
                                      `┃ 🗄️ Database: *MongoDB Atlas*\n` +
                                      `┃ 🚀 Multi-Client: *Enabled*\n` +
                                      `╰━━━━━━━━━━━━━━━━━━╯`;
                    await sock.sendMessage(from, { text: aliveText }, { quoted: msg });
                    break;
                }

                case 'menu': {
                    const menuText = `╭━━━〔 *${BOT_TAG} MENU* 〕━━━╮\n` +
                                     `┃\n` +
                                     `┃ 📌 *Commands:*\n` +
                                     `┃ 🔹 ${PREFIX}ping\n` +
                                     `┃ 🔹 ${PREFIX}alive\n` +
                                     `┃ 🔹 ${PREFIX}menu\n` +
                                     `┃\n` +
                                     `╰━━━━━━━━━━━━━━━━━━━╯`;
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                    break;
                }

                default:
                    break;
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
    console.log(chalk.green(`[${BOT_TAG}] Found ${distinctSessions.length} active sessions. Reconnecting...`));

    for (const sessionId of distinctSessions) {
        startSingleBot(sessionId);
        await delay(3000);
    }
}

// ================= Web Site & API Endpoints =================

// Pairing Code Generator Web UI
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${BOT_TAG} - Pair Code</title>
        <style>
            * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
            body { background: #0b0f19; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
            .card { background: #161f30; padding: 30px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); width: 100%; max-width: 420px; text-align: center; border: 1px solid #1f2d45; }
            h2 { color: #00ff88; margin-top: 0; font-size: 26px; }
            p { color: #94a3b8; font-size: 14px; margin-bottom: 25px; }
            .input-group { text-align: left; margin-bottom: 15px; }
            label { font-size: 13px; color: #cbd5e1; display: block; margin-bottom: 6px; }
            input { width: 100%; padding: 12px 14px; background: #0b0f19; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 15px; outline: none; }
            input:focus { border-color: #00ff88; }
            button { width: 100%; padding: 14px; background: #00ff88; color: #000; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.3s; margin-top: 10px; }
            button:hover { background: #00cc6a; }
            #result-box { margin-top: 25px; padding: 15px; background: #0b0f19; border-radius: 8px; border: 1px dashed #334155; display: none; }
            .code-display { font-size: 28px; font-weight: bold; letter-spacing: 5px; color: #38bdf8; margin: 10px 0; user-select: all; cursor: pointer; }
            .status-badge { font-size: 12px; background: #1e293b; padding: 4px 10px; border-radius: 20px; color: #38bdf8; display: inline-block; margin-bottom: 15px; }
        </style>
    </head>
    <body>
        <div class="card">
            <div class="status-badge">⚡ Active Bots: ${activeBots.size}</div>
            <h2>${BOT_TAG} PAIR CODE</h2>
            <p>Enter your phone number with country code to link your bot.</p>
            
            <div class="input-group">
                <label>Session Name / Bot ID</label>
                <input type="text" id="botId" placeholder="e.g. dinu_main">
            </div>

            <div class="input-group">
                <label>WhatsApp Number</label>
                <input type="text" id="phone" placeholder="947xxxxxxxx">
            </div>

            <button id="submitBtn" onclick="requestCode()">Get Pairing Code</button>

            <div id="result-box">
                <span style="font-size: 13px; color: #94a3b8;">Click code to copy:</span>
                <div class="code-display" id="pairCode" onclick="copyCode()">--------</div>
                <small style="color: #64748b;">Enter this code in WhatsApp > Linked Devices</small>
            </div>
        </div>

        <script>
            async function requestCode() {
                const phone = document.getElementById('phone').value.trim();
                let botId = document.getElementById('botId').value.trim();
                const btn = document.getElementById('submitBtn');
                const resultBox = document.getElementById('result-box');
                const pairCode = document.getElementById('pairCode');

                if (!phone) return alert('කරුණාකර WhatsApp අංකය ඇතුළත් කරන්න!');
                if (!botId) botId = 'dinu_' + Math.floor(Math.random() * 10000);

                btn.innerText = 'Connecting... Please wait';
                btn.disabled = true;

                try {
                    const res = await fetch(\`/pair?number=\${encodeURIComponent(phone)}&botId=\${encodeURIComponent(botId)}\`);
                    const data = await res.json();

                    if (data.status && data.pairingCode) {
                        pairCode.innerText = data.pairingCode;
                        resultBox.style.display = 'block';
                    } else {
                        alert('Error: ' + (data.error || 'Failed to get pair code'));
                    }
                } catch (e) {
                    alert('Server error! Check terminal.');
                } finally {
                    btn.innerText = 'Get Pairing Code';
                    btn.disabled = false;
                }
            }

            function copyCode() {
                const code = document.getElementById('pairCode').innerText;
                navigator.clipboard.writeText(code);
                alert('Copied to clipboard: ' + code);
            }
        </script>
    </body>
    </html>
    `);
});

// API Endpoint for Pairing Code
app.get('/pair', async (req, res) => {
    const { number, botId } = req.query;
    if (!number) {
        return res.status(400).json({ status: false, message: 'Please provide ?number=947xxxxxxxx' });
    }

    const sessionId = botId || `bot_${Date.now()}`;
    await startSingleBot(sessionId, number, res);
});

// Bots Status API
app.get('/status', (req, res) => {
    res.json({
        botName: BOT_TAG,
        activeBotsCount: activeBots.size,
        activeSessions: Array.from(activeBots.keys())
    });
});

// Database & Server Start
mongoose.connect(MONGO_URL)
    .then(async () => {
        console.log(chalk.green(`[${BOT_TAG}] MongoDB Connected Successfully!`));
        await autoReconnectAllBots();

        app.listen(PORT, () => {
            console.log(chalk.blue(`[${BOT_TAG}] Server & Pair Site running on port: ${PORT}`));
        });
    })
    .catch((err) => {
        console.error(chalk.red('MongoDB Connection Error:'), err);
    });
