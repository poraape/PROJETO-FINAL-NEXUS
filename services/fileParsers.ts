import { xml2json } from 'xml-js';
import Papa from 'papaparse';
import * as pdfjsLib from 'pdfjs-dist';
import Tesseract from 'tesseract.js';

// Configure worker for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.3.136/build/pdf.worker.min.mjs`;

interface ParsedFileResult {
  type: 'text' | 'binary';
  content: string; // For 'text', this will be the processed content
}

// --- Summarizer Functions ---

/**
 * Creates a structured summary from a JSON object representing an NFe.
 * @param nfeData The full JSON object of the NFe.
 * @returns A compact summary object.
 */
const resumirNFe = (nfeData: any) => {
    const nfe = nfeData.n_fe_proc?.n_fe || nfeData.nfe || nfeData;
    const infNFe = nfe?.inf_n_fe;
    if (!infNFe) return { erro: "Estrutura da NF-e não reconhecida." };

    return {
        resumo_nfe: {
            ide: {
                cUF: infNFe.ide?.c_uf,
                natOp: infNFe.ide?.nat_op,
                mod: infNFe.ide?.mod,
                serie: infNFe.ide?.serie,
                nNF: infNFe.ide?.n_nf,
                dhEmi: infNFe.ide?.dh_emi,
            },
            emit: {
                CNPJ: infNFe.emit?.cnpj,
                xNome: infNFe.emit?.x_nome,
                enderEmit: { UF: infNFe.emit?.ender_emit?.uf }
            },
            dest: {
                CNPJ: infNFe.dest?.cnpj || infNFe.dest?.cpf,
                xNome: infNFe.dest?.x_nome,
                enderDest: { UF: infNFe.dest?.ender_dest?.uf }
            },
            total: { ICMSTot: infNFe.total?.icms_tot }
        }
    };
};

/**
 * Creates a statistical summary of CSV data.
 * @param data The array of objects parsed from the CSV.
 * @param fileName The name of the original file.
 * @returns A compact summary object with statistics.
 */
const resumirCSV = (data: any[], fileName: string) => {
    const totalRows = data.length;
    const sample = totalRows > 500 ? data.slice(0, 500) : data;

    if (sample.length === 0) {
        return { resumo_csv: { file_name: fileName, total_rows: 0, sample_rows: 0, columns: [], numeric_aggregates: {} } };
    }

    const columns = Object.keys(sample[0]);
    const numericColumns = columns.filter(col => typeof sample[0][col] === 'number');
    
    const aggregates = numericColumns.reduce((acc, col) => {
        const values = data.map(row => row[col]).filter(v => typeof v === 'number');
        if (values.length > 0) {
            const sum = values.reduce((a, b) => a + b, 0);
            const average = sum / values.length;
            acc[col] = { sum: sum.toFixed(2), average: average.toFixed(2) };
        }
        return acc;
    }, {} as {[key: string]: any});

    return {
        resumo_csv: {
            file_name: fileName,
            total_rows: totalRows,
            sample_rows: sample.length,
            columns,
            numeric_aggregates: aggregates,
            // We don't include sample_data in the final payload to save tokens
        }
    };
};

/**
 * Summarizes long PDF text by truncating it.
 * @param text The full text extracted from the PDF.
 * @returns A truncated version of the text.
 */
const resumirPDF = (text: string): string => {
    const MAX_LENGTH = 10000;
    if (text.length <= MAX_LENGTH) return text;
    return text.substring(0, MAX_LENGTH);
};


// --- Helper Functions ---

const compactText = (text: string): string => {
    return text.replace(/(\r\n|\n|\r)/gm, " ").replace(/\s{2,}/g, ' ');
};

const simplifyJson = (obj: any): any => {
    if (Array.isArray(obj)) {
        return obj.map(v => simplifyJson(v));
    } else if (obj !== null && obj.constructor === Object) {
        const keys = Object.keys(obj);
        if (keys.length === 1 && keys[0] === '_text') {
            return obj._text;
        }
        if (keys.length === 0) {
            return null;
        }
        return keys.reduce((acc, key) => {
            const simplifiedValue = simplifyJson(obj[key]);
            if(simplifiedValue !== null) {
                acc[key] = simplifiedValue;
            }
            return acc;
        }, {} as { [key: string]: any });
    }
    return obj;
};

