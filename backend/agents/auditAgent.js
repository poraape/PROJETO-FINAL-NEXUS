// backend/agents/auditAgent.js

const HIGH_VALUE_THRESHOLD = parseFloat(process.env.AUDIT_HIGH_VALUE_THRESHOLD || '100000');

function normalizeCnpj(value) {
    if (!value) return null;
    const digits = value.replace(/\D/g, '');
    return digits.length === 14 ? digits : null;
}

function parseCurrency(value) {
    if (!value || typeof value !== 'string') return null;
    const sanitized = value
        .replace(/[R$\s]/gi, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const number = parseFloat(sanitized);
    return Number.isFinite(number) ? number : null;
}

function buildValidationSummary(validations = []) {
    const details = [];
    let inactive = 0;
    let errors = 0;
    let active = 0;

    validations.forEach(entry => {
        if (!entry) return;
        if (entry.error) {
            errors += 1;
            details.push({
                cnpj: normalizeCnpj(entry.cnpj) || entry.cnpj || null,
                status: 'error',
                message: entry.message || 'Erro desconhecido durante a validação.',
            });
            return;
        }

        const descricao = String(entry.descricao_situacao_cadastral || entry.situacao_cadastral || '')
            .toUpperCase();
        const isActive = descricao.includes('ATIVA') || descricao === '02';
        if (isActive) {
            active += 1;
        } else {
            inactive += 1;
        }
        details.push({
            cnpj: normalizeCnpj(entry.cnpj) || entry.cnpj || entry?.estabelecimento?.cnpj || null,
            status: isActive ? 'active' : 'inactive',
            descricaoSituacao: entry.descricao_situacao_cadastral || entry.situacao_cadastral || null,
            razaoSocial: entry.razao_social || entry.nome_fantasia || null,
            regimeSimples: entry?.simples?.situacao || null,
        });
    });

    return {
        total: validations.length,
        active,
        inactive,
        errors,
        details,
        normalizedSet: new Set(details.map(item => normalizeCnpj(item.cnpj)).filter(Boolean)),
    };
}

function analyzeArtifacts(artifacts = [], validationSummary) {
    const documents = [];
    let totalEstimatedValue = 0;
    let totalFindings = 0;
    let totalMissingFields = 0;
    let highValueDocuments = 0;
    let icmsWithoutCfop = 0;
    let documentsWithUnvalidatedCnpj = 0;

    artifacts.forEach(artifact => {
        const text = (artifact?.text || '').toString();
        const entities = artifact?.entities || {};
        const cnpjs = Array.isArray(entities.cnpjs) ? entities.cnpjs : [];
        const monetaryValues = Array.isArray(entities.monetaryValues) ? entities.monetaryValues : [];

        const hasCfop = /CFOP\b/i.test(text);
        const hasCst = /CST\b/i.test(text);
        const hasNcm = /NCM\b/i.test(text);
        const hasIcms = /ICMS/i.test(text);
        const hasIpi = /\bIPI\b/i.test(text);
        const hasPis = /\bPIS\b/i.test(text);
        const hasCofins = /COFINS/i.test(text);

        const missingFields = [];
        if (!hasCfop) missingFields.push('CFOP');
        if (hasIcms && !hasCst) missingFields.push('CST');
        if (!hasNcm) missingFields.push('NCM');
        if (hasIcms && !hasPis) missingFields.push('PIS');
        if (hasIcms && !hasCofins) missingFields.push('COFINS');

        const numericValues = monetaryValues
            .map(parseCurrency)
            .filter(value => value !== null && value >= 0)
            .sort((a, b) => b - a);

        const estimatedTotal = numericValues.length > 0 ? numericValues[0] : null;
        if (typeof estimatedTotal === 'number') {
            totalEstimatedValue += estimatedTotal;
        }

        const findings = [];
        if (missingFields.length > 0) {
            findings.push(`Campos ausentes: ${missingFields.join(', ')}`);
        }

        if (hasIcms && !hasCfop) {
            findings.push('Menção a ICMS sem referência explícita a CFOP.');
            icmsWithoutCfop += 1;
        }

        const normalizedCnpjs = cnpjs
            .map(normalizeCnpj)
            .filter(Boolean);
        const unvalidated = normalizedCnpjs.filter(cnpj => !validationSummary.normalizedSet.has(cnpj));
        if (unvalidated.length > 0) {
            findings.push(`CNPJ(s) sem validação prévia: ${unvalidated.join(', ')}`);
            documentsWithUnvalidatedCnpj += 1;
        }

        if (estimatedTotal !== null && estimatedTotal >= HIGH_VALUE_THRESHOLD && !hasIcms) {
            findings.push('Documento de alto valor sem menção a ICMS.');
        }

        if (estimatedTotal !== null && estimatedTotal >= HIGH_VALUE_THRESHOLD) {
            highValueDocuments += 1;
        }

        totalFindings += findings.length;
        totalMissingFields += missingFields.length;

        documents.push({
            fileName: artifact.fileName,
            detectedCnpjs: normalizedCnpjs,
            missingFields,
            hasIcms,
            hasIpi,
            hasPis,
            hasCofins,
            estimatedTotal,
            findings,
            topMonetaryValues: numericValues.slice(0, 5),
        });
    });

    return {
        documents,
        totalEstimatedValue,
        totalFindings,
        totalMissingFields,
        highValueDocuments,
        icmsWithoutCfop,
        documentsWithUnvalidatedCnpj,
    };
}

function buildRecommendations({
    totalMissingFields,
    validationSummary,
    icmsWithoutCfop,
    highValueDocuments,
    documentsWithUnvalidatedCnpj,
}) {
    const recommendations = [];

    if (totalMissingFields > 0) {
        recommendations.push('Completar campos fiscais ausentes (CFOP, CST, NCM, PIS, COFINS) antes da escrituração.');
    }
    if (validationSummary.inactive > 0 || validationSummary.errors > 0) {
        recommendations.push('Rever cadastros de fornecedores com CNPJ inativo ou inválido e solicitar atualização documental.');
    }
    if (icmsWithoutCfop > 0) {
        recommendations.push('Validar classificação de CFOP para notas com destaque de ICMS a fim de evitar glosas.');
    }
    if (highValueDocuments > 0) {
        recommendations.push('Priorizar conferência manual dos documentos de alto valor para confirmar base de cálculo e impostos.');
    }
    if (documentsWithUnvalidatedCnpj > 0) {
        recommendations.push('Executar validação cadastral complementar para CNPJs detectados que não retornaram da BrasilAPI.');
    }

    if (recommendations.length === 0) {
        recommendations.push('Nenhum alerta crítico identificado. Manter monitoramento contínuo das próximas cargas.');
    }

    return recommendations;
}

function calculateRiskScore({ totalMissingFields, validationSummary, icmsWithoutCfop, highValueDocuments, documentsWithUnvalidatedCnpj, totalFindings }) {
    let score = 100;
    score -= totalMissingFields * 4;
    score -= validationSummary.errors * 12;
    score -= validationSummary.inactive * 10;
    score -= icmsWithoutCfop * 10;
    score -= highValueDocuments * 6;
    score -= documentsWithUnvalidatedCnpj * 8;
    score -= totalFindings * 2;

    if (score < 0) score = 0;
    if (score > 100) score = 100;

    let riskLevel = 'Baixo';
    if (score < 55) {
        riskLevel = 'Alto';
    } else if (score < 80) {
        riskLevel = 'Médio';
    }

    return { score, riskLevel };
}

function register({ eventBus, updateJobStatus, logger }) {
    const auditLogger = logger?.child ? logger.child({ agent: 'audit' }) : console;

    eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
        if (taskName !== 'audit') return;
        try {
            await updateJobStatus(jobId, 2, 'in-progress', 'Ag. Auditor: Consolidando verificações fiscais...');

            const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
            const validations = Array.isArray(payload?.validations) ? payload.validations : [];

            const validationSummary = buildValidationSummary(validations);
            const artifactSummary = analyzeArtifacts(artifacts, validationSummary);
            const risk = calculateRiskScore({ ...artifactSummary, validationSummary });
            const recommendations = buildRecommendations({ ...artifactSummary, validationSummary });

            const alerts = [];
            if (validationSummary.errors > 0) {
                alerts.push(`${validationSummary.errors} CNPJ(s) retornaram erro durante a consulta da BrasilAPI.`);
            }
            if (validationSummary.inactive > 0) {
                alerts.push(`${validationSummary.inactive} CNPJ(s) com situação cadastral inativa.`);
            }
            if (artifactSummary.icmsWithoutCfop > 0) {
                alerts.push(`Foram detectadas ${artifactSummary.icmsWithoutCfop} nota(s) com ICMS sem CFOP correspondente.`);
            }
            if (artifactSummary.highValueDocuments > 0) {
                alerts.push(`${artifactSummary.highValueDocuments} documento(s) com valores acima de R$ ${HIGH_VALUE_THRESHOLD.toLocaleString('pt-BR')} exigem atenção adicional.`);
            }

            const auditFindings = {
                summary: {
                    documentsProcessed: artifactSummary.documents.length,
                    totalEstimatedValue: Number(artifactSummary.totalEstimatedValue.toFixed(2)),
                    totalFindings: artifactSummary.totalFindings,
                    totalMissingFields: artifactSummary.totalMissingFields,
                    highValueDocuments: artifactSummary.highValueDocuments,
                    documentsWithUnvalidatedCnpj: artifactSummary.documentsWithUnvalidatedCnpj,
                    riskScore: risk.score,
                    riskLevel: risk.riskLevel,
                },
                validations: validationSummary,
                documents: artifactSummary.documents,
                alerts,
                recommendations,
            };

            auditLogger.info('audit_completed', {
                jobId,
                documentsProcessed: auditFindings.summary.documentsProcessed,
                riskScore: auditFindings.summary.riskScore,
                riskLevel: auditFindings.summary.riskLevel,
                findings: auditFindings.summary.totalFindings,
            });

            const infoMessage = auditFindings.summary.totalFindings > 0
                ? `Auditoria concluída: ${auditFindings.summary.totalFindings} alerta(s) catalogado(s).`
                : 'Auditoria concluída sem alertas críticos.';
            await updateJobStatus(jobId, 2, 'completed', infoMessage);

            const nextPayload = { ...payload, auditFindings };
            eventBus.emit('task:completed', {
                jobId,
                taskName,
                resultPayload: { auditFindings },
                payload: nextPayload,
            });
        } catch (error) {
            auditLogger.error('audit_failed', { jobId, error });
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na auditoria: ${error.message}` });
        }
    });
}

module.exports = { register };
