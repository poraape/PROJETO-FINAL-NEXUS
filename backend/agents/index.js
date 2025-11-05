// backend/agents/index.js
/**
 * Registra todos os agentes que compõem o pipeline de processamento.
 * Cada agente expõe uma função `register` que recebe o contexto compartilhado
 * e se inscreve nos eventos relevantes do event bus.
 */

const agents = [
    { name: 'extractionAgent', module: require('./extractionAgent') },
    { name: 'validationAgent', module: require('./validationAgent') },
    { name: 'auditAgent', module: require('./auditAgent') },
    { name: 'classificationAgent', module: require('./classificationAgent') },
    { name: 'analysisAgent', module: require('./analysisAgent') },
    { name: 'indexingAgent', module: require('./indexingAgent') },
    { name: 'alertAgent', module: require('./alertAgent') },
];

function registerAgents(context) {
    agents.forEach(({ name, module }) => {
        if (module && typeof module.register === 'function') {
            module.register(context);
        } else {
            console.warn(`[Agents] O módulo ${name} não exporta uma função register.`);
        }
    });
}

module.exports = registerAgents;
