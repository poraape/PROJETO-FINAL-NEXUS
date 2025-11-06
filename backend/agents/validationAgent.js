// backend/agents/validationAgent.js

const tools = require('../services/tools');

function register({ eventBus, updateJobStatus }) {
    eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
        if (taskName !== 'validation') return;

        try {
            const { fileContentsForAnalysis } = payload;
            await updateJobStatus(jobId, 1, 'in-progress', 'Ag. Validador: Buscando e validando CNPJs...');

            // Simple regex to find potential CNPJs in the text content
            const cnpjRegex = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
            const combinedContent = fileContentsForAnalysis.map(f => f.content).join(' ');
            const foundCnpjs = [...new Set(combinedContent.match(cnpjRegex) || [])];

            if (foundCnpjs.length === 0) {
                await updateJobStatus(jobId, 1, 'completed', 'Nenhum CNPJ encontrado para validação.');
                eventBus.emit('task:completed', { jobId, taskName, resultPayload: { validations: [] }, payload });
                return;
            }

            const validations = [];
            const rateLimitDelay = parseInt(process.env.BRASILAPI_DELAY_MS || '150', 10);

            for (const cnpj of foundCnpjs) {
                try {
                    const result = await tools.cnpj_validation({ cnpj });
                    validations.push(result);
                } catch (err) {
                    validations.push({ error: true, message: err.message, cnpj });
                    console.warn(`[ValidationAgent] Falha ao validar CNPJ ${cnpj}:`, err);
                }
                if (rateLimitDelay > 0) {
                    await new Promise(res => setTimeout(res, rateLimitDelay));
                }
            }

            const errors = validations.filter(v => v?.error);
            const infoMessage = errors.length === 0
                ? `${validations.length} CNPJ(s) validados.`
                : `${validations.length} CNPJ(s) processados. ${errors.length} retornaram erro.`;

            await updateJobStatus(jobId, 1, 'completed', infoMessage);
            eventBus.emit('task:completed', { jobId, taskName, resultPayload: { validations }, payload });
        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na validação de CNPJ: ${error.message}` });
        }
    });
}

module.exports = { register };
