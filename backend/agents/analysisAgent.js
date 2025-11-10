// backend/agents/analysisAgent.js

const { buildAnalysisContext } = require('../services/artifactUtils');

const TASK_NAME = 'analysis';

function register({ eventBus, updateJobStatus, metrics, getJob, getJobContext, langchainBridge, langchainClient }) {
    // Agente de Análise (IA)
    eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
        if (taskName !== TASK_NAME) return;
        try {
            metrics?.incrementCounter?.('agent_analysis_started_total');
            const persistedContext = getJobContext ? await getJobContext(jobId) : null;
            const mergedPayload = {
                ...(persistedContext?.lastPayload || {}),
                ...(payload || {}),
            };
            const jobState = getJob ? await getJob(jobId) : null;
            const contextHash = jobState?.metadata?.contextHash;
            const cachedSummary = langchainBridge?.getCachedResponse?.(jobId, TASK_NAME, contextHash || '');
            if (cachedSummary?.payload) {
                await updateJobStatus(jobId, 4, 'completed', 'Resumo recuperado do cache semântico.');
                eventBus.emit('task:completed', {
                    jobId,
                    taskName,
                    resultPayload: { executiveSummary: cachedSummary.payload },
                    payload: mergedPayload,
                });
                return;
            }

            const artifacts = mergedPayload.artifacts || [];
            const fileContentsForAnalysis = mergedPayload.fileContentsForAnalysis || artifacts.map(art => ({ fileName: art.fileName, content: art.text }));
            await updateJobStatus(jobId, 4, 'in-progress', 'Ag. Inteligência: Gerando análise executiva...');
            const { context, stats } = buildAnalysisContext(artifacts);

            const pipelineOverview = Array.isArray(jobState?.pipeline)
                ? jobState.pipeline.map(step => `${step.name}: ${step.status}`).join(' | ')
                : 'Indefinido';

            const digest = jobState?.contextDigest
                ? `Último payload (${jobState.contextDigest.summary?.keys?.join(', ') || 'n/d'}) atualizado em ${jobState.contextDigest.updatedAt || 'n/d'}`
                : 'Digest não disponível.';

            const conversationTranscript = langchainBridge?.buildTranscript?.(jobId);

            langchainBridge?.appendMemory?.(jobId, 'system', 'Pipeline encaminhou análise executiva com novo contexto via LangChain.', { task: TASK_NAME });

            const langchainResponse = await langchainClient.runAnalysis({
                jobId,
                stats,
                context: context || fileContentsForAnalysis.map(f => `### Documento: ${f.fileName}\n${(f.content || '').slice(0, 1200)}`).join('\n\n'),
                pipelineOverview,
                digest,
                conversationTranscript,
                contextHash,
            });

            const { executiveSummary, toolRequest } = langchainResponse || {};

            if (toolRequest?.name) {
                langchainBridge?.appendMemory?.(jobId, 'assistant', `LangChain requisitou a ferramenta ${toolRequest.name}.`, { type: 'tool_request' });
                eventBus.emit('tool:run', {
                    jobId,
                    toolCall: { name: toolRequest.name, args: toolRequest.args || {} },
                    payload: mergedPayload,
                    prompt: JSON.stringify({ stats, digest, context }),
                });
            } else if (executiveSummary) {
                await updateJobStatus(jobId, 4, 'completed');
                metrics?.incrementCounter?.('agent_analysis_completed_total');
                if (contextHash) {
                    langchainBridge?.cacheSemanticResponse?.(jobId, TASK_NAME, contextHash, executiveSummary);
                }
                langchainBridge?.appendMemory?.(jobId, 'assistant', `Resumo elaborado via LangChain: ${executiveSummary.title || 'Sem título'}`, { task: TASK_NAME });
                eventBus.emit('task:completed', { jobId, taskName, resultPayload: { executiveSummary }, payload: mergedPayload });
            } else {
                throw new Error('LangChain retornou uma resposta vazia para a análise.');
            }

        } catch (error) {
            metrics?.incrementCounter?.('agent_analysis_failed_total');
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na análise da IA: ${error.message}` });
        }
    });

    // O Orquestrador recebe o resultado da ferramenta e devolve ao Agente de Análise para que ele continue seu raciocínio.
    eventBus.on('orchestrator:tool_completed', async ({ jobId, toolResult, originalPayload, prompt, toolName }) => {
        try {
            console.log(`[Orquestrador] Job ${jobId}: Resultado da ferramenta recebido. Devolvendo ao Agente de Análise.`);
            const jobState = getJob ? await getJob(jobId) : null;
            const contextHash = jobState?.metadata?.contextHash;
            const langchainResponse = await langchainClient.runAnalysis({
                jobId,
                stats: {},
                context: prompt || '',
                pipelineOverview: 'Follow-up após execução de ferramenta.',
                digest: `Ferramenta ${toolName}`,
                conversationTranscript: langchainBridge?.buildTranscript?.(jobId),
                contextHash,
                toolResult: {
                    toolName,
                    output: toolResult,
                },
            });

            const executiveSummary = langchainResponse?.executiveSummary;
            if (!executiveSummary) {
                throw new Error('LangChain não retornou resumo após a ferramenta.');
            }

            await updateJobStatus(jobId, 4, 'completed', 'Análise com simulação concluída.');
            metrics?.incrementCounter?.('agent_analysis_completed_total');
            if (contextHash) {
                langchainBridge?.cacheSemanticResponse?.(jobId, TASK_NAME, contextHash, executiveSummary);
            }
            langchainBridge?.appendMemory?.(jobId, 'assistant', `Resumo final após ${toolName}: ${executiveSummary.title || 'Sem título'}`, { task: TASK_NAME, tool: toolName });
            eventBus.emit('task:completed', { jobId, taskName: TASK_NAME, resultPayload: { executiveSummary }, payload: originalPayload });

        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName: 'analysis', error: `Falha na etapa de síntese pós-ferramenta: ${error.message}` });
        }
    });
}

module.exports = { register };
