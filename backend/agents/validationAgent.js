// backend/agents/validationAgent.js

const tools = require('../services/tools');

const CFOP_PATTERN = /\b([1-7]\d{3})\b/g;
const CFOP_CONTEXT_PATTERN = /CFOP[\s:=-]*([1-7]\d{3})/gi;
const CST_CONTEXT_PATTERN = /CST[\s:=-]*([0-9]{2,3})/gi;
const NCM_CONTEXT_PATTERN = /NCM[\s:=-]*([0-9]{4,8})/gi;

function parseCurrency(value) {
    if (!value || typeof value !== 'string') return null;
    const sanitized = value
        .replace(/[^0-9,.-]/g, '')
        .replace(/\.(?=\d{3}(?:\D|$))/g, '')
        .replace(',', '.');
    const number = parseFloat(sanitized);
    return Number.isFinite(number) ? number : null;
}

function parsePercentage(value) {
    if (!value) return null;
    const sanitized = value.toString().replace(/[^0-9,.-]/g, '').replace(',', '.');
    const number = parseFloat(sanitized);
    return Number.isFinite(number) ? number : null;
}

function unique(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

function extractAll(regex, text) {
    const results = [];
    if (!text) return results;
    let match;
    const clone = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
    while ((match = clone.exec(text)) !== null) {
        if (match[1]) {
            results.push(match[1]);
        } else if (match[0]) {
            results.push(match[0]);
        }
    }
    return results;
}

function analyseFiscalSignals(text = '') {
    const cfopsFromContext = extractAll(CFOP_CONTEXT_PATTERN, text);
    const cfopsGeneric = extractAll(CFOP_PATTERN, text);
    const cfops = unique([...cfopsFromContext, ...cfopsGeneric]);

    const csts = unique(extractAll(CST_CONTEXT_PATTERN, text));
    const ncms = unique(extractAll(NCM_CONTEXT_PATTERN, text));

    const baseMatch = text.match(/BASE\s*(?:DE)?\s*(?:C[ÁA]LCULO\s*)?(?:DO\s*)?ICMS\s*[:=-]?\s*([\d\.,]+)/i);
    const aliquotMatch = text.match(/AL[IÍ]QUOTA\s*(?:DO\s*)?ICMS\s*[:=-]?\s*([\d\.,]+)/i);
    const valueMatch = text.match(/VALOR\s*(?:DO\s*)?ICMS\s*[:=-]?\s*([\d\.,]+)/i);

    const baseValue = parseCurrency(baseMatch?.[1] || null);
    const aliquotValue = parsePercentage(aliquotMatch?.[1] || null);
    const icmsValue = parseCurrency(valueMatch?.[1] || null);

    let expectedValue = null;
    let difference = null;
    let isConsistent = null;

    if (typeof baseValue === 'number' && typeof aliquotValue === 'number') {
        expectedValue = parseFloat((baseValue * (aliquotValue / 100)).toFixed(2));
        if (typeof icmsValue === 'number') {
            difference = parseFloat(Math.abs(expectedValue - icmsValue).toFixed(2));
            isConsistent = difference <= Math.max(1, expectedValue * 0.02);
        }
    }

    const invalidCfops = cfops.filter(code => !/^[1-7]\d{3}$/.test(code));
    const invalidCsts = csts.filter(code => !/^\d{2,3}$/.test(code));

    const observations = [];
    if (cfops.length === 0) {
        observations.push('Documento sem CFOP identificado.');
    } else if (invalidCfops.length > 0) {
        observations.push(`CFOP(s) com formato inesperado: ${invalidCfops.join(', ')}`);
    }
    if (csts.length === 0) {
        observations.push('Documento sem CST identificado.');
    } else if (invalidCsts.length > 0) {
        observations.push(`CST(s) com formato inesperado: ${invalidCsts.join(', ')}`);
    }
    if (typeof baseValue === 'number' && typeof aliquotValue === 'number' && typeof icmsValue === 'number') {
        if (isConsistent === false) {
            observations.push('Valor de ICMS divergente da base x alíquota informada.');
        }
    } else if (typeof baseValue === 'number' || typeof aliquotValue === 'number' || typeof icmsValue === 'number') {
        observations.push('Informações de ICMS incompletas para validação determinística.');
    }

    return {
        cfops,
        csts,
        ncms,
        baseValue,
        aliquotValue,
        icmsValue,
        expectedValue,
        difference,
        isConsistent,
        observations,
        invalidCfops,
        invalidCsts,
    };
}

function buildFiscalChecks(artifacts = []) {
    const documents = artifacts.map(artifact => {
        const analysis = analyseFiscalSignals(artifact?.text || '');
        return {
            fileName: artifact?.fileName || 'desconhecido',
            cfops: analysis.cfops,
            csts: analysis.csts,
            ncms: analysis.ncms,
            icmsBase: analysis.baseValue,
            icmsRate: analysis.aliquotValue,
            icmsReported: analysis.icmsValue,
            icmsExpected: analysis.expectedValue,
            icmsDifference: analysis.difference,
            icmsConsistent: analysis.isConsistent,
            observations: analysis.observations,
            invalidCfops: analysis.invalidCfops,
            invalidCsts: analysis.invalidCsts,
        };
    });

    const summary = documents.reduce((acc, doc) => {
        acc.totalDocuments += 1;
        if ((doc.cfops || []).length === 0) acc.missingCfop += 1;
        if ((doc.csts || []).length === 0) acc.missingCst += 1;
        if ((doc.invalidCfops || []).length > 0) acc.invalidCfop += 1;
        if ((doc.invalidCsts || []).length > 0) acc.invalidCst += 1;
        if (doc.icmsConsistent === false) acc.icmsInconsistent += 1;
        if (doc.icmsConsistent === true) acc.icmsConsistent += 1;
        if (doc.observations.length > 0) acc.flaggedDocuments += 1;
        return acc;
    }, {
        totalDocuments: 0,
        missingCfop: 0,
        missingCst: 0,
        invalidCfop: 0,
        invalidCst: 0,
        icmsConsistent: 0,
        icmsInconsistent: 0,
        flaggedDocuments: 0,
    });

    return { summary, documents };
}

function register({ eventBus, updateJobStatus }) {
    eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
        if (taskName !== 'validation') return;

        try {
            const { fileContentsForAnalysis, artifacts = [] } = payload;
            await updateJobStatus(jobId, 1, 'in-progress', 'Ag. Validador: Executando validações cadastrais e fiscais...');

            const combinedContent = (Array.isArray(fileContentsForAnalysis) ? fileContentsForAnalysis : [])
                .map(f => f.content)
                .join(' ');

            const cnpjRegex = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
            const foundCnpjs = [...new Set(combinedContent.match(cnpjRegex) || [])];

            const validations = [];
            if (foundCnpjs.length > 0) {
                const rateLimitDelay = parseInt(process.env.BRASILAPI_DELAY_MS || '150', 10);
                for (const cnpj of foundCnpjs) {
                    try {
                        const result = await tools.cnpj_validation({ cnpj });
                        validations.push(result);
                    } catch (err) {
                        validations.push({ error: true, message: err.message, cnpj });
                        console.warn(`[ValidationAgent] Falha ao validar CNPJ ${cnpj}:`, err);
                    }
                    if (rateLimitDelay > 0) {
                        await new Promise(res => setTimeout(res, rateLimitDelay));
                    }
                }
            }

            const fiscalChecks = buildFiscalChecks(artifacts);
            const errors = validations.filter(v => v?.error);
            const infoParts = [];
            if (foundCnpjs.length > 0) {
                infoParts.push(`${validations.length} CNPJ(s) processados`);
                if (errors.length > 0) {
                    infoParts.push(`${errors.length} com erro`);
                }
            } else {
                infoParts.push('Nenhum CNPJ encontrado');
            }
            if (fiscalChecks.summary.flaggedDocuments > 0) {
                infoParts.push(`${fiscalChecks.summary.flaggedDocuments} documento(s) com alertas fiscais`);
            }

            await updateJobStatus(jobId, 1, 'completed', infoParts.join(' · '));

            const nextPayload = {
                ...payload,
                validations,
                fiscalChecks,
            };

            eventBus.emit('task:completed', {
                jobId,
                taskName,
                resultPayload: { validations, fiscalChecks },
                payload: nextPayload,
            });
        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na validação fiscal: ${error.message}` });
        }
    });
}

module.exports = { register };
