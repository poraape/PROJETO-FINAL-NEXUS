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

            const validationPromises = foundCnpjs.map(cnpj => tools.cnpj_validation({ cnpj }));
            const validations = await Promise.all(validationPromises);

            await updateJobStatus(jobId, 1, 'completed', `${validations.length} CNPJ(s) validados.`);
            eventBus.emit('task:completed', { jobId, taskName, resultPayload: { validations }, payload });
        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na validação de CNPJ: ${error.message}` });
        }
    });
}

module.exports = { register };