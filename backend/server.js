// backend/server.js
const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
require('dotenv').config();
const multer = require('multer'); // multer é necessário para o contexto das rotas
const redisClient = require('./services/redisClient');
const weaviate = require('./services/weaviateClient');
const eventBus = require('./services/eventBus');
const registerAgents = require('./agents');
const logger = require('./services/logger').child({ module: 'server' });
const metrics = require('./services/metrics');
const storageService = require('./services/storage');
const pipelineConfig = require('./services/pipelineConfig');
const { availableTools, model, embeddingModel } = require('./services/geminiClient');
const { registerLangChainOrchestrator } = require('./langchain/orchestrator');
const langchainBridge = require('./services/langchainBridge');
const security = require('./config/security');
const { jobTtlSeconds } = require('./config/cache');
const tokenService = require('./services/tokenService');
const { extractToken } = require('./middleware/auth');

storageService.init();

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3001; // Porta padrão 3001
const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

const MAX_FILE_SIZE_MB = parseInt(process.env.UPLOAD_MAX_FILE_SIZE_MB || '50', 10);
const MAX_FILES_PER_JOB = parseInt(process.env.UPLOAD_MAX_FILES || '20', 10);

const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, storageService.getTmpDir());
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedName = file.originalname.replace(/\s+/g, '_');
    cb(null, `${unique}-${sanitizedName}`);
  },
});

const upload = multer({
  storage: multerStorage,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: MAX_FILES_PER_JOB,
  },
});

// --- Configuração de Segurança e Middlewares ---
// Configuração de CORS para ser mais flexível em desenvolvimento (ex: GitHub Codespaces)
const allowedOrigins = [
  'http://localhost:8000', // Frontend local
];

// Adiciona a URL do Codespace dinamicamente, se existir
if (process.env.CODESPACES === 'true') {
    const codespaceName = process.env.CODESPACE_NAME;
    if (codespaceName) {
        allowedOrigins.push(`https://${codespaceName}-8000.app.github.dev`);
    }
}

const corsOptions = {
  origin: allowedOrigins,
  credentials: true, // Permite que o navegador envie cookies e cabeçalhos de autorização
};

app.use(cors(corsOptions)); // Aplica a configuração de CORS

app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    metrics.incrementCounter('http_requests_total');
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        metrics.observeSummary('http_request_duration_ms', durationMs);
        logger.info('http_request_completed', {
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            durationMs: Number(durationMs.toFixed(2)),
        });
    });
    next();
});

app.use(express.json({ limit: '50mb' })); // Aumenta o limite de payload

// --- Inicialização da API Gemini ---
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey && !isTestEnv) {
  logger.fatal("ERRO CRÍTICO: A variável de ambiente GEMINI_API_KEY não está definida.");
  process.exit(1);
}

// --- Armazenamento de Jobs (Em memória para esta fase) ---
const jobConnections = new Map(); // Mapeia jobId -> WebSocket
const jobTimers = new Map();

const PERSISTABLE_RESULT_KEYS = [
    'executiveSummary',
    'simulationResult',
    'validations',
    'langChainAudit',
    'langChainAuditFindings',
    'langChainClassification',
    'processingMetrics',
    'dataQualityReport',
];

function pickPersistableResult(resultPayload) {
    if (!resultPayload || typeof resultPayload !== 'object') return null;
    const picked = {};
    PERSISTABLE_RESULT_KEYS.forEach(key => {
        if (resultPayload[key] !== undefined) {
            picked[key] = resultPayload[key];
        }
    });
    return Object.keys(picked).length > 0 ? picked : null;
}

async function getJob(jobId) {
    if (!jobId) return null;
    const jobString = await redisClient.get(`job:${jobId}`);
    if (!jobString) return null;
    try {
        return JSON.parse(jobString);
    } catch (error) {
        logger.error('[Server] Falha ao converter job em JSON.', { jobId, error });
        return null;
    }
}

async function saveJob(jobId, job) {
    if (!jobId || !job) return;
    await redisClient.set(`job:${jobId}`, JSON.stringify(job), { EX: jobTtlSeconds });
    const ws = jobConnections.get(jobId);
    if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(job));
    }
}

async function mergeJobResult(jobId, resultPatch = {}) {
    if (!resultPatch || Object.keys(resultPatch).length === 0) return;
    const job = await getJob(jobId);
    if (!job) return;
    job.result = { ...(job.result || {}), ...resultPatch };
    await saveJob(jobId, job);
}

