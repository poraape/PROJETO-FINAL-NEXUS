const DEFAULT_SAMPLE_TEXT = 'Conteúdo simulado para testes.';

function buildMockArtifact(fileMeta = {}) {
  const baseName = fileMeta.originalName || fileMeta.name || 'documento-simulado.txt';
  return {
    hash: fileMeta.hash || 'mock-hash',
    fileName: baseName,
    mimeType: fileMeta.mimeType || 'text/plain',
    size: fileMeta.size || 0,
    text: DEFAULT_SAMPLE_TEXT,
    summary: DEFAULT_SAMPLE_TEXT,
    chunkCount: 1,
    chunks: [DEFAULT_SAMPLE_TEXT],
    entities: { cnpjs: [], emails: [], monetaryValues: [] },
    detection: { mime: 'text/plain' },
    metrics: { wordCount: DEFAULT_SAMPLE_TEXT.split(/\s+/).length },
  };
}

async function extractArtifactsForFileMeta(fileMeta) {
  return [buildMockArtifact(fileMeta)];
}

module.exports = {
  extractArtifactsForFileMeta,
};
