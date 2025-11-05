// backend/server.js
const express = require('express');
const http = require('http');
const { GoogleGenerativeAI } = require('@google/genai');
const { WebSocketServer } = require('ws');
const cors = require('cors');
require('dotenv').config();
const yaml = require('js-yaml');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const JSZip = require('jszip');
const redisClient = require('./services/redisClient');
const weaviate = require('./services/weaviateClient');
const eventBus = require('./services/eventBus');
const os = require('os');
const tools = require('./services/tools');
const { extractText } = require('./services/parser');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3001;

const upload = multer({ storage: multer.memoryStorage() });

// --- Configuração de Segurança e Middlewares ---
app.use(cors()); // Em produção, restrinja para o domínio do seu frontend
app.use(express.json({ limit: '50mb' })); // Aumenta o limite de payload

// --- Inicialização da API Gemini ---
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  console.error("ERRO CRÍTICO: A variável de ambiente GEMINI_API_KEY não está definida.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(geminiApiKey);

// Define the tools our AI can use
const availableTools = {
    tax_simulation: tools.tax_simulation,
    cnpj_validation: tools.cnpj_validation,
};

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    tools: [{
        functionDeclarations: [{
            name: "tax_simulation", description: "Simula o cálculo de impostos para um determinado valor base e regime tributário.", parameters: { type: "OBJECT", properties: { baseValue: { type: "NUMBER" }, taxRegime: { type: "STRING", enum: ["Lucro Presumido", "Lucro Real", "Simples Nacional"] } }, required: ["baseValue", "taxRegime"] }
        }]
    }]
});
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// --- Armazenamento de Jobs (Em memória para esta fase) ---
const jobConnections = new Map(); // Mapeia jobId -> WebSocket

