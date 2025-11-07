// backend/agents/classificationAgent.js

function register({ eventBus, updateJobStatus }) {
    eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
        if (taskName !== 'classification') return;
        try {
            await updateJobStatus(jobId, 3, 'in-progress', 'Ag. Classificador: Organizando informações...');
            await new Promise(res => setTimeout(res, 500)); // Simulação
            await updateJobStatus(jobId, 3, 'completed');
            eventBus.emit('task:completed', { jobId, taskName, resultPayload: {}, payload: payload });
        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na classificação: ${error.message}` });
        }
    });
}

module.exports = { register };
