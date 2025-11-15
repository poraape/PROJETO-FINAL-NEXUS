// services/exporter.ts
import { xml2json } from 'xml-js';
import { DocumentoFiscalDetalhado } from '../types';
import { validarDocumentoCompleto } from './rulesValidator.ts';
import { buildBackendHttpUrl } from '../config.ts';
import { authorizedFetch } from './httpClient.ts';

// Helper to simplify JSON from XML
const simplifyJson = (obj: any): any => {
    if (Array.isArray(obj)) {
        return obj.map(v => simplifyJson(v));
    } else if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        const keys = Object.keys(obj);
        if (keys.length === 1 && keys[0] === '_text') {
            return obj._text;
        }
        return Object.keys(obj).reduce((acc, key) => {
            acc[key] = simplifyJson(obj[key]);
            return acc;
        }, {} as { [key: string]: any });
    }
    return obj;
};

const parseNFeXML = async (xmlContent: string, fileName: string): Promise<DocumentoFiscalDetalhado | null> => {
    try {
        const jsonResult = xml2json(xmlContent, { compact: true, spaces: 0 });
        const nfeProc = JSON.parse(jsonResult).NFe || JSON.parse(jsonResult).nfeProc || JSON.parse(jsonResult).nFeProc;
        const infNFe = nfeProc?.NFe?.infNFe || nfeProc?.infNFe;

        if (!infNFe) return null;

        const simplified = simplifyJson(infNFe);
        
        let valorImpostosTotal = 0;

        const itens = (Array.isArray(simplified.det) ? simplified.det : [simplified.det]).map((item: any, index: number) => {
            const imposto = item?.imposto;
            const vICMS = parseFloat(imposto?.ICMS?.ICMS00?.vICMS || imposto?.ICMS?.ICMS10?.vICMS || imposto?.ICMS?.ICMS20?.vICMS || imposto?.ICMS?.ICMS40?.vICMS || imposto?.ICMS?.ICMS51?.vICMS || imposto?.ICMS?.ICMS60?.vICMS || 0);
            const vPIS = parseFloat(imposto?.PIS?.PISAliq?.vPIS || imposto?.PIS?.PISOutr?.vPIS || 0);
            const vCOFINS = parseFloat(imposto?.COFINS?.COFINSAliq?.vCOFINS || imposto?.COFINS?.COFINSOutr?.vCOFINS || 0);
            
            valorImpostosTotal += vICMS + vPIS + vCOFINS;

            return {
                nItem: item?._attributes?.nItem || index + 1,
                cProd: item?.prod?.cProd,
                xProd: item?.prod?.xProd,
                ncm: item?.prod?.NCM,
                cfop: item?.prod?.CFOP,
                uCom: item?.prod?.uCom,
                qCom: parseFloat(item?.prod?.qCom || 0),
                vUnCom: parseFloat(item?.prod?.vUnCom || 0),
                vProd: parseFloat(item?.prod?.vProd || 0),
                imposto: item?.imposto,
            }
        });

        const doc: DocumentoFiscalDetalhado = {
            fileName,
            chave: simplified._attributes?.Id?.replace('NFe', ''),
            ide: simplified.ide,
            emit: simplified.emit,
            dest: simplified.dest,
            itens,
            total: simplified.total?.ICMSTot,
            valorImpostos: valorImpostosTotal,
        };
        
        // --- Integration of the complete Validator (now async) ---
        return await validarDocumentoCompleto(doc);

    } catch (e) {
        console.error(`Error parsing XML ${fileName}:`, e);
        return null;
    }
};

export const extrairDadosParaExportacao = async (files: File[]): Promise<{ documentos: DocumentoFiscalDetalhado[], log: string[] }> => {
    const documentos: DocumentoFiscalDetalhado[] = [];
    const log: string[] = [];

    const filePromises = files.map(async file => {
        if (file.name.toLowerCase().endsWith('.xml')) {
            const content = await file.text();
            const doc = await parseNFeXML(content, file.name);
            if (doc) {
                return { doc, logMsg: null };
            } else {
                return { doc: null, logMsg: `AVISO: Falha ao processar o arquivo XML '${file.name}'. Estrutura não reconhecida.` };
            }
        } else {
            return { doc: null, logMsg: `AVISO: Arquivo '${file.name}' não é um XML e foi ignorado para exportação.` };
        }
    });

    const results = await Promise.all(filePromises);
    results.forEach(res => {
        if (res.doc) documentos.push(res.doc);
        if (res.logMsg) log.push(res.logMsg);
    });

    return { documentos, log };
};

