const logger = require('../services/logger').child({ module: 'cacheConfig' });

function parseDuration(envName, defaultSeconds) {
    const raw = process.env[envName];
    if (!raw) return defaultSeconds;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        logger.warn(`[CacheConfig] Valor inválido para ${envName}. Usando fallback ${defaultSeconds}s.`, { raw });
        return defaultSeconds;
    }
    return parsed;
}

const jobTtlSeconds = parseDuration('JOB_TTL_SECONDS', 60 * 60 * 24 * 7); // 7 dias
const chatCacheTtlSeconds = parseDuration('CHAT_CACHE_TTL_SECONDS', 15 * 60); // 15 minutos

module.exports = {
    jobTtlSeconds,
    chatCacheTtlSeconds,
};
