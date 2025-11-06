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

const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3001; // Porta padrão 3001

const MAX_FILE_SIZE_MB = parseInt(process.env.UPLOAD_MAX_FILE_SIZE_MB || '50', 10);
const MAX_FILES_PER_JOB = parseInt(process.env.UPLOAD_MAX_FILES || '20', 10);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: MAX_FILES_PER_JOB,
  },
});

// --- Configuração de Segurança e Middlewares ---
app.use(cors()); // Em produção, restrinja para o domínio do seu frontend
app.use(express.json({ limit: '50mb' })); // Aumenta o limite de payload

// --- Inicialização da API Gemini ---
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  console.error("ERRO CRÍTICO: A variável de ambiente GEMINI_API_KEY não está definida.");
  process.exit(1);
}

// --- Armazenamento de Jobs (Em memória para esta fase) ---
const jobConnections = new Map(); // Mapeia jobId -> WebSocket

// --- Configuração do WebSocket Server ---
const wss = new WebSocketServer({ server }); // Anexa o WebSocket Server ao servidor HTTP

wss.on('connection', (ws, req) => {
  // O frontend deve se conectar com a URL contendo o jobId, ex: ws://localhost:3001?jobId=...
  const url = new URL(req.url, `http://${req.headers.host}`);
  const jobId = url.searchParams.get('jobId');

  if (jobId) {
    console.log(`[BFF-WS] Cliente conectado para o job: ${jobId}`);
    jobConnections.set(jobId, ws);

    // Busca o estado atual do job no Redis e envia ao cliente
    redisClient.get(`job:${jobId}`).then(jobString => { // Busca o estado inicial do job
        if (jobString && ws.readyState === ws.OPEN) {
            ws.send(jobString);
        }
    }).catch(err => {
        console.error(`[BFF-WS] Erro ao buscar job ${jobId} do Redis:`, err);
    });

    ws.on('close', () => {
      console.log(`[BFF-WS] Cliente desconectado do job: ${jobId}`);
      jobConnections.delete(jobId);
    });
  } else {
    console.warn(`[BFF-WS] Conexão rejeitada: jobId inválido ou não encontrado.`);
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
};

// --- REGISTRO DE ROTAS E AGENTES ---

const registerRoutes = require('./routes');
registerRoutes(app, sharedContext);

registerAgents(sharedContext); // Registra os listeners dos agentes

// Middleware de tratamento de erros globais (upload e demais)
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        console.error('[Upload] Erro no envio de arquivos:', err);
        let message = err.message;
        if (err.code === 'LIMIT_FILE_SIZE') {
            message = `O tamanho máximo por arquivo (${MAX_FILE_SIZE_MB} MB) foi excedido.`;
        } else if (err.code === 'LIMIT_FILE_COUNT') {
            message = `Número máximo de arquivos por envio (${MAX_FILES_PER_JOB}) excedido.`;
        }
        return res.status(400).json({ message });
    }
    if (err) {
        console.error('[Server] Erro não tratado:', err);
        return res.status(500).json({ message: 'Erro interno do servidor.' });
    }
    return next();
});

// --- Funções de Suporte ao Pipeline (usadas pelos agentes e rotas) ---

// Carrega a definição do pipeline a partir do arquivo YAML na inicialização.
let pipelineDefinition;
try {
  pipelineDefinition = yaml.load(fs.readFileSync(path.join(__dirname, 'pipeline.yaml'), 'utf8'));
  console.log('[Orquestrador] Definição do pipeline carregada com sucesso.');
} catch (e) {
  console.error('ERRO CRÍTICO: Não foi possível carregar o arquivo pipeline.yaml.', e);
  process.exit(1);
}

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
    console.log(`[BFF] Job ${jobId} finalizado com status: ${status}`);
}

async function processFilesInBackground(jobId, files) {
    // Esta função agora apenas dispara o primeiro evento do pipeline
    // O payload inicial contém os arquivos.
    const initialPayload = { files };
    eventBus.emit('orchestrator:start', { jobId, payload: initialPayload });
}

// --- AGENTE ORQUESTRADOR ---
// O cérebro do sistema. Ele decide qual tarefa executar a seguir.

eventBus.on('orchestrator:start', ({ jobId, payload }) => {
    const firstTask = Object.keys(pipelineDefinition)[0];
    console.log(`[Orquestrador] Job ${jobId}: Iniciando pipeline com a tarefa '${firstTask}'.`);
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
        console.log(`[Orquestrador] Job ${jobId}: Tarefa '${taskName}' concluída. Próxima tarefa: '${nextTaskName}'.`);
        eventBus.emit('task:start', { jobId, taskName: nextTaskName, payload: nextPayload });
    } else {
        // Fim do pipeline
        console.log(`[Orquestrador] Job ${jobId}: Pipeline concluído com sucesso.`);
        finalizeJob(jobId, 'completed', nextPayload);
    }
});

eventBus.on('task:failed', ({ jobId, taskName, error }) => {
    console.error(`[Orquestrador] Job ${jobId}: Tarefa '${taskName}' falhou.`);
    finalizeJob(jobId, 'failed', error);
});

eventBus.on('tool:run', async ({ jobId, toolCall, payload }) => {
    const { availableTools } = require('./services/geminiClient');
    const toolName = toolCall.name;
    if (availableTools[toolName]) {
        const toolResult = await availableTools[toolName](toolCall.args);
        console.log(`[ToolsAgent] Job ${jobId}: Ferramenta '${toolName}' executada. Retornando resultado para o Orquestrador.`);
        eventBus.emit('orchestrator:tool_completed', { jobId, toolResult, originalPayload: payload });
    } else {
        console.error(`[ToolsAgent] Job ${jobId}: Tentativa de chamar ferramenta desconhecida '${toolName}'.`);
        eventBus.emit('task:failed', { jobId, taskName: 'analysis', error: `Ferramenta desconhecida: ${toolName}` });
    }
});

// Inicia o servidor apenas se não estiver no ambiente de teste
if (process.env.NODE_ENV !== 'test') {
    server.listen(port, () => {
      console.log(`[BFF] Servidor rodando na porta ${port}`);
      console.log('Este servidor atua como um proxy seguro para a API Gemini.');
    });
}

// Exporta o servidor para ser usado nos testes de integração
module.exports = server;
