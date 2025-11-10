const path = require('path');
const JSZip = require('jszip');
const PDFParser = require('pdf2json');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const { parse: parseCsv } = require('csv-parse/sync');
const crypto = require('crypto');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const { xml2json } = require('xml-js');
const fileType = require('file-type');
const artifactCache = require('./artifactCache');
const dataGovernance = require('./dataGovernance');

const TEXT_ENCODINGS = ['utf8', 'latin1', 'base64'];
const OCR_LANGUAGE = process.env.OCR_LANGUAGE || 'por';
const OCR_MIN_TEXT_LENGTH = 20;
const MAX_CHUNK_SIZE = 2200;
const ZIP_CONCURRENCY = 4;

async function runWithConcurrency(tasks, limit) {
    const executing = [];
    const results = [];
    for (const task of tasks) {
        const promise = task();
        results.push(promise);
        const clean = () => {
            const idx = executing.indexOf(promise);
            if (idx >= 0) executing.splice(idx, 1);
        };
        executing.push(promise);
        promise.finally(clean);
        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.allSettled(results);
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.log', '.rtf']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp']);
const SHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm', '.ods']);
const JSON_EXTENSIONS = new Set(['.json', '.geojson']);
const XML_EXTENSIONS = new Set(['.xml', '.xsd', '.xsl', '.wsdl']);
const CSV_EXTENSIONS = new Set(['.csv', '.tsv']);
const ARCHIVE_EXTENSIONS = new Set(['.zip']);

const CLASSIFICATION_RULES = [
    { category: 'docx', match: info => info.ext === '.docx' || info.normalizedName.endsWith('.docx') },
    { category: 'doc', match: info => info.ext === '.doc' || info.normalizedName.endsWith('.doc') },
    { category: 'pdf', match: info => info.mime === 'application/pdf' || info.ext === '.pdf' },
    { category: 'spreadsheet', match: info => SHEET_EXTENSIONS.has(info.ext) || info.mime.includes('spreadsheet') },
    { category: 'csv', match: info => CSV_EXTENSIONS.has(info.ext) || info.mime === 'text/csv' || info.mime.endsWith('+csv') },
    { category: 'json', match: info => JSON_EXTENSIONS.has(info.ext) || info.mime === 'application/json' },
    { category: 'xml', match: info => XML_EXTENSIONS.has(info.ext) || info.mime.includes('xml') },
    { category: 'zip', match: info => ARCHIVE_EXTENSIONS.has(info.ext) || info.mime === 'application/zip' },
    { category: 'image', match: info => info.mime.startsWith('image/') || IMAGE_EXTENSIONS.has(info.ext) },
    { category: 'text', match: info => info.mime.startsWith('text/') || TEXT_EXTENSIONS.has(info.ext) },
    { category: 'binary', match: () => true },
];

function bufferToString(buffer, encodings = TEXT_ENCODINGS) {
    if (!buffer) return '';
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const encodingList = Array.isArray(encodings) ? encodings : TEXT_ENCODINGS;
    for (const encoding of encodingList) {
        try {
            return data.toString(encoding);
        } catch (err) {
            // tenta próximo encoding
        }
    }
    return data.toString('base64');
}

function formatAsMarkdownTable(rows) {
    if (!rows || rows.length === 0) return '';
    const header = rows[0];
    const divider = header.map(() => '---');
    const body = rows.slice(1);
    const table = [header, divider, ...body];
    return table.map(row => `| ${row.join(' | ')} |`).join('\n');
}

function chunkText(text, size = MAX_CHUNK_SIZE) {
    if (!text) return [];
    const chunks = [];
    for (let i = 0; i < text.length; i += size) {
        chunks.push(text.substring(i, i + size));
    }
    return chunks;
}

function detectEntities(text) {
    if (!text) return { cnpjs: [], emails: [], monetaryValues: [] };
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
    const trimmed = text.trim().replace(/```json\n[\s\S]*?\n```/g, '[Conteúdo JSON]');
    if (trimmed.length <= maxLength) return trimmed;
    return `${trimmed.substring(0, maxLength)}…`;
}

function analyzeText(text) {
    const cleaned = (text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) {
        return { wordCount: 0, sentenceCount: 0, uniqueWords: 0, avgWordLength: 0 };
    }
    const words = cleaned.match(/\b[\p{L}\d_]+\b/gu) || [];
    const sentences = cleaned.split(/[.!?]+/).filter(segment => segment.trim().length);
    const avgWordLength = words.length
        ? words.reduce((sum, word) => sum + word.length, 0) / words.length
        : 0;

    return {
        wordCount: words.length,
        sentenceCount: sentences.length,
        uniqueWords: new Set(words.map(word => word.toLowerCase())).size,
        avgWordLength: Number(avgWordLength.toFixed(2)),
    };
}

