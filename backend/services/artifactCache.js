// backend/services/artifactCache.js
/**
 * Persiste artefatos extraídos para reutilização futura,
 * reduzindo processamento redundante em uploads e anexos.
 */

const fs = require('fs');
const path = require('path');
const storageService = require('./storage');

const CACHE_DIR = storageService.getCacheDir();

function getCachePath(hash) {
    return path.join(CACHE_DIR, `${hash}.json`);
}

async function readCache(hash) {
    const filePath = getCachePath(hash);
    try {
        const data = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

async function writeCache(hash, artifacts) {
    if (!hash || !Array.isArray(artifacts) || artifacts.length === 0) return;
    const filePath = getCachePath(hash);
    try {
        await fs.promises.writeFile(filePath, JSON.stringify(artifacts), 'utf8');
    } catch (error) {
        console.warn('[ArtifactCache] Falha ao salvar cache de artefatos.', { hash, error });
    }
}

module.exports = {
    get: readCache,
    set: writeCache,
};
