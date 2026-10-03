const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');

/**
 * Multi-file auth state එක initialize කර session folder එක කළමනාකරණය කරයි.
 * @param {string} sessionFolder 
 */
async function initAuth(sessionFolder = 'session') {
    const sessionDir = path.resolve(__dirname, sessionFolder);

    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    return {
        state,
        saveCreds
    };
}

module.exports = { initAuth };
