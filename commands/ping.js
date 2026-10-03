case 'ping': {
    const start = Date.now();
    const sentMsg = await sock.sendMessage(from, { text: 'Pong!' }, { quoted: msg });
    const latency = Date.now() - start;
    
    await sock.sendMessage(from, { 
        text: `📍 *DARK-DINU Speed:* ${latency}ms`, 
        edit: sentMsg.key 
    });
    break;
}
