// backend/routes/jobs.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const crypto = require('crypto');
const extractor = require('../services/extractor');
const { buildAnalysisContext } = require('../services/artifactUtils');
const { buildJobAnalytics } = require('../services/analyticsService');
const exporterService = require('../services/exporter');
const reconciliationService = require('../services/reconciliation');
const pipelineConfig = require('../services/pipelineConfig');
const telemetryStore = require('../services/telemetryStore');
const { requireAuth, requireScopes, enforceJobOwnership } = require('../middleware/auth');
const { withJobContext } = require('../middleware/jobContext');
const { jobTtlSeconds, chatCacheTtlSeconds } = require('../config/cache');
const router = express.Router();

const MAX_CHAT_ATTACHMENTS = parseInt(process.env.CHAT_MAX_ATTACHMENTS || '5', 10);
const CHAT_ATTACHMENT_SNIPPET_LENGTH = parseInt(process.env.CHAT_ATTACHMENT_SNIPPET_LENGTH || '600', 10);
const CHAT_ATTACHMENT_MAX_ARTIFACTS = parseInt(process.env.CHAT_ATTACHMENT_MAX_ARTIFACTS || '4', 10);
const DEFAULT_ATTACHMENTS_QUESTION = 'Analise detalhadamente os anexos enviados e forneça insights fiscais e recomendações práticas.';

// Middleware de validação com Joi
const validateUpload = (req, res, next) => {
    const schema = Joi.object({
        files: Joi.array().min(1).max(20).required().messages({
            'array.base': 'O campo "files" deve ser um array.',
            'array.min': 'É necessário enviar pelo menos 1 arquivo.',
            'array.max': 'O número máximo de arquivos por job é 20.',
            'any.required': 'Nenhum arquivo foi enviado.',
        })
    });

    const { error } = schema.validate({ files: req.files });
    if (error) return res.status(400).json({ message: error.details[0].message });
    next();
};

const formatBytes = (size = 0) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const buildChatCacheKey = (jobId, question) => {
    const hash = crypto.createHash('sha256').update(`${jobId}:${question}`).digest('hex');
    return `job:${jobId}:chat:${hash}`;
};

function addSection(lines, title, content) {
    if (content && String(content).trim()) {
        lines.push(`${title}\n${content}`);
    }
}
function buildJobStructuredContext(job = {}) {
    const payload = job.result || {};
    const lines = [];

    if (payload.executiveSummary) {
        const { title, description, keyMetrics, actionableInsights } = payload.executiveSummary;
        if (title) lines.push(`Título do relatório: ${title}`);
        if (description) lines.push(`Resumo executivo: ${description}`);

        if (keyMetrics) {
            const metricsLines = Object.entries(keyMetrics)
                .map(([key, value]) => `${key}: ${typeof value === 'number' ? value.toLocaleString('pt-BR') : value}`)
                .join('\n');
            addSection(lines, 'Métricas principais:', metricsLines);
        }
        if (Array.isArray(actionableInsights) && actionableInsights.length > 0) {
            const insights = actionableInsights
                .map((item, index) => `${index + 1}. ${item?.text || item}`)
                .join('\n');
            addSection(lines, 'Recomendações prioritárias:', insights);
        }
    }

    addSection(lines, 'Resumo da simulação tributária:', payload.simulationResult?.resumoExecutivo);

    if (Array.isArray(payload.validations) && payload.validations.length > 0) {
        const okItems = payload.validations.filter(item => !item?.error).slice(0, 3).map(item => `${item.nome_fantasia || item.razao_social || 'Empresa'} (${item.cnpj})`).join('; ');
        const erroItems = payload.validations.filter(item => item?.error).slice(0, 3).map(item => `${item.cnpj}: ${item.message || 'erro na validação'}`).join('; ');
        addSection(lines, 'CNPJs validados:', okItems);
        addSection(lines, 'Alertas de validação:', erroItems);
    }

    if (payload.fiscalChecks?.summary) {
        const { flaggedDocuments, icmsInconsistent, missingCfop, missingCst } = payload.fiscalChecks.summary;
        const fiscalLines = [];
        if (flaggedDocuments > 0) fiscalLines.push(`${flaggedDocuments} documento(s) com anotações fiscais.`);
        if (icmsInconsistent > 0) fiscalLines.push(`${icmsInconsistent} divergência(s) de ICMS.`);
        if (missingCfop > 0 || missingCst > 0) fiscalLines.push(`Campos ausentes: CFOP=${missingCfop}, CST=${missingCst}.`);
        addSection(lines, 'Resumo de validação fiscal:', fiscalLines.join(' '));
    }

    if (payload.auditFindings?.summary) {
        const { riskLevel, riskScore, totalFindings, highValueDocuments } = payload.auditFindings.summary;
        const summaryLine = `Total de ${totalFindings} alerta(s), risco ${riskLevel} (score ${riskScore}).`;
        const highValueLine = (typeof highValueDocuments === 'number' && highValueDocuments > 0) ? `Documentos de alto valor revisados: ${highValueDocuments}.` : '';
        addSection(lines, 'Resumo da auditoria:', [summaryLine, highValueLine].filter(Boolean).join(' '));

        if (Array.isArray(payload.auditFindings.alerts) && payload.auditFindings.alerts.length > 0) {
            const topAlerts = payload.auditFindings.alerts.slice(0, 3).map((alert, index) => `${index + 1}. ${alert}`).join('\n');
            addSection(lines, 'Principais alertas:', topAlerts);
        }
    }

    if (payload.classifications?.summary) {
        const { porRisco, documentsWithPendingIssues } = payload.classifications.summary;
        const classificationSummary = `Risco alto em ${porRisco?.Alto || 0} documento(s), pendências em ${documentsWithPendingIssues}.`;
        addSection(lines, 'Classificação fiscal:', classificationSummary);

        const recs = payload.classifications.summary.recommendations || [];
        if (recs.length > 0) {
            const topRecs = recs.slice(0, 3).map((r, idx) => `${idx + 1}. ${r}`).join('\n');
            addSection(lines, 'Recomendações da classificação:', topRecs);
        }
    }

    if (Array.isArray(job.uploadedFiles) && job.uploadedFiles.length > 0) {
        const fileLines = job.uploadedFiles
            .slice(0, 5)
            .map(file => `- ${file.name || file.originalName} (${formatBytes(file.size)})`);
        addSection(lines, 'Arquivos processados:', fileLines.join('\n'));
    }

    return lines.join('\n\n');
}

