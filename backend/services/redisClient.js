// backend/services/redisClient.js
const { createClient } = require('redis');

const client = createClient({
  // Por padrão, ele tentará se conectar a redis://127.0.0.1:6379
  // Se seu Redis estiver em outro lugar, configure a URL aqui:
  // url: 'redis://user:password@host:port'
});

client.on('error', (err) => console.error('[Redis] Erro no Cliente Redis', err));

const MAX_RETRIES = parseInt(process.env.REDIS_MAX_RETRIES ?? '10', 10);
const RETRY_DELAY_MS = parseInt(process.env.REDIS_RETRY_DELAY_MS ?? '1000', 10);
let retries = 0;

async function connectRedis() {
    if (client.isOpen) return;

    try {
        await client.connect();
        console.log('[Redis] Conectado ao servidor Redis.');
    } catch (error) {
        retries += 1;
        console.error(`[Redis] Falha ao conectar (tentativa ${retries}/${MAX_RETRIES}): ${error.message}`);
        if (retries < MAX_RETRIES) {
            setTimeout(connectRedis, RETRY_DELAY_MS);
        } else {
            console.error('[Redis] Limite de tentativas atingido. Continuando sem cache.');
        }
    }
}

connectRedis();

module.exports = client;
