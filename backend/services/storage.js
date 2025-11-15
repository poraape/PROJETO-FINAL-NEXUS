// backend/services/storage.js
/**
 * Simple local storage service that persists uploaded files on disk,
 * computes content hashes for deduplication, and exposes helpers to
 * retrieve file contents later in the pipeline.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const logger = require('./logger').child({ module: 'storageService' });

const TMP_DIR = process.env.UPLOAD_TMP_DIR || path.join(__dirname, '..', '..', '.uploads', 'tmp');
const STORAGE_DIR = process.env.UPLOAD_STORAGE_DIR || path.join(__dirname, '..', '..', '.uploads', 'objects');
const CACHE_DIR = process.env.UPLOAD_CACHE_DIR || path.join(__dirname, '..', '..', '.uploads', 'cache');
const RETENTION_HOURS = parseInt(process.env.UPLOAD_RETENTION_HOURS || '24', 10);
const CLEANUP_INTERVAL_MINUTES = parseInt(process.env.UPLOAD_CLEANUP_INTERVAL_MINUTES || '60', 10);
const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
const ENCRYPTION_HEADER = Buffer.from('NQI2');
const ENCRYPTION_ALGO = 'aes-256-gcm';
const ENCRYPTION_REQUIRED = process.env.UPLOAD_ENCRYPTION_REQUIRED === 'true';

function deriveEncryptionKey() {
    const rawKey = process.env.UPLOAD_ENCRYPTION_KEY;
    if (!rawKey) return null;
    try {
        if (rawKey.length === 64 && /^[a-fA-F0-9]+$/.test(rawKey)) {
            return Buffer.from(rawKey, 'hex');
        }
        return crypto.createHash('sha256').update(rawKey).digest();
    } catch {
        return null;
    }
}

const ENCRYPTION_KEY = deriveEncryptionKey();

if (!ENCRYPTION_KEY) {
    if (ENCRYPTION_REQUIRED) {
        throw new Error('[Storage] UPLOAD_ENCRYPTION_REQUIRED está ativo, mas nenhuma chave de criptografia válida foi configurada.');
    }
    logger.warn('[Storage] UPLOAD_ENCRYPTION_KEY não definido. Os arquivos serão armazenados em claro.');
} else {
    logger.info('[Storage] Criptografia AES-256-GCM habilitada para uploads.');
}

function encryptionEnabled() {
    return Boolean(ENCRYPTION_KEY);
}

function ensureDirSync(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function init() {
    ensureDirSync(TMP_DIR);
    ensureDirSync(STORAGE_DIR);
    ensureDirSync(CACHE_DIR);
    if (!isTestEnv) {
        scheduleCleanup();
    }
}

function getTmpDir() {
    return TMP_DIR;
}

function getStorageDir() {
    return STORAGE_DIR;
}

function getCacheDir() {
    ensureDirSync(CACHE_DIR);
    return CACHE_DIR;
}

async function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

async function persistUploadedFile(file) {
    const { path: tempPath, originalname, mimetype, size } = file;
    const checksum = await hashFile(tempPath);
    const storedPath = path.join(STORAGE_DIR, checksum);

    const alreadyExists = fs.existsSync(storedPath);
    if (!alreadyExists) {
        if (encryptionEnabled()) {
            await encryptFile(tempPath, storedPath);
            await fs.promises.unlink(tempPath);
        } else {
            await fs.promises.rename(tempPath, storedPath);
        }
    } else {
        // Duplicate upload, discard temporary instance.
        await fs.promises.unlink(tempPath);
    }

    return {
        hash: checksum,
        size,
        originalName: originalname,
        mimeType: mimetype,
        storedPath,
    };
}

async function persistUploadedFiles(files = []) {
    const results = [];
    for (const file of files) {
        try {
            const meta = await persistUploadedFile(file);
            results.push(meta);
        } catch (error) {
            // Clean up temp file on failure before propagating.
            if (file?.path && fs.existsSync(file.path)) {
                await fs.promises.unlink(file.path).catch(() => {});
            }
            throw error;
        }
    }
    return results;
}

async function readFileBuffer(hash) {
    const storedPath = path.join(STORAGE_DIR, hash);
    const buffer = await fs.promises.readFile(storedPath);
    if (encryptionEnabled()) {
        return decryptBuffer(buffer);
    }
    return buffer;
}

function createReadStream(hash) {
    const storedPath = path.join(STORAGE_DIR, hash);
    if (!encryptionEnabled()) {
        return fs.createReadStream(storedPath);
    }
    const passthrough = new PassThrough();
    fs.promises.readFile(storedPath).then(buffer => {
        try {
            const decrypted = decryptBuffer(buffer);
            passthrough.end(decrypted);
        } catch (error) {
            passthrough.destroy(error);
        }
    }).catch(err => passthrough.destroy(err));
    return passthrough;
}

async function readFileSnippet(hash, length = 4096) {
    if (!hash) return Buffer.alloc(0);

    if (encryptionEnabled()) {
        const buffer = await readFileBuffer(hash);
        return buffer.subarray(0, Math.min(length, buffer.length));
    }

    const storedPath = path.join(STORAGE_DIR, hash);
    try {
        const handle = await fs.promises.open(storedPath, 'r');
        try {
            const snippetBuffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(snippetBuffer, 0, length, 0);
            return snippetBuffer.subarray(0, bytesRead);
        } finally {
            await handle.close();
        }
    } catch (error) {
        try {
            const buffer = await fs.promises.readFile(storedPath);
            return buffer.subarray(0, Math.min(length, buffer.length));
        } catch (readError) {
            logger.warn('[Storage] Falha ao ler trecho do arquivo.', { hash, error: readError.message });
            return Buffer.alloc(0);
        }
    }
}

async function cleanupDirectory(dirPath) {
    const files = await fs.promises.readdir(dirPath).catch(() => []);
    const now = Date.now();
    const maxAgeMs = RETENTION_HOURS * 60 * 60 * 1000;
    await Promise.all(files.map(async file => {
        const filePath = path.join(dirPath, file);
        try {
            const stats = await fs.promises.stat(filePath);
            if (!stats.isFile()) return;
            if (now - stats.mtimeMs > maxAgeMs) {
                await fs.promises.unlink(filePath);
            }
        } catch {
            // Ignora erros unitários para não interromper a limpeza
        }
    }));
}

async function cleanupOldFiles() {
    await Promise.all([
        cleanupDirectory(STORAGE_DIR),
        cleanupDirectory(TMP_DIR),
        cleanupDirectory(CACHE_DIR),
    ]);
}

function scheduleCleanup() {
    const intervalMs = CLEANUP_INTERVAL_MINUTES * 60 * 1000;
    setInterval(() => {
        cleanupOldFiles().catch(err => {
            logger.warn('[Storage] Falha ao executar limpeza programada.', { error: err });
        });
    }, intervalMs).unref?.();
}

function decryptBuffer(buffer) {
    if (!ENCRYPTION_KEY) {
        throw new Error('Chave de criptografia não configurada.');
    }
    if (buffer.length < ENCRYPTION_HEADER.length + 12 + 16) {
        throw new Error('Arquivo criptografado inválido.');
    }
    const header = buffer.subarray(0, ENCRYPTION_HEADER.length);
    if (!header.equals(ENCRYPTION_HEADER)) {
        throw new Error('Cabeçalho de criptografia ausente.');
    }
    const ivStart = ENCRYPTION_HEADER.length;
    const ivEnd = ivStart + 12;
    const iv = buffer.subarray(ivStart, ivEnd);
    const tag = buffer.subarray(buffer.length - 16);
    const ciphertext = buffer.subarray(ivEnd, buffer.length - 16);
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptFile(sourcePath, destinationPath) {
    return new Promise((resolve, reject) => {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, ENCRYPTION_KEY, iv);
        const destination = fs.createWriteStream(destinationPath);
        destination.write(ENCRYPTION_HEADER);
        destination.write(iv);

        const source = fs.createReadStream(sourcePath);
        source.on('error', reject);
        cipher.on('error', reject);
        destination.on('error', reject);

        cipher.on('end', () => {
            try {
                const tag = cipher.getAuthTag();
                destination.write(tag);
                destination.end();
            } catch (error) {
                reject(error);
            }
        });

        destination.on('finish', resolve);

        source.pipe(cipher).pipe(destination, { end: false });
    });
}

module.exports = {
    init,
    getTmpDir,
    getStorageDir,
    getCacheDir,
    persistUploadedFiles,
    readFileBuffer,
    createReadStream,
    readFileSnippet,
    cleanupOldFiles,
};
