// backend/agents/extractionAgent.js

const { ingestFiles } = require('../services/ingestionPipeline');

function register({ eventBus, updateJobStatus, storageService }) {
    eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
        if (taskName !== 'extraction') return;

        try {
            const { filesMeta } = payload;
            await updateJobStatus(jobId, 0, 'in-progress', `Descompactando e lendo ${filesMeta.length} arquivo(s)...`);

            const {
                artifacts,
                fileContentsForAnalysis,
                processingMetrics,
                dataQualityReport,
            } = await ingestFiles(filesMeta, storageService);
            const nextPayload = {
                ...payload,
                artifacts,
                fileContentsForAnalysis,
            };

            await updateJobStatus(jobId, 0, 'completed');
            eventBus.emit('task:completed', {
                jobId,
                taskName,
                resultPayload: { fileContentsForAnalysis, artifacts, processingMetrics, dataQualityReport },
                payload: nextPayload,
            });
        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na extração: ${error.message}` });
        }
    });
}

module.exports = { register };
