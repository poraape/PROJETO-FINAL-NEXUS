// backend/routes/health.js
const express = require('express');
const router = express.Router();

module.exports = (context) => {
    const { redisClient, weaviate, geminiApiKey, langchainBridge } = context;

    // --- Health Check Endpoint ---
    router.get('/', async (req, res) => {
        const hasEnvGeminiKey = Object.prototype.hasOwnProperty.call(process.env, 'GEMINI_API_KEY');
        const currentGeminiKey = hasEnvGeminiKey ? process.env.GEMINI_API_KEY : geminiApiKey;

        const healthStatus = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            services: {
                redis: 'pending',
                weaviate: 'pending',
                gemini_api: 'pending',
                langchain: 'pending',
            },
            diagnostics: {},
        };

        let isHealthy = true;

        // Check Redis
        try {
            await redisClient.ping();
            healthStatus.services.redis = 'ok';
        } catch (e) {
            healthStatus.services.redis = `error: ${e.message}`;
            isHealthy = false;
        }

        // Check Weaviate
        try {
            await weaviate.client.misc.liveChecker().do();
            healthStatus.services.weaviate = 'ok';
        } catch (e) {
            healthStatus.services.weaviate = `error: ${e.message}`;
            isHealthy = false;
        }

        // Check Gemini API Key
        healthStatus.services.gemini_api = currentGeminiKey ? 'ok' : 'error: API key not configured';
        if (!currentGeminiKey) isHealthy = false;

        // Check LangChain bridge readiness
        const langchainReady = langchainBridge?.isReady?.() ?? false;
        healthStatus.services.langchain = langchainReady ? 'ok' : 'error: LangChain bridge not ready';
        healthStatus.diagnostics.langchain = langchainBridge?.getDiagnostics?.() || null;
        if (!langchainReady) {
            isHealthy = false;
        }

        healthStatus.status = isHealthy ? 'ok' : 'error';

        res.status(isHealthy ? 200 : 503).json(healthStatus);
    });

    return router;
};
