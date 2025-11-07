// backend/services/dataGovernance.js
/**
 * Simple, extensible governance layer for masking dados sensíveis
 * antes de persistirem ou serem indexados.
 * Em produção, este módulo pode integrar ferramentas como Presidio.
 */

const ENABLE_MASKING = process.env.DATA_GOVERNANCE_MASKING !== 'false';

const CNPJ_REGEX = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CPF_REGEX = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const EMAIL_REGEX = /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;

function mask(text, regex, label) {
    return text.replace(regex, match => `[${label}:${match.slice(-4)}]`);
}

function applyPolicies(text = '', metadata = {}) {
    if (!ENABLE_MASKING || !text) return text;
    let masked = text;
    masked = mask(masked, CNPJ_REGEX, 'CNPJ');
    masked = mask(masked, CPF_REGEX, 'CPF');
    masked = mask(masked, EMAIL_REGEX, 'EMAIL');
    return masked;
}

module.exports = {
    applyPolicies,
};