export const gerarSpedFiscalMVP = (documentos: DocumentoFiscalDetalhado[]): string => {
    let sped = `|0000|017|0|${new Date().toLocaleDateString('pt-BR').split('/').reverse().join('')}|${new Date().toLocaleDateString('pt-BR').split('/').reverse().join('')}|NOME DA EMPRESA|CNPJ|UF|IE|COD_MUN||0|\n`;
    sped += `|0001|0|\n`;
    
    documentos.forEach(doc => {
        sped += `|C100|0|1|${doc.dest.CNPJ || doc.dest.CPF}|55|00|${doc.ide.serie}|${doc.ide.nNF}|${doc.chave}|${doc.ide.dhEmi}|...|\n`;
        doc.itens.forEach(item => {
            sped += `|C170|${item.nItem}|${item.cProd}|${item.xProd}|${item.qCom}|${item.uCom}|${item.vProd}|...|\n`;
        });
    });

    sped += `|9999|${sped.split('\n').length}|\n`;
    return sped;
};


export const gerarEfdContribMVP = (documentos: DocumentoFiscalDetalhado[]): string => {
    let efd = `|0000|007|0||${new Date().toLocaleDateString('pt-BR').split('/').reverse().join('')}|${new Date().toLocaleDateString('pt-BR').split('/').reverse().join('')}|NOME DA EMPRESA|CNPJ|UF|IE|COD_MUN||0|\n`;
    efd += `|0001|0|\n`;
    
    documentos.forEach(doc => {
         efd += `|C100|0|1|${doc.dest.CNPJ || doc.dest.CPF}|55|00|${doc.ide.serie}|${doc.ide.nNF}|${doc.chave}|${doc.ide.dhEmi}|...|\n`;
         doc.itens.forEach(item => {
            efd += `|C175|${item.cfop}|${item.vProd}|...|\n`; // Registro simplificado
        });
    });

    efd += `|9999|${efd.split('\n').length}|\n`;
    return efd;
};


export const gerarCsvERP = (documentos: DocumentoFiscalDetalhado[]): string => {
    const rows: (string | number | undefined)[][] = [['chave_nfe', 'data_emissao', 'cnpj_emitente', 'nome_emitente', 'cnpj_destinatario', 'nome_destinatario', 'item_n', 'cod_prod', 'desc_prod', 'ncm', 'cfop', 'qtd', 'un', 'v_unit', 'v_total_item']];
    documentos.forEach(doc => {
        doc.itens.forEach(item => {
            rows.push([
                doc.chave,
                doc.ide.dhEmi,
                doc.emit.CNPJ,
                doc.emit.xNome,
                doc.dest.CNPJ || doc.dest.CPF,
                doc.dest.xNome,
                String(item.nItem),
                item.cProd,
                item.xProd,
                item.ncm,
                item.cfop,
                String(item.qCom),
                item.uCom,
                String(item.vUnCom),
                String(item.vProd)
            ]);
        });
    });
    return rows.map(row => row.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
};

export const downloadFile = (fileName: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

const decodeBase64ToText = (input: string): string => {
    if (!input) return '';
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
        return window.atob(input);
    }
    if (typeof globalThis !== 'undefined' && typeof (globalThis as any).Buffer !== 'undefined') {
        return (globalThis as any).Buffer.from(input, 'base64').toString('utf8');
    }
    return input;
};

export async function exportarFiscalViaBackend(
    jobId: string,
    format: 'sped' | 'efd' | 'csv' | 'lancamentos'
): Promise<{ fileName: string; content: string; log: string[]; documents?: any[] }> {
    const response = await authorizedFetch(buildBackendHttpUrl(`/api/jobs/${jobId}/exports`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Falha ao gerar exportação no backend.');
    }

    const payload = await response.json();
    return {
        fileName: payload.fileName || `export-${format}.txt`,
        content: decodeBase64ToText(payload.content || ''),
        log: payload.log || [],
        documents: payload.documents || [],
    };
}
