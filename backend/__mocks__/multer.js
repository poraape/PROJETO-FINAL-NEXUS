const multerMock = jest.fn(() => ({
    array: () => (req, res, next) => {
        const payload = req.__multipartPayload || {};
        req.files = (payload.files || []).map(file => ({
            originalname: file.filename,
            buffer: file.buffer,
            mimetype: file.contentType || 'application/octet-stream',
            size: Buffer.isBuffer(file.buffer) ? file.buffer.length : Buffer.byteLength(file.buffer || ''),
            fieldname: file.fieldName || 'file',
            path: file.path || null,
            hash: file.hash || null,
        }));
        req.body = { ...(payload.fields || {}) };
        next();
    },
    single: () => (req, res, next) => next(),
    fields: () => (req, res, next) => {
        const payload = req.__multipartPayload || {};
        req.body = { ...(payload.fields || {}) };
        next();
    },
}));

multerMock.diskStorage = () => ({
    destination: () => {},
    filename: () => {},
});

module.exports = multerMock;
