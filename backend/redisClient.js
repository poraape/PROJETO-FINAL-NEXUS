// backend/services/redisClient.js
const { createClient } = require('redis');

const client = createClient({
  // Por padrão, ele tentará se conectar a redis://127.0.0.1:6379
  // Se seu Redis estiver em outro lugar, configure a URL aqui:
  // url: 'redis://user:password@host:port'
});

client.on('error', (err) => console.error('[Redis] Erro no Cliente Redis', err));

async function connectRedis() {
    if (!client.isOpen) {
        await client.connect();
        console.log('[Redis] Conectado ao servidor Redis.');
    }
}

connectRedis();

module.exports = client;