// --- Configuração do WebSocket Server ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // O frontend deve se conectar com a URL contendo o jobId, ex: ws://localhost:3001?jobId=...
  const url = new URL(req.url, `http://${req.headers.host}`);
  const jobId = url.searchParams.get('jobId');

  if (jobId) {
    console.log(`[BFF-WS] Cliente conectado para o job: ${jobId}`);
    jobConnections.set(jobId, ws);

    // Busca o estado atual do job no Redis e envia ao cliente
    redisClient.get(`job:${jobId}`).then(jobString => {
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

// --- Endpoint Proxy ---
app.post('/api/gemini', async (req, res) => {
  const { promptParts, isJsonMode } = req.body;

  if (!promptParts || !Array.isArray(promptParts)) {
    return res.status(400).json({ message: "O corpo da requisição deve conter 'promptParts'." });
  }

  console.log(`[BFF] Recebida requisição para Gemini. Modo JSON: ${isJsonMode}`);

  try {
    const generationConfig = isJsonMode ? { responseMimeType: 'application/json' } : undefined;
    
    const result = await model.generateContent({
        contents: [{ parts: promptParts }],
        generationConfig,
    });

    const response = await result.response;
    const text = response.text();
    
    // Retorna a resposta da Gemini no mesmo formato que o frontend espera
    res.status(200).json({
        text: text,
        // A resposta completa pode ser grande, enviamos apenas o necessário
        candidates: response.candidates, 
    });

  } catch (error) {
    console.error("[BFF] Erro ao chamar a API Gemini:", error);
    res.status(500).json({ 
        message: `Erro no servidor ao processar a requisição da IA: ${error.message}`,
        details: error.toString(),
    });
  }
});

// --- Health Check Endpoint ---
app.get('/api/health', async (req, res) => {
    const healthStatus = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            redis: 'pending',
            weaviate: 'pending',
            gemini_api: 'pending',
        }
    };

    let isHealthy = true;

    // Check Redis
    try {
        await redisClient.ping();
        healthStatus.services.redis = 'ok';
    } catch (e) {
        healthStatus.services.redis = `error: ${e.message}`;
        isHealthy = false;
    }

    // Check Weaviate
    try {
        await weaviate.client.misc.liveChecker().do();
        healthStatus.services.weaviate = 'ok';
    } catch (e) {
        healthStatus.services.weaviate = `error: ${e.message}`;
        isHealthy = false;
    }

    // Check Gemini API Key
    healthStatus.services.gemini_api = geminiApiKey ? 'ok' : 'error: API key not configured';
    if (!geminiApiKey) isHealthy = false;

    if (isHealthy) {
        res.status(200).json(healthStatus);
    } else {
        healthStatus.status = 'error';
        res.status(503).json(healthStatus); // 503 Service Unavailable
    }
});

// --- Endpoint de Chat (RAG) ---
app.post('/api/jobs/:jobId/chat', async (req, res) => {
    const { jobId } = req.params;
    const { question } = req.body;

    if (!question) {
        return res.status(400).json({ message: "A pergunta é obrigatória." });
    }

    try {
        // 1. Gerar embedding para a pergunta
        const questionEmbedding = await embeddingModel.embedContent(question);

        // 2. Buscar no Weaviate por chunks relevantes
        const searchResult = await weaviate.client.graphql
            .get()
            .withClassName(weaviate.className)
            .withFields('content fileName')
            .withWhere({ path: ['jobId'], operator: 'Equal', valueText: jobId })
            .withNearVector({ vector: questionEmbedding.embedding.values })
            .withLimit(5)
            .do();

        const contextChunks = searchResult.data.Get[weaviate.className];
        const context = contextChunks.map(c => `Trecho do arquivo ${c.fileName}:\n${c.content}`).join('\n\n---\n\n');

        // 3. Chamar a IA com o contexto
        const prompt = `Com base no seguinte contexto, responda à pergunta do usuário. Se a pergunta envolver um cálculo de impostos, use a ferramenta 'tax_simulation'.\n\nCONTEXTO:\n${context}\n\nPERGUNTA: ${question}`;
        
        const chat = model.startChat({
            tools: availableTools,
        });

        const result = await chat.sendMessage(prompt);
        const call = result.response.functionCalls()?.[0];

        if (call) {
            // A IA quer usar uma ferramenta
            console.log(`[Chat-RAG] Job ${jobId}: IA solicitou o uso da ferramenta '${call.name}' no chat.`);
            const toolResult = await availableToolscall.name;

            // Envia o resultado da ferramenta de volta para a IA para obter a resposta final
            const finalResult = await chat.sendMessage([{ functionResponse: { name: call.name, response: toolResult } }]);
            res.status(200).json({ answer: finalResult.response.text() });

        } else {
            // Resposta direta sem ferramenta
            res.status(200).json({ answer: result.response.text() });
        }

    } catch (error) {
        console.error(`[Chat-RAG] Erro no job ${jobId}:`, error);
        res.status(500).json({ message: "Falha ao processar a pergunta.", details: error.message });
    }
});

// --- Endpoints de Processamento Assíncrono ---

app.post('/api/jobs', upload.array('files'), async (req, res) => {
    const jobId = uuidv4();
    console.log(`[BFF] Novo job criado com ID: ${jobId}`);
    // Adiciona o jobId ao payload inicial para que o chat possa usá-lo

    // Inicializa o status do job
    const newJob = {
        status: 'processing',
        pipeline: [
            { name: 'Extração de Dados', status: 'in-progress', info: 'Recebendo e descompactando arquivos...' },
            { name: 'Auditoria Inicial', status: 'pending' },
            { name: 'Classificação Fiscal', status: 'pending' },
            { name: 'Análise Executiva (IA)', status: 'pending' },
            { name: 'Indexação Cognitiva', status: 'pending' },
        ],
        jobId: jobId, // Adiciona o jobId ao objeto do job
        result: null,
        error: null,
    };

    // Armazena o novo job no Redis
    await redisClient.set(`job:${jobId}`, JSON.stringify(newJob));

    // Retorna o ID do job imediatamente
    res.status(202).json({ jobId });

    // Inicia o processamento em segundo plano (sem usar await aqui)
    processFilesInBackground(jobId, req.files);
});

app.get('/api/jobs/:jobId/status', async (req, res) => {
    const { jobId } = req.params;
    const jobString = await redisClient.get(`job:${jobId}`);

    if (!jobString) {
        return res.status(404).json({ message: 'Job não encontrado.' });
    }

    res.status(200).json(JSON.parse(jobString));
});


// --- Lógica do Pipeline Orientado a Eventos ---

// Carrega a definição do pipeline a partir do arquivo YAML na inicialização.
let pipelineDefinition;
try {
  pipelineDefinition = yaml.load(fs.readFileSync(path.join(__dirname, 'pipeline.yaml'), 'utf8'));
  console.log('[Orquestrador] Definição do pipeline carregada com sucesso.');
} catch (e) {
  console.error('ERRO CRÍTICO: Não foi possível carregar o arquivo pipeline.yaml.', e);
  process.exit(1);
}

async function updateJobStatus(jobId, stepIndex, status, info) {
    const jobString = await redisClient.get(`job:${jobId}`);
    if (!jobString) return;

    const job = JSON.parse(jobString);

    job.pipeline[stepIndex].status = status;
    if (info) job.pipeline[stepIndex].info = info;

    // Marca passos anteriores como concluídos
    for (let i = 0; i < stepIndex; i++) {
        if (job.pipeline[i].status !== 'failed') {
            job.pipeline[i].status = 'completed';
        }
    }

    // Salva o estado atualizado de volta no Redis
    await redisClient.set(`job:${jobId}`, JSON.stringify(job));

    // Envia a atualização via WebSocket
    const ws = jobConnections.get(jobId);
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
    // Esta função agora apenas dispara o primeiro evento
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
    if (!currentTaskDefinition) {
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
    const toolName = toolCall.name;
    const toolResult = await availableTools[toolName](toolCall.args);
    console.log(`[ToolsAgent] Job ${jobId}: Ferramenta '${toolName}' executada. Retornando resultado para o Orquestrador.`);
    eventBus.emit('orchestrator:tool_completed', { jobId, toolResult, originalPayload: payload });
});

// --- WORKERS (AGORA FORMALIZADOS COMO AGENTES) ---
// Cada worker escuta 'task:start' para sua tarefa específica.

// Agente de Extração
eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
    if (taskName !== 'extraction') return;
    try {
        const { files } = payload;
        await updateJobStatus(jobId, 0, 'in-progress', `Descompactando e lendo ${files.length} arquivo(s)...`);
        const fileContentsForAnalysis = [];
        for (const file of files) {
            if (file.mimetype === 'application/zip') {
                const zip = await JSZip.loadAsync(file.buffer);
                for (const fileName in zip.files) {
                    if (!zip.files[fileName].dir) {
                        const textContent = await extractText(await zip.files[fileName].async('nodebuffer'), fileName.endsWith('.xml') ? 'application/xml' : 'text/plain');
                        fileContentsForAnalysis.push({ fileName, content: textContent });
                    }
                }
            } else {
                const textContent = await extractText(file.buffer, file.mimetype);
                fileContentsForAnalysis.push({ fileName: file.originalname, content: textContent });
            }
        }
        await updateJobStatus(jobId, 0, 'completed');
        eventBus.emit('task:completed', { jobId, taskName, resultPayload: { fileContentsForAnalysis }, payload: payload });
    } catch (error) {
        eventBus.emit('task:failed', { jobId, taskName, error: `Falha na extração: ${error.message}` });
    }
});

