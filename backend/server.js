// backend/server.js
const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
require('dotenv').config();
const yaml = require('js-yaml');
const multer = require('multer'); // multer é necessário para o contexto das rotas
const redisClient = require('./services/redisClient');
const weaviate = require('./services/weaviateClient');
const eventBus = require('./services/eventBus');
const registerAgents = require('./agents');
const logger = require('./services/logger').child({ module: 'server' });
const metrics = require('./services/metrics');
const storageService = require('./services/storage');

const path = require('path');
const fs = require('fs');

storageService.init();

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3001; // Porta padrão 3001

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
if (!geminiApiKey) {
  logger.fatal("ERRO CRÍTICO: A variável de ambiente GEMINI_API_KEY não está definida.");
  process.exit(1);
}

// --- Armazenamento de Jobs (Em memória para esta fase) ---
const jobConnections = new Map(); // Mapeia jobId -> WebSocket
const jobTimers = new Map();

// --- Configuração do WebSocket Server ---
const wss = new WebSocketServer({ server }); // Anexa o WebSocket Server ao servidor HTTP

wss.on('connection', (ws, req) => {
  // O frontend deve se conectar com a URL contendo o jobId, ex: ws://localhost:3001?jobId=...
  const url = new URL(req.url, `http://${req.headers.host}`);
  const jobId = url.searchParams.get('jobId');

  if (jobId) {
    logger.info(`[BFF-WS] Cliente conectado para o job: ${jobId}`);
    jobConnections.set(jobId, ws);
    metrics.incrementCounter('ws_connections_total');
    metrics.setGauge('ws_connections_active', jobConnections.size);

    // Busca o estado atual do job no Redis e envia ao cliente
    redisClient.get(`job:${jobId}`).then(jobString => { // Busca o estado inicial do job
        if (jobString && ws.readyState === ws.OPEN) {
            ws.send(jobString);
        }
    }).catch(err => {
        logger.error(`[BFF-WS] Erro ao buscar job ${jobId} do Redis:`, { error: err });
    });

    ws.on('close', () => {
      logger.info(`[BFF-WS] Cliente desconectado do job: ${jobId}`);
      jobConnections.delete(jobId);
      metrics.setGauge('ws_connections_active', jobConnections.size);
    });
  } else {
    logger.warn(`[BFF-WS] Conexão rejeitada: jobId inválido ou não encontrado.`);
    ws.close();
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
    eventBus,
    weaviate,
    redisClient,
    upload, // Instância do multer
    geminiApiKey,
    processFilesInBackground,
    logger: logger.child({ module: 'sharedContext' }),
    metrics,
    storageService,
};

// --- REGISTRO DE ROTAS E AGENTES ---

const registerRoutes = require('./routes');
registerRoutes(app, sharedContext);

registerAgents(sharedContext); // Registra os listeners dos agentes

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
    const jobString = await redisClient.get(`job:${jobId}`);
    if (!jobString) return;

    const job = JSON.parse(jobString);

    job.pipeline[stepIndex].status = status;
    if (info) job.pipeline[stepIndex].info = info;

    // Marca passos anteriores como concluídos
    for (let i = 0; i < stepIndex; i++) {
        if (job.pipeline[i].status !== 'failed') {
            job.pipeline[i].status = 'completed'; // Garante que a UI mostre o progresso linear
        }
    }

    // Salva o estado atualizado de volta no Redis
    await redisClient.set(`job:${jobId}`, JSON.stringify(job));

    // Envia a atualização via WebSocket
    const ws = jobConnections.get(jobId); // Encontra a conexão WebSocket do job
    if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(job));
    }
}

async function finalizeJob(jobId, status, resultOrError) {
    const jobString = await redisClient.get(`job:${jobId}`);
    if (!jobString) return;

    const job = JSON.parse(jobString);

    job.status = status;
    if (status === 'completed') {
        job.result = resultOrError;
    } else {
        job.error = resultOrError;
        const failedStepIndex = job.pipeline.findIndex(s => s.status === 'in-progress');
        if (failedStepIndex !== -1) {
            job.pipeline[failedStepIndex].status = 'failed';
            job.pipeline[failedStepIndex].info = resultOrError;
        }
    }

    // Salva o estado final e define uma expiração (ex: 24 horas)
    await redisClient.set(`job:${jobId}`, JSON.stringify(job));
    await redisClient.expire(`job:${jobId}`, 86400); // 24 * 60 * 60

    // Envia o estado final e fecha a conexão
    const ws = jobConnections.get(jobId); 
    if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(job));
    }
    jobConnections.delete(jobId);
    metrics.observeSummary('job_duration_ms', jobTimers.has(jobId) ? (Date.now() - jobTimers.get(jobId)) : 0);
    jobTimers.delete(jobId);
    if (status === 'completed') {
        metrics.incrementCounter('jobs_completed_total');
    } else {
        metrics.incrementCounter('jobs_failed_total');
    }
    logger.info(`[BFF] Job ${jobId} finalizado com status: ${status}`);
}

