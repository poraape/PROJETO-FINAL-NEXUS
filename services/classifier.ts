import { DocumentoFiscalDetalhado, ClassificationResult, TipoOperacao, Setor, LogError } from '../types.ts';
import { callGeminiWithRetry, parseGeminiJsonResponse } from './geminiService.ts';
import { storeClassifications } from './contextMemory.ts';

const fallbackClassify = (doc: DocumentoFiscalDetalhado): { tipo_operacao: TipoOperacao; setor: Setor } => {
    let tipo_operacao: TipoOperacao = 'desconhecido';
    let setor: Setor = 'outros';

    const cfops = doc.itens.map(item => item.cfop);
    const ncms = doc.itens.map(item => item.ncm);

    // Tipo de Operação pelo CFOP (simplificado)
    if (cfops.some(cfop => cfop?.startsWith('5') || cfop?.startsWith('6'))) {
        tipo_operacao = 'venda';
    } else if (cfops.some(cfop => cfop?.startsWith('1') || cfop?.startsWith('2'))) {
        tipo_operacao = 'compra';
    } else if (cfops.some(cfop => cfop?.startsWith('535') || cfop?.startsWith('635'))) { // Exemplo CFOP de serviço
        tipo_operacao = 'serviço';
    }

    // Setor pelo NCM (simplificado)
    if (ncms.some(ncm => ncm?.startsWith('01') || ncm?.startsWith('02') || ncm?.startsWith('03'))) {
        setor = 'agronegócio';
    } else if (ncms.some(ncm => ncm?.startsWith('84') || ncm?.startsWith('85') || ncm?.startsWith('2'))) {
        setor = 'indústria';
    } else if (ncms.some(ncm => ncm?.startsWith('4'))) {
        setor = 'varejo';
    } else if (ncms.some(ncm => ncm?.startsWith('49'))) {
        setor = 'transporte';
    }
    
    return { tipo_operacao, setor };
};

export async function classificarNotas(
    documentos: DocumentoFiscalDetalhado[],
    logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<ClassificationResult[]> {
    if (documentos.length === 0) return [];

    const BATCH_SIZE = 50; // Processa 50 documentos por chamada de API
    const allResults: ClassificationResult[] = [];

    try {
        logError({ source: 'Classifier', message: `Iniciando classificação com IA para ${documentos.length} documentos...`, severity: 'info' });

        for (let i = 0; i < documentos.length; i += BATCH_SIZE) {
            const batchDocs = documentos.slice(i, i + BATCH_SIZE);
            const batchNumber = (i / BATCH_SIZE) + 1;
            logError({ source: 'Classifier', message: `Processando lote de classificação ${batchNumber}...`, severity: 'info' });

            const resumosParaIA = batchDocs.map(doc => ({
                fileName: doc.fileName,
                chave: doc.chave,
                cfops: [...new Set(doc.itens.map(i => i.cfop))],
                ncms: [...new Set(doc.itens.map(i => i.ncm))],
                descricoes: [...new Set(doc.itens.map(i => i.xProd.slice(0, 50)))].slice(0, 5) // Amostra de descrições
            }));

            const prompt = `
                Você é um classificador fiscal. Analise os resumos de notas fiscais abaixo e retorne uma lista de objetos JSON.
                Para cada nota, determine o 'tipo_operacao' e o 'setor'.

                - tipo_operacao: 'compra', 'venda', ou 'serviço'.
                - setor: 'agronegócio', 'indústria', 'varejo', 'transporte', ou 'outros'.

                Responda APENAS com um array JSON, onde cada objeto contém "fileName", "tipo_operacao", e "setor".
                Exemplo de resposta:
                [
                    { "fileName": "nota1.xml", "tipo_operacao": "venda", "setor": "indústria" },
                    { "fileName": "nota2.xml", "tipo_operacao": "compra", "setor": "varejo" }
                ]

                DADOS PARA CLASSIFICAR:
                ${JSON.stringify(resumosParaIA, null, 2)}
            `;

            const response = await callGeminiWithRetry([prompt], logError, true);
            const resultadosLote = parseGeminiJsonResponse<any[]>(response.text, logError);
            
            if (!Array.isArray(resultadosLote) || resultadosLote.length !== batchDocs.length) {
                throw new Error(`Resposta da IA para o lote ${batchNumber} é inválida ou incompleta.`);
            }

            const finalResultsLote = resultadosLote.map((res, index) => ({
                 ...res,
                 chave: batchDocs[index].chave,
            }));
            
            allResults.push(...finalResultsLote);
        }

        storeClassifications(allResults);
        logError({ source: 'Classifier', message: 'Classificação com IA bem-sucedida.', severity: 'info' });
        return allResults;

    } catch (error) {
        logError({
            source: 'Classifier',
            message: `Falha na classificação com IA, ativando fallback local. Erro: ${error.message}`,
            severity: 'warning',
            details: error
        });

        const resultadosFallback = documentos.map(doc => {
            const classification = fallbackClassify(doc);
            return {
                fileName: doc.fileName,
                chave: doc.chave,
                ...classification,
            };
        });

        storeClassifications(resultadosFallback);
        return resultadosFallback;
    }
}