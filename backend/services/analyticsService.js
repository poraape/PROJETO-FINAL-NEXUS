// backend/services/analyticsService.js
// Responsável por gerar estruturas analíticas determinísticas para consumo da UI e do chat.

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function sum(values = []) {
    return values.reduce((acc, value) => acc + toNumber(value), 0);
}

function groupBy(array = [], selector) {
    return array.reduce((acc, item) => {
        const key = selector(item);
        if (!key) return acc;
        acc.set(key, [...(acc.get(key) || []), item]);
        return acc;
    }, new Map());
}

function buildTimeSeries(job) {
    const documents = job?.result?.auditFindings?.documents || [];
    const uploadedFiles = job?.uploadedFiles || [];
    const fallbackDate = job?.createdAt || job?.result?.processingMetrics?.captureTimestamp;
    const fileIndex = new Map(uploadedFiles.map(file => [file.name, file]));

    const buckets = groupBy(documents, doc => {
        const meta = fileIndex.get(doc.fileName) || {};
        const timestamp = meta.ingestedAt || fallbackDate || new Date().toISOString();
        return String(timestamp).slice(0, 10);
    });

    const series = Array.from(buckets.entries()).map(([period, docs]) => ({
        period,
        documents: docs.length,
        totalValue: sum(docs.map(doc => doc.estimatedTotal)),
        fileNames: docs.map(doc => doc.fileName),
    }));

    if (series.length === 0 && uploadedFiles.length > 0) {
        return uploadedFiles.map(file => ({
            period: String(file.ingestedAt || fallbackDate || new Date().toISOString()).slice(0, 10),
            documents: 1,
            totalValue: 0,
            fileNames: [file.name],
        }));
    }

    return series.sort((a, b) => (a.period < b.period ? -1 : 1));
}

function buildCfopBreakdown(job) {
    const documents = job?.result?.classifications?.documents || [];
    const valuesByDoc = new Map((job?.result?.auditFindings?.documents || []).map(doc => [doc.fileName, toNumber(doc.estimatedTotal)]));
    const cfopMap = new Map();

    documents.forEach(doc => {
        (doc.cfops || ['Sem CFOP']).forEach(cfop => {
            const entry = cfopMap.get(cfop) || { label: cfop, value: 0, documents: 0, sources: new Set() };
            entry.value += valuesByDoc.get(doc.fileName) || 0;
            entry.documents += 1;
            entry.sources.add(doc.fileName);
            cfopMap.set(cfop, entry);
        });
    });

    return Array.from(cfopMap.values()).map(entry => ({
        label: entry.label,
        value: Number(entry.value.toFixed(2)),
        documents: entry.documents,
        sources: Array.from(entry.sources),
    })).sort((a, b) => b.value - a.value).slice(0, 8);
}

function buildCustomerBreakdown(job) {
    const documents = job?.result?.auditFindings?.documents || [];
    const breakdown = new Map();

    documents.forEach(doc => {
        const cnpj = (doc.detectedCnpjs && doc.detectedCnpjs[0]) || 'CNPJ não identificado';
        const entry = breakdown.get(cnpj) || { label: cnpj, value: 0, documents: 0, sources: new Set() };
        entry.value += toNumber(doc.estimatedTotal);
        entry.documents += 1;
        entry.sources.add(doc.fileName);
        breakdown.set(cnpj, entry);
    });

    return Array.from(breakdown.values()).map(entry => ({
        label: entry.label,
        value: Number(entry.value.toFixed(2)),
        documents: entry.documents,
        sources: Array.from(entry.sources),
    })).sort((a, b) => b.value - a.value).slice(0, 6);
}

function buildSourceMap(timeSeries = [], cfopBreakdown = [], customerBreakdown = []) {
    return {
        timeSeries: timeSeries.map(point => ({ period: point.period, files: point.fileNames || [] })),
        cfops: cfopBreakdown.map(entry => ({ cfop: entry.label, files: entry.sources || [] })),
        customers: customerBreakdown.map(entry => ({ customer: entry.label, files: entry.sources || [] })),
    };
}

function buildTotals(job) {
    const metrics = job?.result?.executiveSummary?.keyMetrics || {};
    const auditDocs = job?.result?.auditFindings?.documents || [];
    const fallbackDocuments = job?.result?.processingMetrics?.distinctDocuments || job?.uploadedFiles?.length || 0;

    return {
        documents: metrics.numeroDeDocumentosValidos || auditDocs.length || fallbackDocuments,
        nfeValue: metrics.valorTotalDasNfes || sum(auditDocs.map(doc => doc.estimatedTotal)),
        productsValue: metrics.valorTotalDosProdutos || 0,
        taxes: {
            icms: metrics.valorTotalDeICMS || 0,
            pis: metrics.valorTotalDePIS || 0,
            cofins: metrics.valorTotalDeCOFINS || 0,
            iss: metrics.valorTotalDeISS || 0,
        },
        auditFindings: job?.result?.auditFindings?.summary?.totalFindings || 0,
    };
}

function buildJobAnalytics(job) {
    if (!job) return null;
    const timeSeries = buildTimeSeries(job);
    const cfopBreakdown = buildCfopBreakdown(job);
    const customerBreakdown = buildCustomerBreakdown(job);

    return {
        ready: Boolean(job.result),
        generatedAt: new Date().toISOString(),
        totals: buildTotals(job),
        timeSeries,
        cfopBreakdown,
        customerBreakdown,
        dataQuality: job?.result?.dataQualityReport || null,
        sourceMap: buildSourceMap(timeSeries, cfopBreakdown, customerBreakdown),
    };
}

module.exports = {
    buildJobAnalytics,
};
