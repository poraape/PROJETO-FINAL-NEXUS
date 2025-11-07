// backend/services/extractor.js
const JSZip = require('jszip');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const { parse: parseCsv } = require('csv-parse/sync');
const crypto = require('crypto');
const artifactCache = require('./artifactCache');
const dataGovernance = require('./dataGovernance');

const TEXT_ENCODINGS = ['utf8', 'latin1', 'base64'];

function bufferToString(buffer, encodings = TEXT_ENCODINGS) {
    if (!buffer) return '';
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    for (const encoding of encodings) {
        try {
            return data.toString(encoding);
        } catch (err) {
            continue;
        }
    }
    return data.toString('utf8');
}

function chunkText(text, size = 2000) {
    if (!text) return [];
    const chunks = [];
    for (let i = 0; i < text.length; i += size) {
        chunks.push(text.substring(i, i + size));
    }
    return chunks;
}

function detectEntities(text) {
    if (!text) {
        return {
            cnpjs: [],
            emails: [],
            monetaryValues: [],
        };
    }
    const cnpjRegex = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
    const emailRegex = /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;
    const moneyRegex = /R?\$ ?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g;
    return {
        cnpjs: Array.from(new Set(text.match(cnpjRegex) || [])),
        emails: Array.from(new Set(text.match(emailRegex) || [])),
        monetaryValues: Array.from(new Set(text.match(moneyRegex) || [])),
    };
}

function buildSummary(text, maxLength = 500) {
    if (!text) return '';
    const trimmed = text.trim();
    if (trimmed.length <= maxLength) return trimmed;
    return `${trimmed.substring(0, maxLength)}…`;
}

async function extractFromPdf(buffer) {
    try {
        const result = await pdfParse(buffer);
        return result?.text || '';
    } catch {
        return bufferToString(buffer);
    }
}

async function extractFromDocx(buffer) {
    try {
        const { value } = await mammoth.extractRawText({ buffer });
        return value || '';
    } catch {
        return bufferToString(buffer);
    }
}

async function extractFromXlsx(buffer) {
    try {
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheets = workbook.SheetNames.map(name => ({
            sheet: name,
            rows: xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false }),
        }));
        return sheets
            .map(sheet => {
                const rows = sheet.rows
                    .map(row => row.filter(cell => cell !== undefined && cell !== null).join('\t'))
                    .filter(line => line.length > 0)
                    .join('\n');
                return `# Sheet: ${sheet.sheet}\n${rows}`;
            })
            .join('\n\n');
    } catch {
        return bufferToString(buffer);
    }
}

async function extractFromCsv(buffer) {
    try {
        const content = bufferToString(buffer, ['utf8', 'latin1']);
        const records = parseCsv(content, { skip_empty_lines: true });
        return records.map(row => row.join('\t')).join('\n');
    } catch {
        return bufferToString(buffer);
    }
}

async function extractFromJson(buffer) {
    try {
        const content = bufferToString(buffer);
        const parsed = JSON.parse(content);
        return JSON.stringify(parsed, null, 2);
    } catch {
        return bufferToString(buffer);
    }
}

async function extractGeneric(buffer) {
    return bufferToString(buffer);
}

async function buildArtifact({ buffer, hash, fileName, mimeType, size }) {
    let text = '';
    const lowerName = (fileName || '').toLowerCase();
    const lowerMime = (mimeType || '').toLowerCase();

    if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) {
        text = await extractFromPdf(buffer);
    } else if (lowerMime.includes('word') || lowerName.endsWith('.docx')) {
        text = await extractFromDocx(buffer);
    } else if (lowerMime.includes('spreadsheet') || lowerName.endsWith('.xlsx')) {
        text = await extractFromXlsx(buffer);
    } else if (lowerMime.includes('csv') || lowerName.endsWith('.csv')) {
        text = await extractFromCsv(buffer);
    } else if (lowerMime.includes('json') || lowerName.endsWith('.json')) {
        text = await extractFromJson(buffer);
    } else if (lowerMime.includes('xml') || lowerName.endsWith('.xml')) {
        text = bufferToString(buffer);
    } else if (lowerMime.startsWith('text/') || lowerName.endsWith('.txt')) {
        text = bufferToString(buffer);
    } else {
        text = buffer.toString('base64');
    }

    const governedText = dataGovernance.applyPolicies(text, { fileName, mimeType });
    const entities = detectEntities(governedText);
    const summary = buildSummary(governedText);
    const chunks = chunkText(governedText);

    return {
        hash,
        fileName,
        mimeType,
        size,
        text: governedText,
        summary,
        chunkCount: chunks.length,
        chunks,
        entities,
    };
}

async function extractFromZip(buffer, parentMeta) {
    const zip = await JSZip.loadAsync(buffer);
    const artifacts = [];
    for (const entryName of Object.keys(zip.files)) {
        const entry = zip.files[entryName];
        if (entry.dir) continue;
        const entryBuffer = await entry.async('nodebuffer');
        const entryHash = crypto.createHash('sha256').update(entryBuffer).digest('hex');
        const cached = await artifactCache.get(entryHash);
        if (cached) {
            artifacts.push(...cached.map(artifact => ({ ...artifact, parentHash: parentMeta.hash, parentName: parentMeta.fileName })));
            continue;
        }
        const artifact = await buildArtifact({
            buffer: entryBuffer,
            hash: entryHash,
            fileName: entryName,
            mimeType: '',
            size: entryBuffer.length,
        });
        artifact.parentHash = parentMeta.hash;
        artifact.parentName = parentMeta.fileName;
        artifacts.push(artifact);
        await artifactCache.set(entryHash, [artifact]);
    }
    return artifacts;
}

async function extractArtifactsForFileMeta(fileMeta, storageService) {
    const cachedArtifacts = await artifactCache.get(fileMeta.hash);
    if (cachedArtifacts) {
        return cachedArtifacts;
    }
    const buffer = await storageService.readFileBuffer(fileMeta.hash);
    if ((fileMeta.mimeType || '').toLowerCase() === 'application/zip' || (fileMeta.fileName || '').toLowerCase().endsWith('.zip')) {
        const artifacts = await extractFromZip(buffer, {
            hash: fileMeta.hash,
            fileName: fileMeta.originalName || fileMeta.name,
        });
        await artifactCache.set(fileMeta.hash, artifacts);
        return artifacts;
    }

    const artifact = await buildArtifact({
        buffer,
        hash: fileMeta.hash,
        fileName: fileMeta.originalName || fileMeta.name,
        mimeType: fileMeta.mimeType,
        size: fileMeta.size,
    });
    await artifactCache.set(fileMeta.hash, [artifact]);
    return [artifact];
}

module.exports = {
    extractArtifactsForFileMeta,
};