async function finalizeJob(jobId, { status = 'completed', error, resultPatch } = {}) {
    const job = await getJob(jobId);
    if (!job) return;
    if (resultPatch) {
        job.result = { ...(job.result || {}), ...resultPatch };
    }
    job.status = status;
    job.error = status === 'failed' ? (error || 'Falha não especificada no pipeline.') : null;
    job.completedAt = new Date().toISOString();
    await saveJob(jobId, job);
}

async function startTask(jobId, taskName, payload = {}) {
    if (!taskName) {
        await finalizeJob(jobId);
        return;
    }
    try {
        await eventBus.emit('task:start', { jobId, taskName, payload });
        const stepIndex = pipelineConfig.getStepIndex(taskName);
        if (stepIndex !== null) {
            await updateJobStatus(jobId, stepIndex, 'in-progress');
        }
    } catch (error) {
        logger.error('[Server] Falha ao iniciar tarefa.', { jobId, taskName, error });
        await finalizeJob(jobId, { status: 'failed', error: error.message });
    }
}

async function processFilesInBackground(jobId, filesMeta = []) {
    const firstTask = pipelineConfig.getFirstTask();
    if (!firstTask) {
        await finalizeJob(jobId, { status: 'failed', error: 'Pipeline não configurado.' });
        return;
    }
    await startTask(jobId, firstTask, { filesMeta });
}

// --- Configuração do WebSocket Server ---
const wss = new WebSocketServer({ server }); // Anexa o WebSocket Server ao servidor HTTP

wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const jobId = url.searchParams.get('jobId');

    if (!jobId) {
        logger.warn('[BFF-WS] Conexão rejeitada: jobId inválido ou não encontrado.');
        ws.close(1008, 'Job ID não fornecido.');
        return;
    }

    if (security.authEnabled) {
        const token = extractToken({ headers: req.headers, query: Object.fromEntries(url.searchParams.entries()) });
        if (!token) {
            ws.close(1008, 'Token de acesso ausente.');
            return;
        }
        try {
            const authContext = tokenService.verifyAccessToken(token);
            const job = await getJob(jobId);
            if (!job) {
                ws.close(1008, 'Job não encontrado.');
                return;
            }
            const jobOrg = job.owner?.orgId;
            if (jobOrg && authContext?.orgId && jobOrg !== authContext.orgId) {
                ws.close(1008, 'Acesso negado para este job.');
                return;
            }
        } catch (error) {
            logger.warn('[BFF-WS] Token inválido na conexão WebSocket.', { error: error.message });
            ws.close(1008, 'Token inválido ou expirado.');
            return;
        }
    }

    logger.info(`[BFF-WS] Cliente conectado para o job: ${jobId}`);
    jobConnections.set(jobId, ws);
    metrics.incrementCounter('ws_connections_total');
    metrics.setGauge('ws_connections_active', jobConnections.size);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    redisClient.get(`job:${jobId}`).then(jobString => {
        if (jobString && ws.readyState === ws.OPEN) {
            ws.send(jobString);
        } else if (!jobString && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ jobId, status: 'not_found', error: `Job com ID ${jobId} não encontrado.` }));
        }
    }).catch(err => {
        logger.error(`[BFF-WS] Erro ao buscar job ${jobId} do Redis para conexão inicial.`, { error: err });
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ error: 'Ocorreu um erro interno ao buscar os dados do job.' }));
        }
    });

    ws.on('close', () => {
        logger.info(`[BFF-WS] Cliente desconectado do job: ${jobId}`);
        jobConnections.delete(jobId);
        metrics.setGauge('ws_connections_active', jobConnections.size);
    });

    ws.on('error', (error) => {
        logger.error(`[BFF-WS] Erro na conexão do job ${jobId}:`, { error });
    });
});

// Intervalo para verificar e fechar conexões inativas
const wsHealthCheckInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            logger.warn('[BFF-WS] Fechando conexão inativa.');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(() => {});
    });
}, 30000); // 30 segundos

eventBus.on('task:completed', async ({ jobId, taskName, resultPayload, payload }) => {
    try {
        const persistable = pickPersistableResult(resultPayload);
        if (persistable) {
            await mergeJobResult(jobId, persistable);
        }
        const nextTask = pipelineConfig.getNextTask(taskName);
        if (nextTask) {
            await startTask(jobId, nextTask, payload || {});
        } else {
            await finalizeJob(jobId);
        }
    } catch (error) {
        logger.error('[Server] Falha ao encadear próxima tarefa.', { jobId, taskName, error });
        await finalizeJob(jobId, { status: 'failed', error: error.message });
    }
});

eventBus.on('task:failed', async ({ jobId, taskName, error }) => {
    const stepIndex = pipelineConfig.getStepIndex(taskName);
    if (stepIndex !== null) {
        await updateJobStatus(jobId, stepIndex, 'failed', error);
    }
    await finalizeJob(jobId, { status: 'failed', error });
});

