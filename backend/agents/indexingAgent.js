// backend/agents/indexingAgent.js

const { embeddingModel } = require('../services/geminiClient');

function register({ eventBus, updateJobStatus, weaviate }) {
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

            await updateJobStatus(jobId, 4, 'in-progress', 'Ag. Cognitivo: Indexando conteúdo para chat...');
            
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
}

module.exports = { register };