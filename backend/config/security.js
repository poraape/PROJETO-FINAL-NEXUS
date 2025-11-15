const logger = require('../services/logger').child({ module: 'securityConfig' });

const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true' || process.env.NODE_ENV === 'production';
const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY || process.env.JWT_SECRET || '';
const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || JWT_PRIVATE_KEY;
const JWT_ALGORITHM = process.env.JWT_ALGORITHM || 'HS256';
const TOKEN_ISSUER = process.env.JWT_ISSUER || 'nexus-backend';
const TOKEN_AUDIENCE = process.env.JWT_AUDIENCE || 'nexus-clients';
const DEFAULT_SCOPES = (process.env.JWT_DEFAULT_SCOPES || 'jobs:create jobs:read chat:invoke gemini:invoke').split(/[\s,]+/).filter(Boolean);

if (AUTH_ENABLED && !JWT_PUBLIC_KEY) {
    logger.warn('[Security] AUTH_ENABLED está ativo mas nenhuma chave JWT foi configurada. Tokens serão rejeitados.');
}

module.exports = {
    authEnabled: AUTH_ENABLED,
    jwtPrivateKey: JWT_PRIVATE_KEY,
    jwtPublicKey: JWT_PUBLIC_KEY,
    jwtAlgorithm: JWT_ALGORITHM,
    tokenIssuer: TOKEN_ISSUER,
    tokenAudience: TOKEN_AUDIENCE,
    defaultScopes: DEFAULT_SCOPES,
};
