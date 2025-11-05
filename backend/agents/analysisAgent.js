// backend/agents/analysisAgent.js

const { model, availableTools } = require('../services/geminiClient');

function register({ eventBus, updateJobStatus }) {
    // Agente de Análise (IA)
    eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
        if (taskName !== 'analysis') return;
        try {
            const { fileContentsForAnalysis } = payload;
            await updateJobStatus(jobId, 3, 'in-progress', 'Ag. Inteligência: Gerando análise executiva...');
            const combinedContent = fileContentsForAnalysis.map(f => `--- START FILE: ${f.fileName} ---\n${f.content}`).join('\n\n').substring(0, 30000);
            const prompt = `
                Analise o conteúdo dos seguintes arquivos e gere um resumo executivo em JSON. Se o valor total das notas for superior a 100000, use a ferramenta 'tax_simulation' para o regime 'Lucro Real'.
                Estrutura do JSON final: { "title": "string", "description": "string", "keyMetrics": { "numeroDeDocumentosValidos": number, "valorTotalDasNfes": number }, "actionableInsights": [{ "text": "string" }], "simulationResult": object | null }
                CONTEÚDO: ${combinedContent}
            `;

            const chat = model.startChat({
                tools: availableTools,
            });

            const result = await chat.sendMessage(prompt);
            const call = result.response.functionCalls()?.[0];

            if (call) {
                console.log(`[AnalysisAgent] Job ${jobId}: IA solicitou o uso da ferramenta '${call.name}'. Acionando o ToolsAgent.`);
                // A IA quer usar uma ferramenta. Pausamos esta tarefa e pedimos ao Orquestrador para executar a ferramenta.
                eventBus.emit('tool:run', { jobId, toolCall: call, payload });
                // A continuação ocorrerá quando o Orquestrador receber 'tool:completed'
            } else {
                // A IA respondeu diretamente.
                const executiveSummary = JSON.parse(result.response.text());
                await updateJobStatus(jobId, 3, 'completed');
                eventBus.emit('task:completed', { jobId, taskName, resultPayload: { executiveSummary }, payload: payload });
            }

        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na análise da IA: ${error.message}` });
        }
    });

    // O Orquestrador recebe o resultado da ferramenta e devolve ao Agente de Análise para que ele continue seu raciocínio.
    eventBus.on('orchestrator:tool_completed', async ({ jobId, toolResult, originalPayload }) => {
        try {
            console.log(`[Orquestrador] Job ${jobId}: Resultado da ferramenta recebido. Devolvendo ao Agente de Análise.`);
            const chat = model.startChat({
                tools: availableTools,
            });

            // Envia o resultado da ferramenta de volta para a IA
            const result = await chat.sendMessage([{ functionResponse: { name: 'tax_simulation', response: toolResult } }]);

            // Agora a IA deve fornecer a resposta final com base no resultado da ferramenta
            const executiveSummary = JSON.parse(result.response.text());
            await updateJobStatus(jobId, 3, 'completed', 'Análise com simulação concluída.');
            eventBus.emit('task:completed', { jobId, taskName: 'analysis', resultPayload: { executiveSummary }, payload: originalPayload });

        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName: 'analysis', error: `Falha na etapa de síntese pós-ferramenta: ${error.message}` });
        }
    });
}

module.exports = { register };