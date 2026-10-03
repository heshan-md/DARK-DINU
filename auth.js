const mongoose = require('mongoose');
const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

// MongoDB Session Schema
const sessionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    keyId: { type: String, required: true },
    data: { type: String, required: true }
});
sessionSchema.index({ sessionId: 1, keyId: 1 }, { unique: true });

const SessionModel = mongoose.model('Session', sessionSchema);

/**
 * MongoDB Auth State generator for multi-bot support
 */
async function useMongoAuthState(sessionId) {
    const writeData = async (data, id) => {
        const serialized = JSON.stringify(data, BufferJSON.replacer);
        await SessionModel.findOneAndUpdate(
            { sessionId, keyId: id },
            { data: serialized },
            { upsert: true, new: true }
        );
    };

    const readData = async (id) => {
        try {
            const result = await SessionModel.findOne({ sessionId, keyId: id });
            if (result && result.data) {
                return JSON.parse(result.data, BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            return null;
        }
    };

    const removeData = async (id) => {
        try {
            await SessionModel.deleteOne({ sessionId, keyId: id });
        } catch (error) {}
    };

    // Load Creds or Initialize
    const credsData = await readData('creds');
    const creds = credsData || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds'),
        clearSession: async () => {
            await SessionModel.deleteMany({ sessionId });
        }
    };
}

module.exports = { useMongoAuthState, SessionModel };
