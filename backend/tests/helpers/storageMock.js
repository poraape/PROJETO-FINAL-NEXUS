const fs = require('fs');
const { Readable } = require('stream');

const snippetBuffer = Buffer.from('conteudo anexado');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

const storageMock = {
    init: jest.fn(),
    getTmpDir: jest.fn(() => '/tmp'),
    getCacheDir: jest.fn(() => {
        ensureDir('/tmp/cache');
        return '/tmp/cache';
    }),
    getStorageDir: jest.fn(() => {
        ensureDir('/tmp/storage');
        return '/tmp/storage';
    }),
    persistUploadedFiles: jest.fn(async (files = []) => files.map((file, index) => ({
        hash: `hash-${index}`,
        size: Buffer.isBuffer(file.buffer) ? file.buffer.length : Buffer.byteLength(file.buffer || ''),
        originalName: file.filename || file.originalname || `file-${index}`,
        mimeType: file.contentType || file.mimetype || 'application/octet-stream',
        storedPath: `/tmp/hash-${index}`,
    }))),
    readFileSnippet: jest.fn().mockResolvedValue(snippetBuffer),
    readFileBuffer: jest.fn().mockResolvedValue(snippetBuffer),
    createReadStream: jest.fn(() => Readable.from([snippetBuffer])),
    encryptionEnabled: jest.fn(() => false),
    getTmpFilePath: jest.fn(() => '/tmp/mock-file'),
};

module.exports = storageMock;
