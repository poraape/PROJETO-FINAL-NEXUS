// backend/agents/classificationAgent.js

const HIGH_VALUE_THRESHOLD = parseFloat(process.env.AUDIT_HIGH_VALUE_THRESHOLD || '100000');

const OPERATION_TYPES = ['compra', 'venda', 'serviço', 'desconhecido'];
const SECTORS = ['agronegócio', 'indústria', 'varejo', 'transporte', 'outros'];
const RISK_LEVELS = ['Baixo', 'Médio', 'Alto'];

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function inferOperationFromCfop(cfops = []) {
    if (!cfops.length) return null;
    if (cfops.some(code => /^5|^6/.test(code))) return 'venda';
    if (cfops.some(code => /^1|^2/.test(code))) return 'compra';
    if (cfops.some(code => /^3|^7/.test(code))) return 'serviço';
    return null;
}

function inferOperationFromText(text = '') {
    const lower = text.toLowerCase();
    if (/prestação\s+de\s+serviço|servi[cç]o/.test(lower)) return 'serviço';
    if (/venda|sa[ií]da/.test(lower)) return 'venda';
    if (/compra|entrada/.test(lower)) return 'compra';
    return null;
}

function inferSectorFromNcm(ncms = []) {
    for (const code of ncms) {
        if (/^(0[1-3])/.test(code)) return 'agronegócio';
        if (/^(84|85|86)/.test(code)) return 'indústria';
        if (/^(87|88|89|90)/.test(code)) return 'transporte';
        if (/^(39|48|49|64)/.test(code)) return 'varejo';
    }
    return null;
}

function inferSectorFromText(text = '') {
    const lower = text.toLowerCase();
    if (/fazenda|agro|safra|gr[aã]o/.test(lower)) return 'agronegócio';
    if (/f[aá]brica|industrial|produção/.test(lower)) return 'indústria';
    if (/loja|varejo|atacado/.test(lower)) return 'varejo';
    if (/transporte|log[ií]stica|frete/.test(lower)) return 'transporte';
    return null;
}

function normaliseNcms(text = '') {
    const matches = text.match(/NCM[\s:=-]*([0-9]{4,8})/gi) || [];
    return Array.from(new Set(matches.map(match => {
        const codeMatch = /([0-9]{4,8})/.exec(match);
        return codeMatch ? codeMatch[1] : null;
    }).filter(Boolean)));
}

function aggregateIssues({ auditDoc, fiscalDoc }) {
    const issues = [];
    if (auditDoc) {
        if (Array.isArray(auditDoc.missingFields) && auditDoc.missingFields.length > 0) {
            issues.push(`Campos pendentes: ${auditDoc.missingFields.join(', ')}`);
        }
        if (Array.isArray(auditDoc.findings) && auditDoc.findings.length > 0) {
            issues.push(...auditDoc.findings);
        }
    }
    if (fiscalDoc && Array.isArray(fiscalDoc.observations) && fiscalDoc.observations.length > 0) {
        issues.push(...fiscalDoc.observations);
    }
    return Array.from(new Set(issues));
}

function calculateRisk({ auditDoc, fiscalDoc }) {
    let score = 0;
    const drivers = [];

    if (auditDoc) {
        const findingsCount = (auditDoc.findings || []).length;
        if (findingsCount > 0) {
            score += findingsCount * 3;
            drivers.push(`${findingsCount} alerta(s) de auditoria`);
        }
        const missing = (auditDoc.missingFields || []).length;
        if (missing > 0) {
            score += missing * 2;
            drivers.push(`${missing} campo(s) fiscal(is) ausente(s)`);
        }
        if (auditDoc.estimatedTotal && auditDoc.estimatedTotal >= HIGH_VALUE_THRESHOLD) {
            score += 3;
            drivers.push('Documento de alto valor');
        }
    }

    if (fiscalDoc) {
        if (fiscalDoc.icmsConsistent === false) {
            score += 6;
            drivers.push('ICMS divergente da base informada');
        }
        if ((fiscalDoc.cfops || []).length === 0) {
            score += 2;
            drivers.push('Sem CFOP identificado');
        }
        if ((fiscalDoc.csts || []).length === 0) {
            score += 2;
            drivers.push('Sem CST identificado');
        }
    }

    let level = 'Baixo';
    if (score >= 10) {
        level = 'Alto';
    } else if (score >= 5) {
        level = 'Médio';
    }

    return { level, score, drivers };
}

