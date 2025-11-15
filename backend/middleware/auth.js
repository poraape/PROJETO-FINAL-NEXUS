const security = require('../config/security');
const tokenService = require('../services/tokenService');
const logger = require('../services/logger').child({ module: 'authMiddleware' });

function extractToken(req) {
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    if (req.query?.token) {
        return String(req.query.token);
    }
    if (req.headers?.['x-access-token']) {
        return String(req.headers['x-access-token']);
    }
    return null;
}

function requireAuth(req, res, next) {
    if (!security.authEnabled) {
        req.auth = req.auth || { sub: 'anonymous', scopes: security.defaultScopes, orgId: 'default' };
        return next();
    }
    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({ message: 'Token de acesso ausente.' });
    }
    try {
        const decoded = tokenService.verifyAccessToken(token);
        req.auth = decoded;
        return next();
    } catch (error) {
        logger.warn('[Auth] Token inválido ou expirado.', { error: error.message });
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
    }
}

function requireScopes(requiredScopes = []) {
    return (req, res, next) => {
        if (!security.authEnabled) {
            return next();
        }
        const tokenScopes = Array.isArray(req.auth?.scopes) ? req.auth.scopes : [];
        const hasAll = requiredScopes.every(scope => tokenScopes.includes(scope));
        if (!hasAll) {
            return res.status(403).json({ message: 'Permissões insuficientes para executar esta ação.' });
        }
        return next();
    };
}

function enforceJobOwnership(req, res, next) {
    if (!security.authEnabled) {
        return next();
    }
    const job = req.jobRecord;
    if (!job) {
        return res.status(404).json({ message: 'Job não encontrado.' });
    }
    const jobOrg = job.owner?.orgId;
    const requesterOrg = req.auth?.orgId || req.auth?.tenantId;
    if (jobOrg && requesterOrg && jobOrg !== requesterOrg) {
        return res.status(403).json({ message: 'Este job pertence a outra organização.' });
    }
    return next();
}

module.exports = {
    requireAuth,
    requireScopes,
    enforceJobOwnership,
    extractToken,
};
