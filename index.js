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
    Browsers,
    delay
} = require('@whiskeysockets/baileys');
const { useMongoAuthState, SessionModel } = require('./auth');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const MONGO_URL = process.env.MONGODB_URL || "mongodb+srv://heshanxmd43_db_user:FEMEM3yjl69L0SuF@cluster0.b6nhi22.mongodb.net/?appName=Cluster0";
const PORT = process.env.PORT || 10000;
const BOT_TAG = "DARK-DINU";
const PREFIX = ".";

const activeBots = new Map();

/**
 * Single Bot Starter
 */
async function startSingleBot(sessionId, phoneNumber = null, res = null) {
    let responded = false;

    // Response helper to prevent multiple responses
    const sendResponse = (status, data) => {
        if (!responded && res && !res.headersSent) {
            responded = true;
            return res.json(Object.assign({ status }, data));
        }
    };

    try {
        const { state, saveCreds, clearSession } = await useMongoAuthState(sessionId);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            // Chrome (Ubuntu) ලෙස identify කරවීමෙන් WhatsApp block වීම වළකී
            browser: Browsers.ubuntu('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            generateHighQualityLinkPreview: true,
            syncFullHistory: false
        });

        // අලුත් අංකයක් සඳහා Pairing Code Request කිරීම
        if (!sock.authState.creds.registered && phoneNumber) {
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            
            // Socket එක initialize වීමට තත්පර 3ක් ලබා දීම
            setTimeout(async () => {
                try {
                    console.log(chalk.cyan(`[${BOT_TAG}] Requesting Pairing Code for: ${cleanNumber}`));
                    const code = await sock.requestPairingCode(cleanNumber);
                    console.log(chalk.green(`[${BOT_TAG}] Pairing Code generated: ${code}`));
                    sendResponse(true, { sessionId, pairingCode: code });
                } catch (err) {
                    console.error(chalk.red(`[${BOT_TAG}] Pairing Code Error:`), err);
                    sendResponse(false, { error: err.message || 'Failed to request pairing code' });
                }
            }, 3000);

            // Timeout Fallback (තත්පර 25කින් code එක නාවොත් error එකක් යැවීම)
            setTimeout(() => {
                sendResponse(false, { error: 'Request timed out. Please check the number and try again.' });
            }, 25000);
        }

        // Creds update
        sock.ev.on('creds.update', saveCreds);

        // Connection Handling
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
                    console.log(chalk.red(`[${BOT_TAG}] [${sessionId}] Session Expired/Logged Out.`));
                    await clearSession();
                    activeBots.delete(sessionId);
                }
            } else if (connection === 'open') {
                console.log(chalk.green.bold(`[${BOT_TAG}] [${sessionId}] Connected Successfully!`));
                activeBots.set(sessionId, sock);
            }
        });

        // Basic Commands
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
                    await sock.sendMessage(from, { 
                        text: `*Pong!* 🏓\nSpeed: *${latency}ms*\nSession: *${sessionId}*` 
                    }, { quoted: msg });
                    break;
                }

                case 'alive': {
                    await sock.sendMessage(from, { 
                        text: `*👋 DARK-DINU MD Multi-Bot is Online!*\n⚡ Database: *MongoDB*\n⚙️ Active Bots: *${activeBots.size}*` 
                    }, { quoted: msg });
                    break;
                }

                case 'menu': {
                    await sock.sendMessage(from, { 
                        text: `╭━━〔 *${BOT_TAG}* 〕━━╮\n│ .ping\n│ .alive\n│ .menu\n╰━━━━━━━━━━━━━╯` 
                    }, { quoted: msg });
                    break;
                }
            }
        });

        return sock;
    } catch (e) {
        console.error(chalk.red(`Error in bot ${sessionId}:`), e);
        sendResponse(false, { error: e.message });
    }
}

/**
 * Reconnect all saved sessions on startup
 */
