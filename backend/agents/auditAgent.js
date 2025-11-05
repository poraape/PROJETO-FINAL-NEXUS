// backend/agents/auditAgent.js

function register({ eventBus, updateJobStatus }) {
    eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
        if (taskName !== 'audit') return;
        try {
            await updateJobStatus(jobId, 1, 'in-progress', 'Ag. Auditor: Verificando consistência...');
            await new Promise(res => setTimeout(res, 500)); // Simulação
            await updateJobStatus(jobId, 1, 'completed');
            eventBus.emit('task:completed', { jobId, taskName, resultPayload: {}, payload: payload }); // Passa o payload adiante
        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na auditoria: ${error.message}` });
        }
    });
}

module.exports = { register };