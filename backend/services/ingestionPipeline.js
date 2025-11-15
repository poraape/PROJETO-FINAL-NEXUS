// backend/services/ingestionPipeline.js
// Centraliza a orquestração da etapa de ingestão multi-formato, garantindo
// validações determinísticas antes de qualquer chamada a LLM.

const extractor = require('./extractor');
const { buildProcessingMetrics } = require('./artifactUtils');
const logger = require('./logger').child({ module: 'ingestionPipeline' });

const STRUCTURED_EXTENSIONS = new Map([
    ['.xml', 'xml'],
    ['.json', 'json'],
    ['.csv', 'csv'],
    ['.tsv', 'csv'],
    ['.xlsx', 'planilha'],
    ['.xls', 'planilha'],
    ['.xlsm', 'planilha'],
    ['.txt', 'texto'],
    ['.pdf', 'pdf'],
    ['.zip', 'zip'],
]);

function normalizeName(name = '') {
    return name.toLowerCase().trim();
}

function detectEncodingFromSnippet(snippet) {
    if (!snippet || snippet.length === 0) {
        return { encoding: 'desconhecido', confidence: 0 };
    }
    const utf8Text = snippet.toString('utf8');
    if (!utf8Text.includes('\uFFFD')) {
        return { encoding: 'utf8', confidence: 0.95 };
    }
    const latinText = snippet.toString('latin1');
    const hasWeird = /�/.test(latinText);
    return {
        encoding: hasWeird ? 'binário' : 'latin1',
        confidence: hasWeird ? 0.2 : 0.7,
    };
}

function inferStructuredType(fileMeta = {}) {
    const name = normalizeName(fileMeta.originalName || fileMeta.name || '');
    const extension = Array.from(STRUCTURED_EXTENSIONS.keys()).find(ext => name.endsWith(ext));
    return extension ? STRUCTURED_EXTENSIONS.get(extension) : 'desconhecido';
}

function validateFileMeta(fileMeta, encodingInfo, duplicateMap) {
    const issues = [];
    const warnings = [];

    if (!fileMeta.size || fileMeta.size === 0) {
        issues.push('Arquivo sem conteúdo.');
    }
    if (!fileMeta.mimeType) {
        warnings.push('Tipo MIME não informado.');
    }
    if (duplicateMap.has(fileMeta.hash)) {
        warnings.push(`Conteúdo duplicado de ${duplicateMap.get(fileMeta.hash)}.`);
    } else {
        duplicateMap.set(fileMeta.hash, fileMeta.originalName || fileMeta.name || fileMeta.hash);
    }
    if (encodingInfo.encoding === 'binário') {
        warnings.push('Codificação não textual detectada, pode exigir OCR.');
    }

    const structuredType = inferStructuredType(fileMeta);
    if (structuredType === 'desconhecido') {
        warnings.push('Extensão não reconhecida. Conteúdo será tratado como texto genérico.');
    }

    return {
        hash: fileMeta.hash,
        name: fileMeta.originalName || fileMeta.name || fileMeta.hash,
        size: fileMeta.size || 0,
        mimeType: fileMeta.mimeType || 'desconhecido',
        structuredType,
        encoding: encodingInfo.encoding,
        encodingConfidence: encodingInfo.confidence,
        issues,
        warnings,
    };
}

function summarizeDataQuality(reports = []) {
    const totals = {
        files: reports.length,
        structured: 0,
        warnings: 0,
        errors: 0,
    };
    const encodingStats = {};

    reports.forEach(report => {
        if (report.structuredType && report.structuredType !== 'desconhecido') {
            totals.structured += 1;
        }
        totals.warnings += report.warnings.length;
        totals.errors += report.issues.length;
        encodingStats[report.encoding] = (encodingStats[report.encoding] || 0) + 1;
    });

    return { totals, encodingStats };
}

async function inspectFiles(filesMeta = [], storageService) {
    const duplicateMap = new Map();
    const fileReports = [];

    for (const fileMeta of filesMeta) {
        try {
            const snippet = await storageService.readFileSnippet(fileMeta.hash, 4096);
            const encodingInfo = detectEncodingFromSnippet(snippet);
            const report = validateFileMeta(fileMeta, encodingInfo, duplicateMap);
            fileReports.push(report);
        } catch (error) {
            logger.warn('[IngestionPipeline] Não foi possível analisar o arquivo.', {
                file: fileMeta?.originalName,
                error: error.message,
            });
            fileReports.push({
                hash: fileMeta.hash,
                name: fileMeta.originalName || fileMeta.hash,
                size: fileMeta.size || 0,
                mimeType: fileMeta.mimeType || 'desconhecido',
                structuredType: inferStructuredType(fileMeta),
                encoding: 'desconhecido',
                encodingConfidence: 0,
                issues: ['Falha ao ler trecho do arquivo'],
                warnings: [],
            });
        }
    }

    const { totals, encodingStats } = summarizeDataQuality(fileReports);
    return {
        reports: fileReports,
        summary: {
            generatedAt: new Date().toISOString(),
            files: fileReports,
            totals,
            encodingStats,
        },
    };
}

async function ingestFiles(filesMeta = [], storageService) {
    if (!Array.isArray(filesMeta) || filesMeta.length === 0) {
        return { artifacts: [], fileContentsForAnalysis: [], dataQualityReport: null, processingMetrics: null };
    }

    const inspectionStart = Date.now();
    const inspection = await inspectFiles(filesMeta, storageService);
    logger.info('[IngestionPipeline] Validação dos arquivos concluída.', {
        files: filesMeta.length,
        warnings: inspection.summary.totals.warnings,
        errors: inspection.summary.totals.errors,
    });

    const extractionStart = Date.now();
    const { artifacts, fileContentsForAnalysis } = await extractor.extractArtifactsForFiles(filesMeta, storageService);
    const processingMetrics = buildProcessingMetrics(artifacts, filesMeta);

    const timeline = [
        { step: 'inspection', durationMs: Date.now() - inspectionStart },
        { step: 'extraction', durationMs: Date.now() - extractionStart },
    ];

    return {
        artifacts,
        fileContentsForAnalysis,
        processingMetrics,
        dataQualityReport: inspection.summary,
        timeline,
    };
}

module.exports = {
    ingestFiles,
};