// Agente de Validação (Novo)
eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
    if (taskName !== 'validation') return;
    try {
        const { fileContentsForAnalysis } = payload;
        await updateJobStatus(jobId, 1, 'in-progress', 'Ag. Validador: Buscando e validando CNPJs...');

        // Simple regex to find potential CNPJs in the text content
        const cnpjRegex = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
        const combinedContent = fileContentsForAnalysis.map(f => f.content).join(' ');
        const foundCnpjs = [...new Set(combinedContent.match(cnpjRegex) || [])];

        if (foundCnpjs.length === 0) {
            await updateJobStatus(jobId, 1, 'completed', 'Nenhum CNPJ encontrado para validação.');
            eventBus.emit('task:completed', { jobId, taskName, resultPayload: { validations: [] }, payload });
            return;
        }

        const validationPromises = foundCnpjs.map(cnpj => tools.cnpj_validation({ cnpj }));
        const validations = await Promise.all(validationPromises);

        await updateJobStatus(jobId, 1, 'completed', `${validations.length} CNPJ(s) validados.`);
        eventBus.emit('task:completed', { jobId, taskName, resultPayload: { validations }, payload });
    } catch (error) {
        eventBus.emit('task:failed', { jobId, taskName, error: `Falha na validação de CNPJ: ${error.message}` });
    }
});

