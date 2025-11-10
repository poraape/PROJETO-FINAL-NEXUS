const http = require('http');
const { Duplex } = require('stream');

function normaliseHeaders(headers = {}) {
    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
    );
}

function buildJsonBody(json) {
    if (json === undefined) return { buffer: null, headers: {} };
    const buffer = Buffer.from(JSON.stringify(json));
    return {
        buffer,
        headers: { 'content-type': 'application/json' },
    };
}

function buildMultipartBody(multipart = {}) {
    const boundary = `----jest-boundary-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const chunks = [];

    Object.entries(multipart.fields || {}).forEach(([name, value]) => {
        chunks.push(Buffer.from(`--${boundary}\r\n`));
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
        chunks.push(Buffer.from(String(value)));
        chunks.push(Buffer.from('\r\n'));
    });

    (multipart.files || []).forEach(file => {
        chunks.push(Buffer.from(`--${boundary}\r\n`));
        chunks.push(Buffer.from(
            `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename || 'file.bin'}"\r\n`
        ));
        chunks.push(Buffer.from(`Content-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`));
        chunks.push(Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || ''));
        chunks.push(Buffer.from('\r\n'));
    });

    chunks.push(Buffer.from(`--${boundary}--\r\n`));

    return {
        buffer: Buffer.concat(chunks),
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
}

function buildBody(options) {
    if (options.multipart) {
        return buildMultipartBody(options.multipart);
    }
    if (options.json !== undefined) {
        return buildJsonBody(options.json);
    }
    if (options.rawBody !== undefined) {
        const buffer = Buffer.isBuffer(options.rawBody) ? options.rawBody : Buffer.from(options.rawBody);
        return { buffer, headers: options.rawHeaders || {} };
    }
    return { buffer: null, headers: {} };
}

class MockSocket extends Duplex {
    constructor() {
        super();
        this._chunks = [];
        this.remoteAddress = '127.0.0.1';
        this.encrypted = false;
    }

    _read() {}

    _write(chunk, encoding, callback) {
        if (chunk) {
            this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        }
        callback();
    }

    get data() {
        return Buffer.concat(this._chunks);
    }

    setTimeout() {}
}

function createRequest(options, bodyBuffer) {
    const socket = new MockSocket();
    const req = new http.IncomingMessage(socket);
    req.method = (options.method || 'GET').toUpperCase();
    req.url = options.path || options.url || '/';
    req.originalUrl = req.url;
    req.headers = normaliseHeaders(options.headers || {});
    req.headers.host = req.headers.host || 'localhost';
    req.rawHeaders = Object.entries(req.headers).flatMap(([key, value]) => [key, value]);
    req.connection = req.socket = socket;
    req.httpVersion = '1.1';

    if (bodyBuffer) {
        req.push(bodyBuffer);
    }
    req.push(null);

    return { req, socket };
}

function createResponse(req, socket, resolve) {
    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    res.on('finish', () => {
        const raw = socket.data;
        res.detachSocket(socket);

        let bodyBuffer = raw;
        const separator = raw.indexOf(Buffer.from('\r\n\r\n'));
        if (separator !== -1) {
            bodyBuffer = raw.subarray(separator + 4);
        }

        const headers = res.getHeaders();
        const contentType = (headers['content-type'] || '').toString().toLowerCase();
        let body;
        if (contentType.includes('application/json')) {
            body = bodyBuffer.length ? JSON.parse(bodyBuffer.toString() || '{}') : {};
        } else if (contentType.includes('text/') || contentType.includes('application/xml')) {
            body = bodyBuffer.toString();
        } else {
            body = bodyBuffer;
        }

        resolve({
            status: res.statusCode,
            headers,
            body,
        });
    });

    return res;
}

async function request(app, options = {}) {
    return new Promise((resolve, reject) => {
        const { buffer, headers: bodyHeaders } = buildBody(options);
        const headers = { ...normaliseHeaders(options.headers || {}), ...bodyHeaders };
        if (buffer) {
            headers['content-length'] = buffer.length;
        }

        const { req, socket } = createRequest({ ...options, headers }, buffer);
        const res = createResponse(req, socket, resolve);
        req.app = app;
        req.res = res;
        res.req = req;

        const cleanup = (err) => {
            socket.destroy();
            reject(err);
        };

        req.on('error', cleanup);
        res.on('error', cleanup);
        socket.on('error', cleanup);

        app.handle(req, res, (err) => {
            if (err) {
                cleanup(err);
            }
        });
    });
}

module.exports = request;
