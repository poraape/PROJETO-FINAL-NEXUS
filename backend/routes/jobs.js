// backend/routes/jobs.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const router = express.Router();

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

module.exports = (context) => {
    const {
        upload,
        redisClient,
        processFilesInBackground,
        embeddingModel,
        model,
        availableTools,
        weaviate
    } = context;

    // --- Endpoints de Processamento Assíncrono ---

    router.post('/', upload.array('files'), validateUpload, async (req, res) => {
        const jobId = uuidv4();
        console.log(`[BFF] Novo job criado com ID: ${jobId}`);

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

    router.get('/:jobId/status', async (req, res) => {
        const { jobId } = req.params;
        const jobString = await redisClient.get(`job:${jobId}`);

        if (!jobString) {
            return res.status(404).json({ message: 'Job não encontrado.' });
        }

        res.status(200).json(JSON.parse(jobString));
    });

    // --- Endpoint de Chat (RAG) ---
    router.post('/:jobId/chat', async (req, res) => {
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
            if (!contextChunks || contextChunks.length === 0) {
                return res.status(200).json({ answer: "Desculpe, não encontrei informações nos documentos fornecidos para responder a essa pergunta." });
            }
            
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
                const toolFn = availableTools[call.name];
                if (!toolFn) {
                    throw new Error(`Ferramenta desconhecida solicitada pela IA: ${call.name}`);
                }
                const toolResult = await toolFn(call.args);

                // Envia o resultado da ferramenta de volta para a IA para obter a resposta final
                // O resultado deve ser encapsulado para a API
                const finalResult = await chat.sendMessage([{ functionResponse: { name: call.name, response: { content: JSON.stringify(toolResult) } } }]);
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

    return router;
};