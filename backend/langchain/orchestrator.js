const { createReviewChain, createAuditChain, createClassificationChain } = require('./chains');
const logger = require('../services/logger').child({ module: 'langchain/orchestrator' });

const CHAIN_TASKS = {
    analysis: {
        factory: createReviewChain,
        resultKey: 'langChainAudit',
        outputKey: 'langChainAudit',
    },
    audit: {
        factory: createAuditChain,
        resultKey: 'langChainAuditFindings',
        outputKey: 'langChainAuditFindings',
    },
    classification: {
        factory: createClassificationChain,
        resultKey: 'langChainClassification',
        outputKey: 'langChainClassification',
    },
};

function addSection(lines, title, content) {
    if (content && typeof content === 'string' && content.trim().length > 0) {
        lines.push(`${title}\n${content.trim()}`);
    }
}

async function executeLangChainChain(entry, userContext, jobId, metrics) {
    const start = process.hrtime.bigint();
    const taskName = entry.taskName;
    logger.info('[LangChain] Chain iniciado.', { jobId, taskName });
    metrics?.incrementCounter('langchain_chain_runs_total');
    try {
        const result = await entry.chain.call(userContext);
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        logger.info('[LangChain] Chain concluído.', { jobId, taskName, durationMs });
        metrics?.incrementCounter('langchain_chain_success_total');
        metrics?.observeSummary('langchain_chain_duration_ms', durationMs);
        return result;
    } catch (error) {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        logger.error('[LangChain] Chain falhou.', {
            jobId,
            taskName,
            durationMs,
            error: error?.message || 'sem mensagem',
        });
        metrics?.incrementCounter('langchain_chain_failure_total');
        metrics?.observeSummary('langchain_chain_duration_ms', durationMs);
        throw error;
    }
}

function buildAnalysisContext(payload = {}) {
    const lines = [];
    addSection(lines, 'Resumo executivo', payload.executiveSummary?.description);
    if (payload.executiveSummary?.keyMetrics) {
        const metrics = Object.entries(payload.executiveSummary.keyMetrics)
            .map(([key, value]) => `${key}: ${value}`)
            .join('; ');
        addSection(lines, 'Métricas principais', metrics);
    }
    if (Array.isArray(payload.executiveSummary?.actionableInsights)) {
        const insights = payload.executiveSummary.actionableInsights
            .map((item, index) => `${index + 1}. ${item?.text || item}`)
            .join('\n');
        addSection(lines, 'Insights', insights);
    }
    addSection(lines, 'Validações relevantes', payload.validations?.slice(0, 5).map(item => `${item.cnpj || item.razao_social}: ${item.message || item.status || 'sem mensagem'}`).join('\n'));
    addSection(lines, 'Resumo da simulação', payload.simulationResult?.resumoExecutivo);
    return lines.length ? lines.join('\n\n') : 'Nenhum contexto estruturado disponível para análise.';
}

function buildAuditContext(payload = {}) {
    const lines = [];
    const summary = payload.auditFindings?.summary;
    if (summary) {
        addSection(
            lines,
            'Resumo da auditoria',
            `Alertas: ${summary.totalFindings || 0}, risco ${summary.riskLevel || 'não identificado'}, score ${summary.riskScore || 'n/a'}.`,
        );
    }
    if (Array.isArray(payload.auditFindings?.alerts)) {
        addSection(lines, 'Principais alertas', payload.auditFindings.alerts.slice(0, 4).join('\n'));
    }
    addSection(lines, 'Documentos críticos sinalizados', (payload.auditFindings?.highValueDocuments || 0).toString());
    return lines.length ? lines.join('\n\n') : 'Nenhuma informação de auditoria registrada até o momento.';
}

function buildClassificationContext(payload = {}) {
    const lines = [];
    const summary = payload.classifications?.summary || {};
    addSection(lines, 'Resumo de classificação', `Risco Alto: ${summary.porRisco?.Alto || 0}, Pendências: ${summary.documentsWithPendingIssues || 0}`);
    if (Array.isArray(summary.recommendations)) {
        addSection(lines, 'Recomendações', summary.recommendations.slice(0, 4).join('\n'));
    }
    addSection(lines, 'Documentos em aberto', Array.isArray(payload.classifications?.documentsInReview) ? payload.classifications.documentsInReview.join('; ') : '');
    return lines.length ? lines.join('\n\n') : 'Nenhuma classificação adicional disponível.';
}

const CONTEXT_BUILDERS = {
    analysis: buildAnalysisContext,
    audit: buildAuditContext,
    classification: buildClassificationContext,
};

function formatRagChunks(chunks = []) {
    if (!chunks.length) return '';
    return chunks
        .map(chunk => {
            const heading = chunk.fileName ? `Arquivo: ${chunk.fileName}` : 'Chunk sem nome';
            const snippet = (chunk.content || '').trim().slice(0, 900);
            return `${heading}\n${snippet}`;
        })
        .join('\n\n---\n\n');
}

async function buildRagContext(weaviate, jobId, maxChunks = 4) {
    if (!weaviate?.client || !jobId) return '';
    try {
        const response = await weaviate.client.graphql
            .get()
            .withClassName(weaviate.className)
            .withFields('fileName content chunkIndex sourceHash summary')
            .withWhere({ path: ['jobId'], operator: 'Equal', valueText: jobId })
            .withLimit(maxChunks)
            .do();
        const chunks = response?.data?.Get?.[weaviate.className] || [];
        return formatRagChunks(chunks);
    } catch (error) {
        logger.warn('[LangChain] Falha ao recuperar contexto cognitivo do Weaviate.', { jobId, error: error?.message || error });
        return '';
    }
}

function registerLangChainOrchestrator(context) {
    const chains = Object.fromEntries(
        Object.entries(CHAIN_TASKS).map(([taskName, config]) => [
            taskName,
            {
                taskName,
                ...config,
                chain: config.factory(context),
            },
        ]),
    );

    context.eventBus.on('task:completed', async ({ jobId, taskName, resultPayload }) => {
        const entry = chains[taskName];
        if (!entry) return;

        const builder = CONTEXT_BUILDERS[taskName];
        if (!builder) return;

        const taskContext = builder(resultPayload);
        const ragContext = await buildRagContext(context.weaviate, jobId);
        const userContext = {
            jobId,
            taskContext,
            ragContext: ragContext || 'Sem contexto adicional indexado.',
        };

        try {
            const reviewResult = await executeLangChainChain(entry, userContext, jobId, context.metrics);
            const output = reviewResult?.[entry.outputKey] ?? reviewResult;
            if (!output) {
                logger.warn('[LangChain] Chain retornou sem payload válido.', { jobId, taskName });
                return;
            }
            await context.mergeJobResult(jobId, { [entry.resultKey]: output });
            logger.info('[LangChain] Atualização cognitiva armazenada.', { jobId, taskName, resultKey: entry.resultKey });
        } catch (error) {
            logger.error('[LangChain] Falha ao executar o chain.', { jobId, taskName, error: error?.message || error });
        }
    });
}

module.exports = {
    registerLangChainOrchestrator,
};
