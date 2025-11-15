// backend/routes/gemini.js
const express = require('express');
const router = express.Router();
const logger = require('../services/logger').child({ module: 'geminiProxy' });
const metrics = require('../services/metrics');
const { requireAuth, requireScopes } = require('../middleware/auth');
const { memoryRateLimiter } = require('../middleware/rateLimiter');

const RATE_WINDOW_MS = parseInt(process.env.GEMINI_PROXY_WINDOW_MS || '60000', 10);
const RATE_MAX_REQUESTS = parseInt(process.env.GEMINI_PROXY_MAX_REQUESTS || '60', 10);

const limiter = memoryRateLimiter({
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX_REQUESTS,
    keyResolver: req => req.auth?.sub || req.auth?.orgId || req.ip,
});

module.exports = (context) => {
    const { model } = context;

    router.use(requireAuth);
    router.use(requireScopes(['gemini:invoke']));
    router.use(limiter);

    // --- Endpoint Proxy ---
    router.post('/', async (req, res) => {
        const { promptParts, isJsonMode } = req.body;

        if (!promptParts || !Array.isArray(promptParts)) {
            return res.status(400).json({ message: "O corpo da requisição deve conter 'promptParts'." });
        }

        metrics.incrementCounter('gemini_proxy_requests_total');
        const start = Date.now();
        logger.info('[GeminiProxy] Requisição recebida.', { isJsonMode: Boolean(isJsonMode) });

        try {
            const result = await model.generateContent({
                contents: [{ parts: promptParts }],
            });

            const response = await result.response;
            const text = response.text();

            metrics.observeSummary('gemini_proxy_latency_ms', Date.now() - start);
            res.status(200).json({
                text: text,
                candidates: response.candidates,
            });
        } catch (error) {
            logger.error('[GeminiProxy] Falha ao chamar Gemini.', { error: error.message });
            metrics.incrementCounter('gemini_proxy_failures_total');
            res.status(500).json({
                message: `Erro no servidor ao processar a requisição da IA: ${error.message}`,
                details: error.toString(),
            });
        }
    });

    return router;
};