function buildSummary(documents) {
    const summary = {
        totalDocuments: documents.length,
        porTipoOperacao: { compra: 0, venda: 0, serviço: 0, desconhecido: 0 },
        porSetor: { 'agronegócio': 0, 'indústria': 0, 'varejo': 0, 'transporte': 0, 'outros': 0 },
        porRisco: { Baixo: 0, Médio: 0, Alto: 0 },
        documentsWithPendingIssues: 0,
    };

    documents.forEach(doc => {
        summary.porTipoOperacao[doc.tipoOperacao] += 1;
        summary.porSetor[doc.setor] += 1;
        summary.porRisco[doc.riskLevel] += 1;
        if (doc.issues.length > 0) {
            summary.documentsWithPendingIssues += 1;
        }
    });

    const recommendations = [];
    if (summary.porRisco.Alto > 0) {
        recommendations.push('Priorizar revisão manual dos documentos classificados com risco alto.');
    }
    if (summary.documentsWithPendingIssues > 0) {
        recommendations.push('Resolver pendências de campos fiscais antes da escrituração.');
    }
    if (summary.porTipoOperacao.compra > summary.porTipoOperacao.venda) {
        recommendations.push('Avaliar créditos fiscais das operações de compra destacadas.');
    }
    if (recommendations.length === 0) {
        recommendations.push('Nenhuma pendência crítica encontrada na classificação fiscal.');
    }

    summary.recommendations = recommendations;
    return summary;
}

function register({ eventBus, updateJobStatus }) {
    eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
        if (taskName !== 'classification') return;
        try {
            await updateJobStatus(jobId, 3, 'in-progress', 'Ag. Classificador: Derivando contexto fiscal por documento...');

            const artifacts = ensureArray(payload?.artifacts);
            const fiscalChecks = payload?.fiscalChecks || { documents: [] };
            const auditFindings = payload?.auditFindings || { documents: [] };
            const validationSummary = payload?.validations || [];

            const fiscalDocsByName = new Map();
            ensureArray(fiscalChecks.documents).forEach(doc => {
                fiscalDocsByName.set(doc.fileName, doc);
            });

            const auditDocsByName = new Map();
            ensureArray(auditFindings.documents).forEach(doc => {
                auditDocsByName.set(doc.fileName, doc);
            });

            const documents = artifacts.map(artifact => {
                const fileName = artifact?.fileName || 'desconhecido';
                const text = artifact?.text || '';
                const fiscalDoc = fiscalDocsByName.get(fileName) || {};
                const auditDoc = auditDocsByName.get(fileName) || {};

                const cfops = ensureArray(fiscalDoc.cfops);
                const ncms = ensureArray(fiscalDoc.ncms).length > 0 ? ensureArray(fiscalDoc.ncms) : normaliseNcms(text);

                let tipoOperacao = inferOperationFromCfop(cfops) || inferOperationFromText(text) || 'desconhecido';
                if (!OPERATION_TYPES.includes(tipoOperacao)) {
                    tipoOperacao = 'desconhecido';
                }

                let setor = inferSectorFromNcm(ncms) || inferSectorFromText(text) || 'outros';
                if (!SECTORS.includes(setor)) {
                    setor = 'outros';
                }

                const risk = calculateRisk({ auditDoc, fiscalDoc });
                const issues = aggregateIssues({ auditDoc, fiscalDoc });

                if (auditDoc?.detectedCnpjs?.length) {
                    const unvalidated = ensureArray(auditDoc.detectedCnpjs).filter(cnpj =>
                        !validationSummary.some(result => !result?.error && (result?.cnpj === cnpj || result?.estabelecimento?.cnpj === cnpj))
                    );
                    if (unvalidated.length > 0) {
                        issues.push(`CNPJ(s) sem confirmação cadastral: ${unvalidated.join(', ')}`);
                        risk.drivers.push('CNPJ sem confirmação cadastral');
                        risk.level = risk.level === 'Alto' ? 'Alto' : 'Médio';
                    }
                }

                return {
                    fileName,
                    tipoOperacao,
                    setor,
                    riskLevel: risk.level,
                    riskScore: risk.score,
                    riskDrivers: risk.drivers,
                    issues,
                    cfops,
                    ncms,
                    findings: ensureArray(auditDoc.findings),
                    missingFields: ensureArray(auditDoc.missingFields),
                    estimatedTotal: auditDoc?.estimatedTotal ?? null,
                };
            });

            const summary = buildSummary(documents);
            const infoMessage = `${documents.length} documento(s) classificados · ${summary.porRisco.Alto} alto risco · ${summary.documentsWithPendingIssues} pendência(s)`;

            await updateJobStatus(jobId, 3, 'completed', infoMessage);

            const classifications = { summary, documents };
            const nextPayload = { ...payload, classifications };

            eventBus.emit('task:completed', {
                jobId,
                taskName,
                resultPayload: { classifications },
                payload: nextPayload,
            });
        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na classificação fiscal: ${error.message}` });
        }
    });
}

module.exports = { register };
