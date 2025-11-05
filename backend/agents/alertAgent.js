// backend/agents/alertAgent.js

function register({ eventBus }) {
    // Este agente é passivo e apenas escuta por falhas.
    eventBus.on('task:failed', ({ jobId, taskName, error }) => {
        // Em um sistema de produção, isso poderia enviar um email, uma notificação no Slack, ou registrar em um sistema de monitoramento como Sentry ou Datadog.
        console.error(`\n🚨 ALERTA 🚨\n----------------------------------------\nJob ID: ${jobId}\nTarefa Falhou: ${taskName}\nMotivo: ${error}\n----------------------------------------\n`);
    });
}

module.exports = { register };