async function detectFormat({ buffer, fileName, mimeType }) {
    const type = await fileType.fromBuffer(buffer);
    const normalizedName = (fileName || '').toLowerCase();
    const extension = (type?.ext ? `.${type.ext.toLowerCase()}` : path.extname(normalizedName)) || '';
    const mime = (type?.mime || mimeType || '').toLowerCase();

    const detection = {
        ext: extension,
        mime,
        normalizedName,
        source: type ? 'content' : 'meta',
        confidence: type ? 0.95 : 0.6,
    };

    const rule = CLASSIFICATION_RULES.find(({ match }) => match(detection));
    detection.category = rule ? rule.category : 'binary';
    detection.isArchive = detection.category === 'zip';
    return detection;
}

let tesseractWorker = null;

async function getTesseractWorker() {
    if (!tesseractWorker) {
        tesseractWorker = await Tesseract.createWorker(OCR_LANGUAGE);
    }
    return tesseractWorker;
}

async function extractWithOcr(buffer) {
    try {
        const worker = await getTesseractWorker();
        const preparedImage = await sharp(buffer).greyscale().sharpen().toFormat('png').toBuffer();
        const { data: { text } } = await worker.recognize(preparedImage);
        return text;
    } catch (error) {
        console.warn('[Extractor-OCR] Falha no processamento OCR:', error.message);
        return '';
    }
}

function parsePdf2JsonOutput(data) {
    if (!data || !data.Pages) return '';
    return data.Pages.map(page => {
        const texts = page.Texts.sort((a, b) => a.y - b.y || a.x - b.x);
        let pageText = '';
        let lastY = -1;
        texts.forEach(text => {
            if (lastY !== -1 && text.y > lastY) pageText += '\n';
            pageText += decodeURIComponent(text.R[0].T);
            lastY = text.y;
        });
        return pageText;
    }).join('\n\n--- Page Break ---\n\n');
}

async function extractFromPdfParser(buffer) {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser(this, 1);
        pdfParser.on('pdfParser_dataError', errData => {
            console.error('[Extractor-PDF] Erro no pdf2json:', errData.parserError);
            extractWithOcr(buffer).then(resolve).catch(reject);
        });
        pdfParser.on('pdfParser_dataReady', pdfData => {
            const text = parsePdf2JsonOutput(pdfData);
            if (!text || text.trim().length < OCR_MIN_TEXT_LENGTH) {
                extractWithOcr(buffer).then(resolve).catch(reject);
            } else {
                resolve(text);
            }
        });
        pdfParser.parseBuffer(buffer);
    });
}

async function extractFromPdf(buffer) {
    try {
        const { text } = await pdfParse(buffer);
        if (text && text.trim().length >= OCR_MIN_TEXT_LENGTH) {
            return text.trim();
        }
    } catch (error) {
        console.warn('[Extractor-PDF] `pdf-parse` falhou:', error.message);
    }
    return extractFromPdfParser(buffer);
}

async function extractFromDocx(buffer) {
    try {
        const { value } = await mammoth.extractRawText({ buffer });
        return value || '';
    } catch (error) {
        console.warn('[Extractor-DOCX] Falha ao parsear DOCX:', error.message);
        return bufferToString(buffer);
    }
}

async function extractFromDoc(buffer) {
    try {
        const { value } = await mammoth.extractRawText({ buffer });
        if (value && value.trim().length) return value;
    } catch (error) {
        console.warn('[Extractor-DOC] Falha ao extrair documento antigo:', error.message);
    }
    return bufferToString(buffer);
}

async function extractFromXlsx(buffer) {
    try {
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        return workbook.SheetNames.map(name => {
            const rows = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false });
            return `### Sheet: ${name}\n\n${formatAsMarkdownTable(rows)}`;
        }).join('\n\n');
    } catch (error) {
        console.warn('[Extractor-XLSX] Falha no parse de planilha:', error.message);
        return bufferToString(buffer);
    }
}

async function extractFromCsv(buffer) {
    try {
        const content = bufferToString(buffer, ['utf8', 'latin1']);
        const records = parseCsv(content, { skip_empty_lines: true });
        return formatAsMarkdownTable(records);
    } catch (error) {
        console.warn('[Extractor-CSV] Falha no parse de CSV:', error.message);
        return bufferToString(buffer);
    }
}

async function extractFromXml(buffer) {
    try {
        const xmlText = bufferToString(buffer);
        const jsonResult = xml2json(xmlText, { compact: true, spaces: 2 });
        return `\`\`\`json\n${jsonResult}\n\`\`\``;
    } catch (error) {
        console.warn('[Extractor-XML] Falha no parse de XML:', error.message);
        return bufferToString(buffer);
    }
}

