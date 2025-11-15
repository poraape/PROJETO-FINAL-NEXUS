const crypto = require('crypto');
const security = require('../config/security');

function base64UrlEncode(input) {
    return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(input) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = 4 - (normalized.length % 4 || 4);
    const padded = normalized + '='.repeat(padLength === 4 ? 0 : padLength);
    return Buffer.from(padded, 'base64').toString('utf8');
}

function signAccessToken(payload = {}, options = {}) {
    if (!security.jwtPrivateKey) {
        throw new Error('JWT_PRIVATE_KEY não configurada.');
    }
    const header = { alg: 'HS256', typ: 'JWT' };
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expSeconds = options.expiresIn ? nowSeconds + parseExpiry(options.expiresIn) : nowSeconds + 3600;
    const claims = {
        iss: security.tokenIssuer,
        aud: security.tokenAudience,
        iat: nowSeconds,
        exp: expSeconds,
        scopes: security.defaultScopes,
        ...payload,
    };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(claims));
    const data = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto.createHmac('sha256', security.jwtPrivateKey).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${data}.${signature}`;
}

function parseExpiry(value) {
    if (typeof value === 'number') {
        return value;
    }
    const match = /^([0-9]+)([smhd])$/.exec(String(value));
    if (!match) {
        return 3600;
    }
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
        case 's': return amount;
        case 'm': return amount * 60;
        case 'h': return amount * 3600;
        case 'd': return amount * 86400;
        default: return 3600;
    }
}

function verifyAccessToken(token) {
    if (!security.jwtPublicKey) {
        throw new Error('JWT_PUBLIC_KEY não configurada.');
    }
    if (!token || typeof token !== 'string') {
        throw new Error('Token inválido.');
    }
    const [encodedHeader, encodedPayload, signature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !signature) {
        throw new Error('Token malformado.');
    }
    const data = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = crypto.createHmac('sha256', security.jwtPublicKey)
        .update(data)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
        throw new Error('Assinatura inválida.');
    }

    const payloadJson = base64UrlDecode(encodedPayload);
    const payload = JSON.parse(payloadJson);

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp && nowSeconds >= payload.exp) {
        throw new Error('Token expirado.');
    }
    if (payload.iss && payload.iss !== security.tokenIssuer) {
        throw new Error('Issuer inválido.');
    }
    if (payload.aud && payload.aud !== security.tokenAudience) {
        throw new Error('Audience inválido.');
    }
    return payload;
}

module.exports = {
    signAccessToken,
    verifyAccessToken,
};