const keysToSnakeCase = (obj: any): any => {
    if (Array.isArray(obj)) {
        return obj.map(v => keysToSnakeCase(v));
    } else if (obj !== null && obj.constructor === Object) {
        return Object.keys(obj).reduce((result, key) => {
            const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            result[snakeKey] = keysToSnakeCase(obj[key]);
            return result;
        }, {} as { [key: string]: any });
    }
    return obj;
};

// --- Main Parser Functions ---

const parseXml = (xmlContent: string, fileName: string): string => {
  try {
    const jsonResult = xml2json(xmlContent, { compact: true, spaces: 2 });
    const jsonObj = JSON.parse(jsonResult);
    const simplifiedObj = simplifyJson(jsonObj);
    const snakeCaseObj = keysToSnakeCase(simplifiedObj);
    
    const fullJsonString = JSON.stringify(snakeCaseObj, null, 2);
    const originalSize = fullJsonString.length;

    if (originalSize > 50000) {
        console.log(`[Parser: ${fileName}] XML content is large (${originalSize} chars), creating summary.`);
        const summaryObj = resumirNFe(snakeCaseObj);
        const summarizedContent = `<!-- O CONTEÚDO XML FOI SUMARIZADO PARA OTIMIZAÇÃO -->\n${JSON.stringify(summaryObj, null, 2)}`;
        const finalSize = summarizedContent.length;
        console.log(`[Parser: ${fileName}] Content summarized. Final size: ${finalSize} chars.`);
        return summarizedContent;
    }

    const finalContent = `<!-- CONTEÚDO XML CONVERTIDO PARA JSON PADRÃO (SNAKE_CASE) -->\n${fullJsonString}`;
    return finalContent;
  } catch (e) {
    console.warn(`[Parser: ${fileName}] Falha ao converter XML. Enviando como texto plano.`, e);
    return compactText(xmlContent);
  }
};

const parseSped = (spedContent: string, fileName: string): string => {
    try {
        const originalSize = spedContent.length;
        let summaryObj;

        if (originalSize > 50000) {
             console.log(`[Parser: ${fileName}] SPED content is large (${originalSize} chars), creating summary.`);
             const lines = spedContent.split('\n');
             const summary: { [key: string]: any } = {
                bloco_0: [], totais_bloco_c: { count: 0, sample: [] },
                totais_bloco_h: { count: 0, sample: [] }, totais_bloco_k: { count: 0, sample: [] },
             };
             for (const line of lines) {
                 if (!line.startsWith('|')) continue;
                 const fields = line.split('|');
                 const recordType = fields[1];
                 if (recordType?.startsWith('0')) { summary.bloco_0.push(fields); } 
                 else if (recordType?.startsWith('C')) { summary.totais_bloco_c.count++; if(summary.totais_bloco_c.sample.length < 5) summary.totais_bloco_c.sample.push(fields); } 
                 else if (recordType?.startsWith('H')) { summary.totais_bloco_h.count++; if(summary.totais_bloco_h.sample.length < 5) summary.totais_bloco_h.sample.push(fields); } 
                 else if (recordType?.startsWith('K')) { summary.totais_bloco_k.count++; if(summary.totais_bloco_k.sample.length < 5) summary.totais_bloco_k.sample.push(fields); }
             }
             summaryObj = summary;
             const summarizedContent = `<!-- O ARQUIVO SPED FOI SUMARIZADO DEVIDO AO TAMANHO -->\n${JSON.stringify(summaryObj, null, 2)}`;
             const finalSize = summarizedContent.length;
             console.log(`[Parser: ${fileName}] Content summarized. Final size: ${finalSize} chars.`);
             return summarizedContent;
        }
        
        const lines = spedContent.split('\n');
        const summary: { [key: string]: any[] } = { bloco0: [], blocoC: [], blocoH: [], blocoK: [] };
        const MAX_RECORDS_PER_BLOCK = 50;
        for (const line of lines) {
            if (!line.startsWith('|')) continue;
            const fields = line.split('|');
            const recordType = fields[1];
            if (recordType?.startsWith('0') && summary.bloco0.length < MAX_RECORDS_PER_BLOCK) { summary.bloco0.push(fields); } 
            else if (recordType?.startsWith('C') && summary.blocoC.length < MAX_RECORDS_PER_BLOCK) { summary.blocoC.push(fields); } 
            else if (recordType?.startsWith('H') && summary.blocoH.length < MAX_RECORDS_PER_BLOCK) { summary.blocoH.push(fields); } 
            else if (recordType?.startsWith('K') && summary.blocoK.length < MAX_RECORDS_PER_BLOCK) { summary.blocoK.push(fields); }
        }
        summaryObj = summary;
        const finalContent = `<!-- RESUMO ESTRUTURADO DO ARQUIVO SPED (AMOSTRA) -->\n${JSON.stringify(summaryObj, null, 2)}`;
        console.log(`[Parser: ${fileName}] SPED processed. Size: ${finalContent.length} chars.`);
        return finalContent;
    } catch (e) {
        console.warn(`[Parser: ${fileName}] Falha ao processar SPED. Enviando como texto plano.`, e);
        return compactText(spedContent);
    }
};

