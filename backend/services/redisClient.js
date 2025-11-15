// backend/services/redisClient.js
const fs = require('fs');
const { createClient } = require('redis');
const logger = require('./logger').child({ module: 'redisClient' });

function readFileIfExists(filePath) {
    if (!filePath) return undefined;
    try {
        return fs.readFileSync(filePath);
    } catch (error) {
        logger.warn('[Redis] Não foi possível ler arquivo TLS informado.', { filePath, error });
        return undefined;
    }
}

function buildSocketOptions() {
    const redisUrl = process.env.REDIS_URL;
    const socketOptions = {};

    if (!redisUrl && process.env.REDIS_HOST) {
        socketOptions.host = process.env.REDIS_HOST;
    }
    if (!redisUrl && process.env.REDIS_PORT) {
        const parsedPort = Number.parseInt(process.env.REDIS_PORT, 10);
        if (!Number.isNaN(parsedPort)) {
            socketOptions.port = parsedPort;
        }
    }

    const tlsExplicit = process.env.REDIS_TLS === 'true';
    const tlsEnabled = tlsExplicit || (redisUrl && redisUrl.startsWith('rediss://'));

    if (!tlsEnabled) {
        return socketOptions;
    }

    socketOptions.tls = true;
    socketOptions.rejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false';

    const ca = readFileIfExists(process.env.REDIS_TLS_CA_FILE);
    if (ca) socketOptions.ca = ca;
    const cert = readFileIfExists(process.env.REDIS_TLS_CERT_FILE);
    const key = readFileIfExists(process.env.REDIS_TLS_KEY_FILE);
    if (cert && key) {
        socketOptions.cert = cert;
        socketOptions.key = key;
    }

    logger.info('[Redis] TLS habilitado para a conexão com o cache.', {
        caConfigured: Boolean(ca),
        mTLS: Boolean(cert && key),
        rejectUnauthorized: socketOptions.rejectUnauthorized,
    });

    return socketOptions;
}

const redisOptions = {
    url: process.env.REDIS_URL,
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
};

const socketOptions = buildSocketOptions();
if (Object.keys(socketOptions).length > 0) {
    redisOptions.socket = socketOptions;
}

const client = createClient(redisOptions);

client.on('error', (err) => logger.error('[Redis] Erro no Cliente Redis.', { error: err }));

const MAX_RETRIES = parseInt(process.env.REDIS_MAX_RETRIES ?? '10', 10);
const RETRY_DELAY_MS = parseInt(process.env.REDIS_RETRY_DELAY_MS ?? '1000', 10);
let retries = 0;

async function connectRedis() {
    if (client.isOpen) return;

    try {
        await client.connect();
        logger.info('[Redis] Conectado ao servidor Redis.');
    } catch (error) {
        retries += 1;
        logger.error('[Redis] Falha ao conectar ao servidor.', { attempt: retries, maxRetries: MAX_RETRIES, error });
        if (retries < MAX_RETRIES) {
            setTimeout(connectRedis, RETRY_DELAY_MS);
        } else {
            logger.error('[Redis] Limite de tentativas atingido. Continuando sem cache.');
        }
    }
}

connectRedis();

module.exports = client;
