// backend/services/parser.js
/**
 * Funções utilitárias para converter diferentes formatos de arquivo em texto.
 * Nesta fase do projeto, o objetivo é garantir que o pipeline não falhe por
 * falta do módulo. Quando possível, retornamos uma representação textual simples.
 */

const TEXT_ENCODINGS = ['utf8', 'latin1'];

function bufferToString(buffer, encodings = TEXT_ENCODINGS) {
    if (!buffer) return '';
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    for (const encoding of encodings) {
        try {
            return data.toString(encoding);
        } catch (err) {
            // tenta próximo encoding
        }
    }
    return data.toString('base64');
}

function prettifyJSON(content) {
    try {
        const parsed = JSON.parse(content);
        return JSON.stringify(parsed, null, 2);
    } catch (err) {
        return content;
    }
}

/**
 * Extrai o conteúdo textual de um arquivo suportado.
 * @param {Buffer} buffer Conteúdo bruto do arquivo.
 * @param {string} mimeType Mime type informado pelo upload.
 * @param {string} [fileName] Nome original do arquivo (usado como fallback).
 * @returns {Promise<string>} Conteúdo textual simplificado.
 */
async function extractText(buffer, mimeType = '', fileName = '') {
    const lowerName = (fileName || '').toLowerCase();
    const lowerMime = (mimeType || '').toLowerCase();

    if (lowerMime.includes('json') || lowerName.endsWith('.json')) {
        return prettifyJSON(bufferToString(buffer));
    }

    if (lowerMime.includes('xml') || lowerName.endsWith('.xml')) {
        return bufferToString(buffer);
    }

    if (lowerMime.includes('csv') || lowerName.endsWith('.csv')) {
        return bufferToString(buffer);
    }

    if (lowerMime.startsWith('text/') || lowerName.endsWith('.txt')) {
        return bufferToString(buffer);
    }

    // Para binários (PDF, imagens, etc.) devolvemos conteúdo base64 com aviso.
    const base64 = bufferToString(buffer, ['base64']);
    return `<!-- Conteúdo binário (mime: ${mimeType || 'desconhecido'}) convertido para base64 para evitar falhas -->\n${base64}`;
}

module.exports = {
    extractText,
};
