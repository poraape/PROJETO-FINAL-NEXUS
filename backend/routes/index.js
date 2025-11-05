// backend/routes/index.js

const jobsRouter = require('./jobs');
const geminiRouter = require('./gemini');
const healthRouter = require('./health');

/**
 * Registra todas as rotas da API no aplicativo Express.
 * @param {import('express').Application} app - A instância do aplicativo Express.
 * @param {object} context - Um objeto contendo as dependências compartilhadas.
 */
function registerRoutes(app, context) {
    // O contexto para as rotas precisa de acesso aos clientes de serviço e modelos de IA
    const { model, embeddingModel, availableTools } = require('../services/geminiClient');
    const routeContext = {
        ...context,
        model,
        embeddingModel,
        availableTools,
    };

    app.use('/api/jobs', jobsRouter(routeContext));
    app.use('/api/gemini', geminiRouter(routeContext));
    app.use('/api/health', healthRouter(routeContext));
}

module.exports = registerRoutes;