eventBus.on('tool:run', async ({ jobId, toolCall, payload, prompt }) => {
    try {
        const toolName = toolCall?.name;
        const toolFn = toolName ? availableTools?.[toolName] : null;
        if (!toolFn) {
            throw new Error(`Ferramenta '${toolName || 'desconhecida'}' não está disponível.`);
        }
        const args = toolCall.args || {};
        const toolResult = await toolFn(args);
        eventBus.emit('orchestrator:tool_completed', {
            jobId,
            toolResult,
            originalPayload: payload,
            prompt,
            toolName,
        });
    } catch (err) {
        logger.error('[Server] Execução de ferramenta falhou.', { jobId, error: err });
        eventBus.emit('task:failed', { jobId, taskName: 'analysis', error: err.message });
    }
});

// --- Lógica do Pipeline Orientado a Eventos ---

// --- Funções de Suporte ao Pipeline (usadas pelos agentes) ---

/**
 * Objeto de contexto compartilhado, passado para os agentes durante o registro.
 * Isso evita a necessidade de importar os mesmos módulos em todos os arquivos de agente.
 */
const sharedContext = { // Objeto de dependências injetado nas rotas e agentes
    updateJobStatus,
    finalizeJob,
    mergeJobResult,
    eventBus,
    weaviate,
    redisClient,
    upload, // Instância do multer
    geminiApiKey,
    processFilesInBackground,
    model,
    embeddingModel,
    logger: logger.child({ module: 'sharedContext' }),
    metrics,
    storageService,
    langchainBridge,
};

// --- REGISTRO DE ROTAS E AGENTES ---

const registerRoutes = require('./routes');
registerRoutes(app, sharedContext);

registerAgents(sharedContext); // Registra os listeners dos agentes
registerLangChainOrchestrator(sharedContext);

// Middleware de tratamento de erros globais (upload e demais)
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        logger.warn('[Upload] Erro no envio de arquivos:', { error: err });
        let message = err.message;
        if (err.code === 'LIMIT_FILE_SIZE') {
            message = `O tamanho máximo por arquivo (${MAX_FILE_SIZE_MB} MB) foi excedido.`;
        } else if (err.code === 'LIMIT_FILE_COUNT') {
            message = `Número máximo de arquivos por envio (${MAX_FILES_PER_JOB}) excedido.`;
        }
        return res.status(400).json({ message });
    }
    if (err) {
        logger.error('[Server] Erro não tratado:', { error: err });
        return res.status(500).json({ message: 'Erro interno do servidor.' });
    }
    return next();
});

// --- Funções de Suporte ao Pipeline (usadas pelos agentes e rotas) ---

async function updateJobStatus(jobId, stepIndex, status, info) {
    const job = await getJob(jobId);
    if (!job || !Array.isArray(job.pipeline) || !job.pipeline[stepIndex]) return;

    job.pipeline[stepIndex].status = status;
    if (info) {
        job.pipeline[stepIndex].info = info;
    }

    await saveJob(jobId, job);
}

// --- Lógica de Desligamento Gradual (Graceful Shutdown) ---

function gracefulShutdown(signal) {
    logger.info(`[Server] Sinal de desligamento recebido: ${signal}. Fechando conexões...`);
    
    // 1. Para de aceitar novas conexões HTTP e notifica clientes WebSocket
    server.close(() => {
        clearInterval(wsHealthCheckInterval); // Limpa o intervalo de health check do WS
        logger.info('[Server] Servidor HTTP fechado.');

        // 3. Fecha a conexão com o Redis
        redisClient.quit(() => {
            logger.info('[Redis] Conexão com o Redis fechada.');
            // 4. Fecha outras conexões (ex: Weaviate, se houver método)
            // weaviate.close(); 
            process.exit(0); // Encerra o processo com sucesso
        });
    });

    // 2. Fecha todas as conexões WebSocket ativas
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1012, 'O servidor está sendo reiniciado.'); // 1012 = Service Restart
        }
    });

    // Força o desligamento após um timeout, caso algo trave
    setTimeout(() => {
        logger.error('[Server] Desligamento forçado após timeout. Algumas conexões podem não ter sido fechadas.');
        process.exit(1);
    }, 10000); // 10 segundos
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Captura Ctrl+C

if (!isTestEnv && require.main === module) {
    server.listen(port, () => {
        logger.info(`[Server] Servidor iniciado na porta ${port}.`);
    });
}

module.exports = { app, server, processFilesInBackground };