async function extractArtifactsFromMetas(fileMetas = [], storageService) {
    const extractions = await Promise.all(
        fileMetas.map(meta => extractor.extractArtifactsForFileMeta(meta, storageService))
    );
    return extractions.flat();
}

function buildAttachmentContextFromArtifacts(artifacts = []) {
    if (!artifacts.length) return '';
    const { context } = buildAnalysisContext(artifacts, {
        maxArtifacts: CHAT_ATTACHMENT_MAX_ARTIFACTS,
        snippetLength: CHAT_ATTACHMENT_SNIPPET_LENGTH,
    });
    return context;
}

function createChunksFromArtifacts(artifacts, jobId) {
    const chunks = artifacts.flatMap(artifact => {
        const baseChunks = Array.isArray(artifact.chunks) && artifact.chunks.length > 0
            ? artifact.chunks
            : (artifact.text || '').match(/.{1,2000}/gs) || [];

        return baseChunks
            .filter(chunkContent => typeof chunkContent === 'string' && chunkContent.trim().length > 10) // Ignore very small chunks
            .map((chunkContent, index) => ({
                jobId,
                fileName: artifact.fileName,
                content: chunkContent,
                sourceHash: artifact.hash,
                chunkIndex: index,
                summary: artifact.summary || '',
            }));
    });
    return chunks;
}

async function getEmbeddingsForChunks(chunks, embeddingModel) {
    if (!chunks.length || !embeddingModel?.batchEmbedContents) return [];

    try {
        const { embeddings } = await embeddingModel.batchEmbedContents({
            requests: chunks.map(chunk => ({ model: "models/text-embedding-004", content: chunk.content })),
        });
        return embeddings || [];
    } catch (error) {
        logger?.warn?.(`[WeaviateIndexer] Falha ao gerar embeddings em lote.`, { error: error.message });
        return [];
    }
}

async function indexArtifactsInWeaviate(jobId, artifacts = [], weaviate, embeddingModel) {
    if (!artifacts.length || !weaviate?.client?.batch?.objectsBatcher) return;

    const chunks = createChunksFromArtifacts(artifacts, jobId);
    if (chunks.length === 0) return;

    const vectors = await getEmbeddingsForChunks(chunks, embeddingModel);
    const objects = chunks
        .map((chunk, index) => ({
            className: weaviate.className,
            properties: chunk,
            vector: vectors[index]?.values,
        }))
        .filter(obj => Array.isArray(obj.vector) && obj.vector.length > 0);

    if (objects.length > 0) {
        await weaviate.client.batch.objectsBatcher().withObjects(...objects).do();
    }
}

