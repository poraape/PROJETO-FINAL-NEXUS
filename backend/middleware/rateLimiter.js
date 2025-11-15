const metrics = require('../services/metrics');

function memoryRateLimiter({ windowMs = 60000, max = 60, keyResolver }) {
    const windows = new Map();

    return (req, res, next) => {
        const key = keyResolver ? keyResolver(req) : req.ip;
        const now = Date.now();
        const windowStart = now - windowMs;
        const entry = windows.get(key) || [];
        const filtered = entry.filter(timestamp => timestamp > windowStart);
        filtered.push(now);
        windows.set(key, filtered);

        if (filtered.length > max) {
            metrics.incrementCounter('gemini_proxy_blocked_total');
            return res.status(429).json({ message: 'Limite de requisições atingido. Aguarde alguns instantes.' });
        }
        metrics.incrementCounter('gemini_proxy_allowed_total');
        return next();
    };
}

module.exports = {
    memoryRateLimiter,
};