const parseCsv = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        try {
            Papa.parse(file, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: (results) => {
                    const originalData = results.data;
                    const originalSize = JSON.stringify(originalData).length;
                    console.log(`[Parser: ${file.name}] Parsed ${originalData.length} rows. Original size: ${originalSize} chars.`);

                    const summaryObj = resumirCSV(originalData as any[], file.name);
                    const summarizedContent = `<!-- RESUMO ESTATÍSTICO DO ARQUIVO CSV -->\n${JSON.stringify(summaryObj, null, 2)}`;
                    const finalSize = summarizedContent.length;
                    console.log(`[Parser: ${file.name}] Content summarized. Final size: ${finalSize} chars.`);
                    resolve(summarizedContent);
                },
                error: (error) => reject(error)
            });
        } catch(e) {
            reject(e);
        }
    });
};

const parsePdfWithOcr = async (file: File, onProgress: (info: string) => void): Promise<string> => {
    const fileReader = new FileReader();
    return new Promise((resolve, reject) => {
        fileReader.onload = async (event) => {
            try {
                const typedarray = new Uint8Array(event.target!.result as ArrayBuffer);
                const pdf = await pdfjsLib.getDocument(typedarray).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    onProgress(`Lendo página ${i}/${pdf.numPages}...`);
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    if (textContent.items.length > 10) {
                        fullText += textContent.items.map(item => 'str' in item ? item.str : '').join(' ');
                    } else {
                        onProgress(`Página ${i} parece ser imagem. Iniciando OCR...`);
                        const viewport = page.getViewport({ scale: 1.5 });
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d')!;
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        await page.render({ canvasContext: context, viewport: viewport, canvas: canvas }).promise;
                        const { data: { text } } = await Tesseract.recognize(canvas, 'por', {
                            logger: m => {
                                if (m.status === 'recognizing text') {
                                    onProgress(`OCR (pág ${i}): ${Math.round(m.progress * 100)}%`);
                                }
                            }
                        });
                        fullText += text;
                    }
                    fullText += '\n\n--- FIM PÁG. ---\n\n';
                }

                const originalSize = fullText.length;
                let summarizedText = fullText;
                if (originalSize > 10000) { // PDF summary threshold
                    console.log(`[Parser: ${file.name}] PDF content is large (${originalSize} chars), summarizing.`);
                    summarizedText = resumirPDF(fullText);
                    const finalSize = summarizedText.length;
                    console.log(`[Parser: ${file.name}] Content summarized. Final size: ${finalSize} chars.`);
                }
                const finalContent = `<!-- TEXTO EXTRAÍDO DO PDF (SUMARIZADO SE NECESSÁRIO) -->\n${summarizedText}`;
                resolve(compactText(finalContent));
            } catch (error) {
                reject(error);
            }
        };
        fileReader.readAsArrayBuffer(file);
    });
};

export const parseFile = async (file: File, onProgress: (info: string) => void): Promise<ParsedFileResult> => {
    const mimeType = file.type || '';
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.xml') || mimeType.includes('xml')) {
        const content = await file.text();
        return { type: 'text', content: parseXml(content, file.name) };
    }
    if (fileName.endsWith('.csv') || mimeType.includes('csv')) {
        const content = await parseCsv(file);
        return { type: 'text', content: content };
    }
    if (fileName.endsWith('.txt') && (fileName.includes('sped'))) {
        const content = await file.text();
        return { type: 'text', content: parseSped(content, file.name) };
    }
    if (fileName.endsWith('.pdf') || mimeType.includes('pdf')) {
        const content = await parsePdfWithOcr(file, onProgress);
        return { type: 'text', content: content };
    }
    if (mimeType.startsWith('text/')) {
        const content = await file.text();
        const finalContent = `<!-- CONTEÚDO DE TEXTO SIMPLES -->\n${content}`;
        return { type: 'text', content: compactText(finalContent) };
    }
    
    return { type: 'binary', content: file.name };
};
