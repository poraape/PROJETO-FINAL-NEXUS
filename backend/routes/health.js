// backend/routes/health.js
const express = require('express');
const router = express.Router();

module.exports = (context) => {
    const { redisClient, weaviate, geminiApiKey } = context;

    // --- Health Check Endpoint ---
    router.get('/', async (req, res) => {
        const healthStatus = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            services: {
                redis: 'pending',
                weaviate: 'pending',
                gemini_api: 'pending',
            }
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
        healthStatus.services.gemini_api = geminiApiKey ? 'ok' : 'error: API key not configured';
        if (!geminiApiKey) isHealthy = false;

        res.status(isHealthy ? 200 : 503).json(healthStatus);
    });

    return router;
};