module.exports = (context) => {
    const {
        upload,
        redisClient,
        processFilesInBackground,
        embeddingModel,
        model,
        availableTools,
        weaviate,
        storageService,
        logger,
    } = context;

    const loadJobContext = withJobContext(redisClient);

    router.use(requireAuth);

    // --- Endpoints de Processamento Assíncrono ---

    router.post('/', requireScopes(['jobs:create']), upload.array('files'), validateUpload, async (req, res) => {
        const jobId = uuidv4();
        console.log(`[BFF] Novo job criado com ID: ${jobId}`);

        let storedFiles;
        try {
            storedFiles = await storageService.persistUploadedFiles(req.files || []);
        } catch (error) {
            console.error('[Upload] Falha ao persistir arquivos enviados:', error);
            return res.status(500).json({ message: 'Não foi possível armazenar os arquivos enviados.' });
        }

        if (storedFiles.length === 0) {
            return res.status(400).json({ message: 'Nenhum arquivo válido foi armazenado.' });
        }

        // Inicializa o status do job
        const pipelineState = pipelineConfig.buildInitialPipelineState().map(step => ({ ...step }));
        if (pipelineState[0]) {
            pipelineState[0].info = `Processando ${storedFiles.length} arquivo(s)...`;
        }

        const ingestionTimestamp = new Date().toISOString();
        const owner = {
            sub: req.auth?.sub || 'anonymous',
            orgId: req.auth?.orgId || req.auth?.tenantId || 'default',
            scopes: Array.isArray(req.auth?.scopes) ? req.auth.scopes : [],
        };
        const newJob = {
            status: 'processing',
            pipeline: pipelineState,
            result: null,
            error: null,
            createdAt: ingestionTimestamp,
            owner,
            uploadedFiles: storedFiles.map(file => ({
                name: file.originalName,
                hash: file.hash,
                size: file.size,
                mimeType: file.mimeType,
                ingestedAt: ingestionTimestamp,
            })),
        };

        // Armazena o novo job no Redis
        await redisClient.set(`job:${jobId}`, JSON.stringify(newJob), { EX: jobTtlSeconds });
        const totalSizeBytes = storedFiles.reduce((sum, file) => sum + (file.size || 0), 0);
        telemetryStore.recordJobStatus(jobId, 'queued', {
            fileCount: storedFiles.length,
            totalSizeBytes,
        });

        // Retorna o ID do job imediatamente
        res.status(202).json({ jobId });

        // Inicia o processamento em segundo plano (sem usar await aqui)
        processFilesInBackground(jobId, storedFiles);
    });

    router.get(
        '/:jobId/status',
        requireScopes(['jobs:read']),
        loadJobContext,
        enforceJobOwnership,
        (req, res) => {
            res.status(200).json(req.jobRecord);
        }
    );

    router.get(
        '/:jobId/analytics',
        requireScopes(['jobs:read']),
        loadJobContext,
        enforceJobOwnership,
        (req, res) => {
            const job = req.jobRecord;
            if (!job.result) {
                return res.status(202).json({ status: job.status || 'processing' });
            }
            const analytics = buildJobAnalytics(job);
            return res.status(200).json(analytics);
        }
    );

    // --- Endpoint de Chat (RAG) ---
    router.post(
        '/:jobId/chat',
        requireScopes(['jobs:read', 'chat:invoke']),
        loadJobContext,
        enforceJobOwnership,
        upload.array('attachments', MAX_CHAT_ATTACHMENTS),
        async (req, res) => {
            const { jobId } = req.params;
            const attachments = Array.isArray(req.files) ? req.files : [];
            const rawQuestion = typeof req.body?.question === 'string' ? req.body.question : '';
            const question = rawQuestion.trim() || (attachments.length > 0 ? DEFAULT_ATTACHMENTS_QUESTION : '');
            const useCache = attachments.length === 0 && !!question;

            if (!question) {
                return res.status(400).json({ message: 'É necessário informar uma pergunta ou anexar arquivos.' });
            }

            let cacheKey;
            if (useCache) {
                cacheKey = buildChatCacheKey(jobId, question);
                const cachedAnswer = await redisClient.get(cacheKey);
                if (cachedAnswer) {
                    return res.status(200).json({ answer: cachedAnswer });
                }
            }

            try {
                const job = req.jobRecord;
                let attachmentArtifacts = [];
                if (attachments.length > 0) {
                    let storedAttachments;
                    try {
                        storedAttachments = await storageService.persistUploadedFiles(attachments);
                    } catch (error) {
                        logger?.error?.(`[Chat-RAG] Job ${jobId}: falha ao armazenar anexos.`, { error });
                        return res.status(500).json({ message: 'Não foi possível armazenar os anexos enviados.' });
                    }

                    const seenHashes = new Set();
                    const uniqueAttachments = storedAttachments.filter(meta => {
                        if (seenHashes.has(meta.hash)) {
                            return false;
                        }
                        seenHashes.add(meta.hash);
                        return true;
                    });

                    const duplicatesCount = storedAttachments.length - uniqueAttachments.length;
                    if (duplicatesCount > 0) {
                        logger?.info?.(`[Chat-RAG] Job ${jobId}: ${duplicatesCount} anexo(s) duplicado(s) ignorado(s) com base no hash do conteúdo.`);
                    }
                    if (uniqueAttachments.length === 0) {
                        logger?.warn?.(`[Chat-RAG] Job ${jobId}: Nenhum anexo único foi processado após a deduplicação.`);
                    }

                    try {
                        attachmentArtifacts = await extractArtifactsFromMetas(uniqueAttachments, storageService);
                        await indexArtifactsInWeaviate(jobId, attachmentArtifacts, weaviate, embeddingModel).catch((error) => {
                            logger?.warn?.(`[Chat-RAG] Job ${jobId}: falha ao indexar anexos.`, { error });
                        });
                    } catch (error) {
                        logger?.error?.(`[Chat-RAG] Job ${jobId}: falha ao processar anexos.`, { error });
                        return res.status(500).json({ message: 'Não foi possível processar os anexos enviados.' });
                    }
                }

                const contextBlocks = [];
                try {
                    const embeddingResult = await embeddingModel.embedContent(question);
                    const vector = embeddingResult?.embedding?.values || [];

                    if (Array.isArray(vector) && vector.length > 0) {
                        const searchResult = await weaviate.client.graphql
                            .get()
                            .withClassName(weaviate.className)
                            .withFields('content fileName')
                            .withWhere({ path: ['jobId'], operator: 'Equal', valueText: jobId })
                            .withNearVector({ vector })
                            .withLimit(5)
                            .do();

                        const contextChunks = searchResult?.data?.Get?.[weaviate.className] || [];
                        if (contextChunks.length > 0) {
                            const ragContext = contextChunks
                                .map(chunk => `Trecho do arquivo ${chunk.fileName || 'desconhecido'}:\\n${chunk.content}`)
                                .join('\\n\\n');
                            contextBlocks.push(`### Contexto indexado\\n${ragContext}`);
                        }
                    }
                } catch (error) {
                    logger?.warn?.(`[Chat-RAG] Job ${jobId}: falha ao consultar o índice cognitivo.`, { error });
                }

                const structuredContext = buildJobStructuredContext(job);
                if (structuredContext) {
                    contextBlocks.push(`### Contexto fiscal estruturado\\n${structuredContext}`);
                }

                const attachmentContext = buildAttachmentContextFromArtifacts(attachmentArtifacts);
                if (attachmentContext) {
                    contextBlocks.push(`### Conteúdo dos anexos recentes\\n${attachmentContext}`);
                }

                const knowledgeSource = contextBlocks.length > 0
                    ? contextBlocks.join('\\n\\n---\\n\\n')
                    : 'Nenhum contexto adicional foi recuperado. Responda apenas com base em seu conhecimento geral, informando claramente essa limitação.';

                const prompt = `
Você é um especialista fiscal que atua como copiloto dos agentes internos. Use somente as informações recuperadas, mantendo confidencialidade e clareza.

FONTE DE CONHECIMENTO:
${knowledgeSource}

PERGUNTA DO USUÁRIO:
${question}

Responda em português, com precisão factual. Se precisar usar ferramentas (ex.: tax_simulation), solicite-as. Se os dados forem insuficientes, explique o que falta e sugira próximos passos.`.trim();

                const chat = model.startChat({
                    tools: availableTools,
                });

                const result = await chat.sendMessage(prompt);
                const call = result.response.functionCalls()?.[0];

                let answer;
                if (call) {
                    logger?.info?.(`[Chat-RAG] Job ${jobId}: IA solicitou a ferramenta '${call.name}'.`);
                    const toolFn = availableTools[call.name];
                    if (!toolFn) {
                        throw new Error(`Ferramenta desconhecida solicitada pela IA: ${call.name}`);
                    }
                    const toolResult = await toolFn(call.args);
                    const finalResult = await chat.sendMessage([{ functionResponse: { name: call.name, response: { content: JSON.stringify(toolResult) } } }]);
                    answer = finalResult.response.text();
                } else {
                    answer = result.response.text();
                }

                if (useCache && cacheKey && answer) {
                    await redisClient.set(cacheKey, answer, { EX: chatCacheTtlSeconds }).catch(() => {});
                }

                res.status(200).json({ answer });
            } catch (error) {
                logger?.error?.(`[Chat-RAG] Erro no job ${jobId}:`, { error });
                const isNetworkError = error.message.includes('fetch') || error.message.includes('ECONNREFUSED');
                const userMessage = isNetworkError
                    ? 'A comunicação com um serviço externo falhou. Por favor, tente novamente mais tarde.'
                    : 'Ocorreu uma falha interna ao processar a sua pergunta.';
                res.status(500).json({ message: userMessage, code: isNetworkError ? 'EXTERNAL_SERVICE_FAILURE' : 'INTERNAL_ERROR' });
            }
        }
    );

// --- Endpoint de Exportação Fiscal / Integrações ERP ---
    router.post(
        '/:jobId/exports',
        requireScopes(['jobs:read']),
        loadJobContext,
        enforceJobOwnership,
        async (req, res) => {
            const { jobId } = req.params;
            const format = String(req.body?.format || 'csv').toLowerCase();
            const allowedFormats = ['sped', 'efd', 'csv', 'ledger'];

            if (!allowedFormats.includes(format)) {
                return res.status(400).json({ message: 'Formato de exportação inválido.' });
            }

            try {
                const job = req.jobRecord;
                const filesMeta = job.uploadedFiles || [];
                if (!filesMeta.length) {
                    return res.status(400).json({ message: 'Nenhum arquivo disponível para exportação.' });
                }

                const { documentos, log } = await exporterService.extractDocumentsFromStorage(filesMeta, storageService);
                if (!documentos.length) {
                    return res.status(400).json({ message: 'Nenhum documento válido foi identificado para exportação.' });
                }

                let content;
                let fileName;
                switch (format) {
                    case 'sped':
                        content = exporterService.gerarSpedFiscal(documentos);
                        fileName = 'SPED_FISCAL.txt';
                        break;
                    case 'efd':
                        content = exporterService.gerarEfdContribuicoes(documentos);
                        fileName = 'EFD_CONTRIBUICOES.txt';
                        break;
                    case 'ledger':
                        content = exporterService.gerarCsvLancamentos(documentos);
                        fileName = 'LANCAMENTOS_CONTABEIS.csv';
                        break;
                    default:
                        content = exporterService.gerarCsvERP(documentos);
                        fileName = 'ERP_IMPORT.csv';
                        break;
                }

                res.status(200).json({
                    fileName,
                    encoding: 'base64',
                    content: Buffer.from(content, 'utf8').toString('base64'),
                    log,
                    documents: documentos.map(exporterService.summarizeDoc),
                });
            } catch (error) {
                logger?.error?.(`[Exports] Job ${jobId}: falha ao gerar exportação.`, { error });
                res.status(500).json({ message: 'Falha interna ao gerar a exportação solicitada.' });
            }
        }
    );

    // --- Endpoint de Conciliação Bancária ---
    router.post(
        '/:jobId/reconciliation',
        requireScopes(['jobs:read']),
        loadJobContext,
        enforceJobOwnership,
        upload.array('statements', 5),
        async (req, res) => {
            const { jobId } = req.params;
            const statementsFiles = req.files || [];

            if (statementsFiles.length === 0) {
                return res.status(400).json({ message: 'Envie pelo menos um arquivo OFX ou CSV.' });
            }

            try {
                const job = req.jobRecord;
                const filesMeta = job.uploadedFiles || [];
                if (!filesMeta.length) {
                    return res.status(400).json({ message: 'Nenhum documento fiscal disponível para conciliação.' });
                }

                const { documentos } = await exporterService.extractDocumentsFromStorage(filesMeta, storageService);
                if (!documentos.length) {
                    return res.status(400).json({ message: 'Não foi possível recuperar os documentos fiscais para conciliação.' });
                }

                const transactions = await reconciliationService.parseStatements(statementsFiles);
                if (!transactions.length) {
                    return res.status(400).json({ message: 'Os arquivos enviados não contêm transações válidas.' });
                }

                const result = reconciliationService.reconcile(documentos, transactions);
                res.status(200).json(result);
            } catch (error) {
                logger?.error?.(`[Reconciliation] Job ${jobId}: falha ao conciliar extratos.`, { error });
                res.status(500).json({ message: 'Falha interna ao executar a conciliação bancária.' });
            }
        }
    );

    return router;
};