async function autoReconnectAllBots() {
    try {
        console.log(chalk.cyan(`[${BOT_TAG}] Checking MongoDB for sessions...`));
        const distinctSessions = await SessionModel.distinct('sessionId');
        console.log(chalk.green(`[${BOT_TAG}] Found ${distinctSessions.length} active sessions.`));

        for (const sessionId of distinctSessions) {
            startSingleBot(sessionId);
            await delay(3000);
        }
    } catch (err) {
        console.error(chalk.red('Error reconnecting bots:'), err);
    }
}

// ================= Web Interface =================

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${BOT_TAG} - Pair Code</title>
        <style>
            * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            body { background: #0b0f19; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
            .card { background: #161f30; padding: 30px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); width: 100%; max-width: 420px; text-align: center; border: 1px solid #1f2d45; }
            h2 { color: #00ff88; margin: 0 0 10px 0; font-size: 26px; }
            p { color: #94a3b8; font-size: 14px; margin-bottom: 25px; }
            .input-group { text-align: left; margin-bottom: 15px; }
            label { font-size: 13px; color: #cbd5e1; display: block; margin-bottom: 6px; }
            input { width: 100%; padding: 12px 14px; background: #0b0f19; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 15px; outline: none; }
            input:focus { border-color: #00ff88; }
            button { width: 100%; padding: 14px; background: #00ff88; color: #000; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s; margin-top: 10px; }
            button:hover { background: #00cc6a; }
            button:disabled { background: #475569; cursor: not-allowed; }
            #result-box { margin-top: 25px; padding: 15px; background: #0b0f19; border-radius: 8px; border: 1px dashed #334155; display: none; }
            .code-display { font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #38bdf8; margin: 10px 0; user-select: all; cursor: pointer; }
            .status-badge { font-size: 12px; background: #1e293b; padding: 4px 10px; border-radius: 20px; color: #38bdf8; display: inline-block; margin-bottom: 15px; }
        </style>
    </head>
    <body>
        <div class="card">
            <div class="status-badge">⚡ Active Bots: ${activeBots.size}</div>
            <h2>${BOT_TAG} PAIR CODE</h2>
            <p>Enter your phone number to link your WhatsApp bot.</p>
            
            <div class="input-group">
                <label>Session Name / Bot ID</label>
                <input type="text" id="botId" placeholder="e.g. dinu_1">
            </div>

            <div class="input-group">
                <label>WhatsApp Number</label>
                <input type="text" id="phone" placeholder="947xxxxxxxx">
            </div>

            <button id="submitBtn" onclick="requestCode()">Get Pairing Code</button>

            <div id="result-box">
                <span style="font-size: 13px; color: #94a3b8;">Click code to copy:</span>
                <div class="code-display" id="pairCode" onclick="copyCode()">--------</div>
                <small style="color: #64748b;">WhatsApp > Linked Devices > Link with phone number</small>
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

                btn.innerText = 'Connecting to WhatsApp...';
                btn.disabled = true;
                resultBox.style.display = 'none';

                try {
                    const res = await fetch(\`/pair?number=\${encodeURIComponent(phone)}&botId=\${encodeURIComponent(botId)}\`);
                    const data = await res.json();

                    if (data.status && data.pairingCode) {
                        pairCode.innerText = data.pairingCode;
                        resultBox.style.display = 'block';
                    } else {
                        alert('Error: ' + (data.error || 'Failed to get code. Try again.'));
                    }
                } catch (e) {
                    alert('Server error! Check server logs.');
                } finally {
                    btn.innerText = 'Get Pairing Code';
                    btn.disabled = false;
                }
            }

            function copyCode() {
                const code = document.getElementById('pairCode').innerText;
                navigator.clipboard.writeText(code);
                alert('Copied: ' + code);
            }
        </script>
    </body>
    </html>
    `);
});

// Pair API
app.get('/pair', async (req, res) => {
    const { number, botId } = req.query;
    if (!number) {
        return res.status(400).json({ status: false, message: 'Please provide ?number=947xxxxxxxx' });
    }
    const sessionId = botId || `bot_${Date.now()}`;
    await startSingleBot(sessionId, number, res);
});

// Status API
app.get('/status', (req, res) => {
    res.json({
        botName: BOT_TAG,
        activeBotsCount: activeBots.size,
        activeSessions: Array.from(activeBots.keys())
    });
});

// MongoDB Connection and Server Start
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
