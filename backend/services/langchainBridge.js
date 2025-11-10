// backend/services/langchainBridge.js
/**
 * Lightweight bridge that emula partes essenciais do LangChain
 * (ConversationBufferMemory + VectorStoreRetriever + Semantic Cache)
 * sem depender diretamente da biblioteca. Mantém a compatibilidade
 * com ambientes restritos e permite que os agentes reutilizem contexto.
 */

const MAX_MEMORY_ENTRIES = parseInt(process.env.LANGCHAIN_MEMORY_WINDOW || '12', 10);

const conversationBuffers = new Map(); // jobId -> [{ role, content, timestamp, meta }]
const semanticCache = new Map(); // `${jobId}:${taskName}:${contextHash}` -> payload
const embeddingCache = new Map(); // `${hash}:${chunkIndex}` -> vector[]

const readySince = new Date().toISOString();

function getMemory(jobId) {
    return conversationBuffers.get(jobId) || [];
}

function appendMemory(jobId, role, content, meta = {}) {
    if (!jobId || !role || !content) return;
    const buffer = getMemory(jobId).slice(-MAX_MEMORY_ENTRIES + 1);
    buffer.push({
        role,
        content,
        timestamp: new Date().toISOString(),
        meta,
    });
    conversationBuffers.set(jobId, buffer);
}

function buildTranscript(jobId, maxEntries = 8) {
    const buffer = getMemory(jobId);
    if (!buffer.length) return '';
    return buffer
        .slice(-maxEntries)
        .map(entry => `${entry.role.toUpperCase()}: ${entry.content}`)
        .join('\n');
}

function cacheSemanticResponse(jobId, taskName, contextHash, payload) {
    if (!jobId || !taskName || !contextHash || !payload) return;
    const key = `${jobId}:${taskName}:${contextHash}`;
    semanticCache.set(key, { payload, cachedAt: new Date().toISOString() });
}

function getCachedResponse(jobId, taskName, contextHash) {
    if (!jobId || !taskName || !contextHash) return null;
    const key = `${jobId}:${taskName}:${contextHash}`;
    return semanticCache.get(key) || null;
}

function rememberEmbedding(chunkKey, vector = []) {
    if (!chunkKey || !Array.isArray(vector) || vector.length === 0) return;
    embeddingCache.set(chunkKey, vector);
}

function getCachedEmbedding(chunkKey) {
    if (!chunkKey) return null;
    return embeddingCache.get(chunkKey) || null;
}

function resetJob(jobId) {
    if (!jobId) return;
    conversationBuffers.delete(jobId);
    const prefix = `${jobId}:`;
    Array.from(semanticCache.keys()).forEach(key => {
        if (key.startsWith(prefix)) {
            semanticCache.delete(key);
        }
    });
}

function isReady() {
    return true;
}

function getDiagnostics() {
    return {
        readySince,
        trackedJobs: conversationBuffers.size,
        cachedResponses: semanticCache.size,
        cachedEmbeddings: embeddingCache.size,
    };
}

module.exports = {
    getMemory,
    appendMemory,
    buildTranscript,
    cacheSemanticResponse,
    getCachedResponse,
    rememberEmbedding,
    getCachedEmbedding,
    resetJob,
    isReady,
    getDiagnostics,
};
