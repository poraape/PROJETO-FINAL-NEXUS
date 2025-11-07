// backend/agents/indexingAgent.js

const { embeddingModel } = require('../services/geminiClient');

function register({ eventBus, updateJobStatus, weaviate }) {
    eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
        if (taskName !== 'indexing') return;
        try {
            const artifacts = payload.artifacts || [];
            const fileContentsForAnalysis = payload.fileContentsForAnalysis || artifacts.map(artifact => ({
                fileName: artifact.fileName,
                content: artifact.text,
            }));

            if ((!fileContentsForAnalysis || fileContentsForAnalysis.length === 0) && artifacts.length === 0) {
                console.warn(`[Indexador] Job ${jobId}: Nenhum conteúdo para indexar. Pulando etapa.`);
                await updateJobStatus(jobId, 5, 'completed', 'Nenhum conteúdo para indexar.');
                eventBus.emit('task:completed', { jobId, taskName, resultPayload: {}, payload: payload });
                return;
            }

            await updateJobStatus(jobId, 5, 'in-progress', 'Ag. Cognitivo: Indexando conteúdo para chat...');
            
            // 1. Chunking
            const chunks = (artifacts.length > 0 ? artifacts : fileContentsForAnalysis).flatMap(item => {
                const baseChunks = item.chunks && item.chunks.length > 0
                    ? item.chunks
                    : (item.content || item.text || '').match(/.{1,2000}/gs) || [];

                return baseChunks.map((chunkContent, index) => ({
                    jobId,
                    fileName: item.fileName || item.file_name,
                    content: chunkContent,
                    sourceHash: item.hash,
                    chunkIndex: index,
                    summary: item.summary,
                }));
            });

            // 2. Embedding e Inserção em Lote no Weaviate
            const embeddings = await embeddingModel.batchEmbedContents({ requests: chunks.map(c => ({ model: "models/text-embedding-004", content: c.content })) });
            const objects = chunks.map((chunk, i) => ({ className: weaviate.className, properties: chunk, vector: embeddings.embeddings[i].values }));
            await weaviate.client.batch.objectsBatcher().withObjects(...objects).do();

            await updateJobStatus(jobId, 5, 'completed');
            eventBus.emit('task:completed', { jobId, taskName, resultPayload: {}, payload: payload });
        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na indexação: ${error.message}` });
        }
    });
}

module.exports = { register };
