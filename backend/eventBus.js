// backend/services/eventBus.js
const { createClient } = require('redis');

// It's a best practice to use separate clients for publishing and subscribing
// because a client in subscriber mode is blocked and cannot issue other commands.
const publisher = createClient();
const subscriber = publisher.duplicate();

const listeners = new Map();

async function connectEventBus() {
    await Promise.all([publisher.connect(), subscriber.connect()]);
    console.log('[EventBus] Conectado ao Redis Pub/Sub.');

    subscriber.on('message', (channel, message) => {
        if (listeners.has(channel)) {
            const parsedMessage = JSON.parse(message);
            listeners.get(channel).forEach(callback => callback(parsedMessage));
        }
    });
}

connectEventBus();

module.exports = {
    emit(eventName, data) {
        console.log(`[EventBus] EMIT: ${eventName}`);
        publisher.publish(eventName, JSON.stringify(data));
    },

    on(eventName, callback) {
        if (!listeners.has(eventName)) {
            listeners.set(eventName, []);
            subscriber.subscribe(eventName, (message) => {
                const parsedMessage = JSON.parse(message);
                listeners.get(eventName).forEach(cb => cb(parsedMessage));
            });
        }
        listeners.get(eventName).push(callback);
    }
};