async function processFilesInBackground(jobId, filesMeta) {
    // Esta função agora apenas dispara o primeiro evento do pipeline
    // O payload inicial contém os arquivos.
    const initialPayload = { filesMeta };
    jobTimers.set(jobId, Date.now());
    metrics.incrementCounter('jobs_started_total');
    eventBus.emit('orchestrator:start', { jobId, payload: initialPayload });
}

// --- AGENTE ORQUESTRADOR ---
// O cérebro do sistema. Ele decide qual tarefa executar a seguir.

// Carrega a definição do pipeline a partir do arquivo YAML na inicialização.
let pipelineDefinition;
try {
  pipelineDefinition = yaml.load(fs.readFileSync(path.join(__dirname, 'pipeline.yaml'), 'utf8'));
  logger.info('[Orquestrador] Definição do pipeline carregada com sucesso.');
} catch (e) {
  logger.fatal('ERRO CRÍTICO: Não foi possível carregar o arquivo pipeline.yaml.', { error: e });
  process.exit(1);
}

eventBus.on('orchestrator:start', ({ jobId, payload }) => {
    const firstTask = Object.keys(pipelineDefinition)[0];
    logger.info(`[Orquestrador] Job ${jobId}: Iniciando pipeline com a tarefa '${firstTask}'.`);
    eventBus.emit('task:start', { jobId, taskName: firstTask, payload });
});

eventBus.on('task:completed', async ({ jobId, taskName, resultPayload, payload }) => {
    const currentTaskDefinition = pipelineDefinition[taskName];
    if (!currentTaskDefinition) { // Validação de segurança
        return finalizeJob(jobId, 'failed', `Tarefa desconhecida '${taskName}' encontrada no pipeline.`);
    }

    // Propaga o payload anterior e o resultado da tarefa atual para a próxima
    const nextPayload = { ...payload, ...resultPayload };

    const nextTaskName = currentTaskDefinition.next;

    if (nextTaskName) {
        logger.info(`[Orquestrador] Job ${jobId}: Tarefa '${taskName}' concluída. Próxima tarefa: '${nextTaskName}'.`);
        eventBus.emit('task:start', { jobId, taskName: nextTaskName, payload: nextPayload });
    } else {
        // Fim do pipeline
        logger.info(`[Orquestrador] Job ${jobId}: Pipeline concluído com sucesso.`);
        finalizeJob(jobId, 'completed', nextPayload);
    }
});

eventBus.on('task:failed', ({ jobId, taskName, error }) => {
    logger.error(`[Orquestrador] Job ${jobId}: Tarefa '${taskName}' falhou.`, { error });
    finalizeJob(jobId, 'failed', error);
});

eventBus.on('tool:run', async ({ jobId, toolCall, payload }) => {
    const { availableTools } = require('./services/geminiClient');
    const toolName = toolCall.name;
    if (availableTools[toolName]) {
        const toolResult = await availableTools[toolName](toolCall.args);
        logger.debug(`[ToolsAgent] Job ${jobId}: Ferramenta '${toolName}' executada. Retornando resultado para o Orquestrador.`);
        eventBus.emit('orchestrator:tool_completed', { jobId, toolResult, originalPayload: payload });
    } else {
        logger.error(`[ToolsAgent] Job ${jobId}: Tentativa de chamar ferramenta desconhecida '${toolName}'.`);
        eventBus.emit('task:failed', { jobId, taskName: 'analysis', error: `Ferramenta desconhecida: ${toolName}` });
    }
});

// Inicia o servidor apenas se não estiver no ambiente de teste
if (process.env.NODE_ENV !== 'test') {
    server.listen(port, () => {
      metrics.setGauge('ws_connections_active', jobConnections.size);
      logger.info(`[BFF] Servidor rodando na porta ${port}`);
      logger.info('Este servidor atua como um proxy seguro para a API Gemini.');
    });
}

// Exporta o servidor e o app para serem usados nos testes de integração
module.exports = { app, server };