// Agente de Auditoria
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

// Agente de Classificação
eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
    if (taskName !== 'classification') return;
    try {
        await updateJobStatus(jobId, 2, 'in-progress', 'Ag. Classificador: Organizando informações...');
        await new Promise(res => setTimeout(res, 500)); // Simulação
        await updateJobStatus(jobId, 2, 'completed');
        eventBus.emit('task:completed', { jobId, taskName, resultPayload: {}, payload: payload });
    } catch (error) {
        eventBus.emit('task:failed', { jobId, taskName, error: `Falha na classificação: ${error.message}` });
    }
});

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

// Agente de Indexação
eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
    if (taskName !== 'indexing') return;
    try {
        const { fileContentsForAnalysis } = payload;
        if (!fileContentsForAnalysis || fileContentsForAnalysis.length === 0) {
            console.warn(`[Indexador] Job ${jobId}: Nenhum conteúdo para indexar. Pulando etapa.`);
            await updateJobStatus(jobId, 4, 'completed', 'Nenhum conteúdo para indexar.');
            eventBus.emit('task:completed', { jobId, taskName, resultPayload: {}, payload: payload });
            return;
        }

        await updateJobStatus(jobId, 4, 'in-progress', 'Ag. Contador: Indexando conteúdo para chat...');
        
        // 1. Chunking
        const chunks = fileContentsForAnalysis.flatMap(file => 
            (file.content.match(/.{1,2000}/gs) || []).map(chunkContent => ({
                jobId,
                fileName: file.fileName,
                content: chunkContent,
            }))
        );

        // 2. Embedding e Inserção em Lote no Weaviate
        const embeddings = await embeddingModel.batchEmbedContents({ requests: chunks.map(c => ({ model: "models/text-embedding-004", content: c.content })) });
        const objects = chunks.map((chunk, i) => ({ className: weaviate.className, properties: chunk, vector: embeddings.embeddings[i].values }));
        await weaviate.client.batch.objectsBatcher().withObjects(...objects).do();

        await updateJobStatus(jobId, 4, 'completed');
        eventBus.emit('task:completed', { jobId, taskName, resultPayload: {}, payload: payload });
    } catch (error) {
        eventBus.emit('task:failed', { jobId, taskName, error: `Falha na indexação: ${error.message}` });
    }
});

// Agente de Alerta (Novo)
// Este agente é passivo e apenas escuta por falhas.
eventBus.on('task:failed', ({ jobId, taskName, error }) => {
    // Em um sistema de produção, isso poderia enviar um email, uma notificação no Slack, ou registrar em um sistema de monitoramento como Sentry ou Datadog.
    console.error(`\n🚨 ALERTA 🚨\n----------------------------------------\nJob ID: ${jobId}\nTarefa Falhou: ${taskName}\nMotivo: ${error}\n----------------------------------------\n`);
});


server.listen(port, () => {
  console.log(`[BFF] Servidor rodando na porta ${port}`);
  console.log('Este servidor atua como um proxy seguro para a API Gemini.');
});