async function extractFromJson(buffer) {
    try {
        const content = bufferToString(buffer);
        const parsed = JSON.parse(content);
        return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
    } catch (error) {
        console.warn('[Extractor-JSON] Conteúdo inválido, devolvendo texto cru:', error.message);
        return bufferToString(buffer);
    }
}

function extractBinaryFallback(buffer, detection) {
    const mime = detection?.mime || 'desconhecido';
    const base64 = bufferToString(buffer, ['base64']);
    return `Conteúdo binário (mime: ${mime}) codificado em base64 para garantir compatibilidade. \n${base64}`;
}

const formatHandlers = {
    pdf: extractFromPdf,
    docx: extractFromDocx,
    doc: extractFromDoc,
    spreadsheet: extractFromXlsx,
    csv: extractFromCsv,
    json: extractFromJson,
    xml: extractFromXml,
    image: extractWithOcr,
    text: bufferToString,
    binary: extractBinaryFallback,
};

async function buildArtifact({ buffer, hash, fileName, mimeType, size, detection: initialDetection }) {
    const detection = initialDetection || await detectFormat({ buffer, fileName, mimeType });
    const handler = formatHandlers[detection.category] || formatHandlers.binary;
    const rawText = await handler(buffer, detection);
    const governedText = dataGovernance.applyPolicies(rawText, { fileName, mimeType: detection.mime || mimeType });
    const entities = detectEntities(governedText);
    const summary = buildSummary(governedText);
    const chunks = chunkText(governedText);
    const metrics = analyzeText(governedText);

    return {
        hash,
        fileName,
        mimeType: detection.mime || mimeType,
        size,
        text: governedText,
        summary,
        chunkCount: chunks.length,
        chunks,
        entities,
        detection,
        metrics,
    };
}

async function extractFromZip(buffer, parentMeta) {
    const zip = await JSZip.loadAsync(buffer);
    const taskGenerators = Object.keys(zip.files)
        .map(entryName => zip.files[entryName])
        .filter(entry => !entry.dir)
        .map(entry => async () => {
            const entryBuffer = await entry.async('nodebuffer');
            const entryHash = crypto.createHash('sha256').update(entryBuffer).digest('hex');
            const cached = await artifactCache.get(entryHash);
            if (cached) {
                return cached.map(artifact => ({
                    ...artifact,
                    parentHash: parentMeta.hash,
                    parentName: parentMeta.fileName,
                }));
            }
            const detection = await detectFormat({
                buffer: entryBuffer,
                fileName: entryName.toLowerCase(),
                mimeType: '',
            });
            const artifact = await buildArtifact({
                buffer: entryBuffer,
                hash: entryHash,
                fileName: entryName,
                mimeType: detection.mime,
                size: entryBuffer.length,
                detection,
            });
            artifact.parentHash = parentMeta.hash;
            artifact.parentName = parentMeta.fileName;
            await artifactCache.set(entryHash, [artifact]);
            return [artifact];
        });

    const settled = await runWithConcurrency(taskGenerators, ZIP_CONCURRENCY);
    const artifacts = [];
    settled.forEach(result => {
        if (result.status === 'fulfilled') {
            artifacts.push(...result.value);
        } else {
            console.warn('[Extractor-ZIP] Falha ao extrair um entry:', result.reason);
        }
    });
    return artifacts;
}

async function extractArtifactsForFileMeta(fileMeta, storageService) {
    const cachedArtifacts = await artifactCache.get(fileMeta.hash);
    if (cachedArtifacts) return cachedArtifacts;

    const buffer = await storageService.readFileBuffer(fileMeta.hash);
    const originalFileName = fileMeta.originalName || fileMeta.name || '';
    const normalizedFileName = originalFileName.toLowerCase();
    const detection = await detectFormat({
        buffer,
        fileName: normalizedFileName,
        mimeType: (fileMeta.mimeType || '').toLowerCase(),
    });

    let artifacts;
    if (detection.category === 'zip') {
        artifacts = await extractFromZip(buffer, { hash: fileMeta.hash, fileName: originalFileName });
    } else {
        artifacts = [await buildArtifact({
            buffer,
            hash: fileMeta.hash,
            fileName: originalFileName,
            mimeType: fileMeta.mimeType,
            size: fileMeta.size,
            detection,
        })];
    }

    await artifactCache.set(fileMeta.hash, artifacts);
    return artifacts;
}

function cleanup() {
    if (tesseractWorker) {
        tesseractWorker.terminate();
        tesseractWorker = null;
    }
}

process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

module.exports = {
    extractArtifactsForFileMeta,
};
