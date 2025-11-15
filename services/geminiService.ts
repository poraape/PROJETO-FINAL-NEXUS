// Fix: Implementing the Gemini service to handle API calls for report generation and analysis.
import { Part } from '@google/genai';
import {
  SimulationResult,
  ComparativeAnalysisReport,
  LogError,
  TaxScenario,
  ClassificationResult,
  ExecutiveSummary,
} from '../types';
import { parseFile, extractFullTextFromFile } from './fileParsers.ts';
import { buildBackendHttpUrl } from '../config.ts';
import { authorizedFetch } from './httpClient.ts';

const CHUNK_TOKEN_THRESHOLD = 7000; // ≈ 28,000 characters

interface GeminiApiResponse {
  candidates?: {
    content: {
      parts: { text: string }[];
    };
    finishReason?: string;
  }[];
  promptFeedback?: {
    blockReason: string;
  };
  // Properties to mimic SDK's GenerateContentResponse
  text: string;
}

/**
 * Função centralizada para fazer chamadas aos endpoints do BFF.
 * Abstrai a lógica de fetch, headers e tratamento de erros.
 */
const callBffEndpoint = async <T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> => {
    try {
        const response = await authorizedFetch(buildBackendHttpUrl(endpoint), {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(`Erro no BFF (${endpoint}): ${response.status} - ${errorData.message || 'Erro desconhecido'}`);
        }
        
        // Retorna uma resposta vazia se o status for 204 No Content
        if (response.status === 204) {
            return {} as T;
        }

        return await response.json() as T;
    } catch (error) {
        console.error(`[BFF Client] Falha na chamada para ${endpoint}:`, error);
        throw error;
    }
};

// --- Helper Functions ---

export const estimateTokens = (text: string): number => {
    // 1 token is roughly 4 characters for English. We'll use this as a general heuristic.
    return Math.ceil(text.length / 4);
};

/**
 * Gets summarized/processed content for generating the executive report.
 * Esta função permanece no frontend pois lida com a UI (updatePipelineStep).
 */
export const getFileContentForAnalysis = async (
    files: File[],
    updateProgress: (info: string) => void,
    logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<{fileName: string, content: string}[]> => {
    const parsedFileContents: {fileName: string, content: string}[] = [];
    for (const file of files) {
        try {
            updateProgress(`Lendo e extraindo dados de: ${file.name}`);
            const result = await parseFile(file, (progressInfo) => {
                 updateProgress(`${file.name}: ${progressInfo}`);
            });
            if (result.type === 'text') {
                parsedFileContents.push({fileName: file.name, content: result.content});
            }
        } catch (e) {
            logError({
                source: 'fileParser',
                message: `Falha ao processar o arquivo ${file.name}`,
                severity: 'warning',
                details: e,
            });
        }
    }
    return parsedFileContents;
}

/**
 * Gets full, unsummarized text content for indexing for the RAG system.
 * Esta função permanece no frontend pois lida com a UI (updatePipelineStep).
 */
export const getFullContentForIndexing = async (
    files: File[],
    logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<{fileName: string, content: string}[]> => {
     const fullFileContents: {fileName: string, content: string}[] = [];
    for (const file of files) {
        try {
            const content = await extractFullTextFromFile(file);
            if (content && content.length > 50) { // Basic check for meaningful content
                 fullFileContents.push({ fileName: file.name, content: content });
                 console.debug(`[Indexação] Conteúdo extraído para ${file.name}: ${content.slice(0, 200)}...`);
            } else {
                 console.warn(`[Indexação] Arquivo sem conteúdo legível para indexar: ${file.name}`);
            }
        } catch (e) {
            logError({
                source: 'getFullContentForIndexing',
                message: `Falha ao extrair conteúdo completo de ${file.name} para indexação.`,
                severity: 'warning',
                details: e,
            });
        }
    }
    return fullFileContents;
};

/**
 * Simplificação da chamada à API Gemini através do BFF.
 * A lógica de retry, queue e fallback foi removida e agora é responsabilidade do backend.
 */
const callGeminiProxy = async (
    promptParts: (string | Part)[],
    isJsonMode: boolean = true
): Promise<GeminiApiResponse> => {
    const payload = {
        promptParts: promptParts.map(p => typeof p === 'string' ? { text: p } : p),
        isJsonMode,
    };
    return callBffEndpoint<GeminiApiResponse>('/api/gemini', { method: 'POST', body: JSON.stringify(payload) });
};


// --- Exported Service Functions ---
/**
 * "Map" step for the executive summary generation. Creates a structured summary for a single file.
 */
const generateSummaryForSingleFile = async (
    fileContent: { fileName: string, content: string },
    logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<any> => {
    const prompt = `
      Você é um extrator de dados fiscais altamente eficiente. Analise o conteúdo do arquivo fornecido e extraia APENAS um objeto JSON com as seguintes métricas numéricas.
      Se uma métrica não for encontrada, retorne o valor 0. Não inclua texto explicativo, apenas o JSON.

      Estrutura do JSON de saída:
      {
        "numeroDeDocumentosValidos": number,
        "valorTotalDasNfes": number,
        "valorTotalDosProdutos": number,
        "valorTotalDeICMS": number,
        "valorTotalDePIS": number,
        "valorTotalDeCOFINS": number,
        "valorTotalDeISS": number,
        "actionableInsight": string 
      }
      
      O "actionableInsight" deve ser um único insight importante e conciso (máximo 20 palavras) extraído deste arquivo específico.

      CONTEÚDO DO ARQUIVO: ${fileContent.fileName}
      ---
      ${fileContent.content}
    `;

    try {
        const response = await callGeminiProxy([prompt], true);
        return JSON.parse(response.text);
    } catch (e) {
        logError({
            source: 'geminiService.mapStep',
            message: `Falha ao sumarizar o arquivo individual: ${fileContent.fileName}`,
            severity: 'warning',
            details: e
        });
        return null; // Return null on failure to allow the process to continue
    }
}

/**
 * Layer 1: Executive Analysis.
 * Generates a high-level summary from files. Implements a map-reduce strategy for large payloads to avoid rate limiting.
 */
export const generateReportFromFiles = async (
  fileContents: {fileName: string, content: string}[],
  classifications: ClassificationResult[],
  logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<ExecutiveSummary> => {
    const startTime = performance.now();
    const combinedContent = fileContents.map(f => f.content).join('\n\n');
    const totalTokens = estimateTokens(combinedContent);
    logError({ source: 'geminiService.executive', message: `Iniciando análise executiva. ${fileContents.length} arquivos, ${totalTokens} tokens estimados.`, severity: 'info' });

    // Use the map-reduce strategy if the payload is too large
    if (totalTokens > CHUNK_TOKEN_THRESHOLD && fileContents.length > 1) {
        logError({ source: 'geminiService.executive', message: `Payload grande detectado (${totalTokens} tokens). Iniciando estratégia de análise em lotes (Map-Reduce).`, severity: 'info' });
        
        // --- MAP STEP (Sequential) ---
        const individualSummaries = [];
        for (const file of fileContents) {
            logError({ source: 'geminiService.mapStep', message: `Analisando arquivo individual: ${file.fileName}`, severity: 'info' });
            const summary = await generateSummaryForSingleFile(file, logError);
            if (summary) {
                individualSummaries.push(summary);
            }
        }

        if (individualSummaries.length === 0) {
            throw new Error("Falha ao analisar os arquivos individualmente. Nenhum resumo pôde ser gerado.");
        }

        // --- REDUCE STEP (Local Aggregation) ---
        const aggregatedMetrics = individualSummaries.reduce((acc, summary) => {
            Object.keys(acc).forEach(key => {
                if (typeof summary[key] === 'number') {
                    (acc as any)[key] += summary[key];
                }
            });
            return acc;
        }, {
            numeroDeDocumentosValidos: 0,
            valorTotalDasNfes: 0,
            valorTotalDosProdutos: 0,
            valorTotalDeICMS: 0,
            valorTotalDePIS: 0,
            valorTotalDeCOFINS: 0,
            valorTotalDeISS: 0,
        });
        
        const collectedInsights = individualSummaries.map(s => s.actionableInsight).filter(Boolean);

        // --- REDUCE STEP (AI Synthesis) ---
        logError({ source: 'geminiService.reduceStep', message: 'Sintetizando resumo final a partir dos dados agregados.', severity: 'info' });
        const synthesisPrompt = `
            Você é um especialista em contabilidade e análise fiscal no Brasil. Com base nos dados agregados e insights individuais fornecidos, gere o restante do resumo executivo.
            
            DADOS AGREGADOS (já calculados):
            ${JSON.stringify(aggregatedMetrics, null, 2)}
            
            INSIGHTS INDIVIDUAIS (para sua referência):
            - ${collectedInsights.join('\n- ')}

            CONTEXTO DE CLASSIFICAÇÃO (para refinar a análise):
            ${JSON.stringify(classifications, null, 2)}

            Sua tarefa é gerar APENAS um objeto JSON com as seguintes chaves textuais e de avaliação:
            - title (string): Um título conciso para o relatório.
            - description (string): Uma breve descrição do período ou dos documentos analisados.
            - indiceDeConformidadeICMS (string): Uma porcentagem estimada da conformidade de ICMS (ex: "98.7%").
            - nivelDeRiscoTributario ('Baixo' | 'Média' | 'Alto'): Avalie o risco geral.
            - actionableInsights (array of objects): Refine e consolide os insights individuais em uma lista de 2-4 pontos importantes. Cada objeto deve ter "text" (string).
            
            Responda APENAS com o objeto JSON parcial, sem markdown.
        `;

        try {
            const response = await callGeminiProxy([synthesisPrompt], true);
            const textualPart = JSON.parse(response.text);
            
            // Combine aggregated numbers with AI-generated text
            const finalSummary: ExecutiveSummary = {
                ...textualPart,
                keyMetrics: {
                    ...aggregatedMetrics,
                    indiceDeConformidadeICMS: textualPart.indiceDeConformidadeICMS,
                    nivelDeRiscoTributario: textualPart.nivelDeRiscoTributario,
                    estimativaDeNVA: 0 // Not calculated in this flow, default to 0
                },
                // csvInsights can be handled if needed, but skipping for this fix
            };
            
            if (!finalSummary || !finalSummary.keyMetrics || !finalSummary.title) {
                throw new Error("A estrutura do resumo executivo sintetizado pela IA é inválida.");
            }
            
            const endTime = performance.now();
            logError({ source: 'geminiService.executive', message: `Análise em lotes concluída em ${(endTime - startTime).toFixed(2)} ms.`, severity: 'info' });
            return finalSummary;
        } catch(err) {
             logError({
                source: 'geminiService.reduceStep',
                message: 'Falha ao sintetizar o resumo executivo com a IA.',
                severity: 'critical',
                details: err,
            });
            throw new Error(`Falha ao gerar resumo executivo (etapa de síntese). Causa: ${err.message}`);
        }
    }

    // --- Original Logic for smaller payloads ---
    const prompt = `
      Você é um especialista em contabilidade e análise fiscal no Brasil. Analise o conteúdo dos seguintes arquivos fiscais e gere UM RESUMO EXECUTIVO.
      O conteúdo fornecido é uma concatenação de vários arquivos ou resumos de arquivos. Cada um é delimitado por marcadores "--- INÍCIO/FIM DO ARQUIVO ---".

      Para refinar sua análise, utilize o seguinte CONTEXTO DE CLASSIFICAÇÃO que já foi determinado:
      --- CLASSIFICAÇÃO PRÉVIA ---
      ${JSON.stringify(classifications, null, 2)}
      --- FIM DA CLASSIFICAÇÃO ---

      Sua tarefa é gerar APENAS um objeto JSON para a chave "executiveSummary" com a seguinte estrutura (use os tipos de dados exatos):
      - title (string): Um título conciso para o relatório. Ex: "Análise Fiscal Consolidada de Vendas para a Indústria".
      - description (string): Uma breve descrição do período ou dos documentos analisados, usando o contexto da classificação.
      - keyMetrics (object): Um objeto com as seguintes métricas calculadas a partir de TODOS os arquivos:
        - numeroDeDocumentosValidos (number): Conte o número de documentos distintos e válidos.
        - valorTotalDasNfes (number): Some o valor total de todas as NF-es encontradas.
        - valorTotalDosProdutos (number): Some o valor total dos produtos.
        - indiceDeConformidadeICMS (string): Uma porcentagem estimada da conformidade de ICMS (ex: "98.7%").
        - nivelDeRiscoTributario ('Baixo' | 'Média' | 'Alto'): Avalie o risco geral.
        - estimativaDeNVA (number): "Necessidade de Verba de Anulação". Calcule se possível, senão, 0.
        - valorTotalDeICMS (number): Some todo o ICMS.
        - valorTotalDePIS (number): Some todo o PIS.
        - valorTotalDeCOFINS (number): Some todo o COFINS.
        - valorTotalDeISS (number): Some todo o ISS.
      - actionableInsights (array of objects): Uma lista de 2-4 insights importantes, cada um sendo um objeto com "text" (string).
      - csvInsights (array of objects, opcional): Se houver resumos de CSV, gere um insight para cada. Cada objeto deve ter: fileName (string), insight (string), rowCount (number).

      Responda APENAS com o objeto JSON, sem markdown ou texto explicativo.
    `;
    const promptParts = [{text: prompt}, {text: `\n\nCONTEÚDO DOS ARQUIVOS:\n${combinedContent}`}];

    try {
        const response = await callGeminiProxy(promptParts, true);
        const report = JSON.parse(response.text);
        
        if (!report || !report.executiveSummary || !report.executiveSummary.keyMetrics) {
            throw new Error("A estrutura do resumo executivo da IA é inválida ou incompleta.");
        }
        
        const endTime = performance.now();
        logError({ source: 'geminiService.executive', message: `Análise executiva concluída em ${(endTime - startTime).toFixed(2)} ms.`, severity: 'info' });
        
        return report.executiveSummary;
    } catch(err) {
        logError({
            source: 'geminiService.generateReport',
            message: 'Falha ao gerar resumo executivo com a IA.',
            severity: 'critical',
            details: err,
        });
        throw new Error(`Falha ao gerar resumo executivo. Causa: ${err.message}`);
    }
};

/**
 * Layer 4: Full Text Analysis.
 * Generates a detailed text analysis on-demand. Can be token-intensive.
 */
export const generateFullTextAnalysis = async (
    files: File[],
    logError: (error: Omit<LogError, 'timestamp'>) => void,
    onProgress: (message: string) => void
): Promise<string> => {
     const startTime = performance.now();
     onProgress('Extraindo conteúdo dos arquivos...');
     const fileContents = await getFileContentForAnalysis(files, onProgress, logError);
     const combinedContent = fileContents.map(f => f.content).join('\n\n');
     const totalTokens = estimateTokens(combinedContent);

     logError({ source: 'geminiService.fullText', message: `Iniciando análise completa. ${fileContents.length} arquivos, ${totalTokens} tokens estimados.`, severity: 'info' });

     try {
        // Chunking Strategy
        if (totalTokens > CHUNK_TOKEN_THRESHOLD) {
            onProgress(`Payload grande detectado. Analisando ${fileContents.length} arquivos individualmente...`);
            const individualAnalyses: string[] = [];
            for (let i = 0; i < fileContents.length; i++) {
                const file = fileContents[i];
                onProgress(`Analisando arquivo ${i + 1}/${fileContents.length}: ${file.fileName}`);
                const chunkPrompt = `Você é um analista fiscal. Forneça uma análise textual detalhada, em markdown, do seguinte documento fiscal:\n\n${file.content}`;
                try {
                    const response = await callGeminiProxy([chunkPrompt], false);
                    individualAnalyses.push(`## Análise do Arquivo: ${file.fileName}\n\n${response.text}`);
                } catch (chunkError) {
                    logError({ source: 'geminiService.fullText', message: `Falha ao analisar o arquivo ${file.fileName}.`, severity: 'warning', details: chunkError });
                    individualAnalyses.push(`## Análise do Arquivo: ${file.fileName}\n\n**ERRO:** Não foi possível gerar a análise para este arquivo.`);
                }
            }

            onProgress('Combinando relatórios...');
            const combinedReport = `# Análise Textual Completa\n\n${individualAnalyses.join('\n\n---\n\n')}`;
            const endTime = performance.now();
            logError({ source: 'geminiService.fullText', message: `Análise completa (em lotes) concluída em ${(endTime - startTime).toFixed(2)} ms.`, severity: 'info' });
            return combinedReport;
        } else {
            const prompt = `
                Você é um especialista em contabilidade e análise fiscal no Brasil. Com base no conteúdo dos arquivos fiscais fornecidos, gere uma ANÁLISE TEXTUAL COMPLETA e detalhada.
                Use markdown para formatação (títulos, listas, negrito).
                Estruture sua análise em seções claras, como "Visão Geral", "Pontos de Atenção", "Análise de Impostos (ICMS, PIS/COFINS)", "Recomendações", etc.
                Seja o mais detalhista possível.

                CONTEÚDO DOS ARQUIVOS:
                ${combinedContent}
            `;
            const response = await callGeminiProxy([prompt], false);
            const endTime = performance.now();
            logError({ source: 'geminiService.fullText', message: `Análise completa (unificada) concluída em ${(endTime - startTime).toFixed(2)} ms.`, severity: 'info' });
            return response.text;
        }
     } catch(err) {
        logError({
            source: 'geminiService.fullText',
            message: 'Falha ao gerar análise textual completa com a IA.',
            severity: 'critical',
            details: err,
        });
        throw err;
     }
}


/**
 * Layer 2: Tax Simulation (Optimized).
 * The AI is now used only for textual interpretation of pre-calculated scenarios.
 */
export const simulateTaxScenario = async (
    calculatedScenarios: TaxScenario[],
    logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<SimulationResult> => {
    const startTime = performance.now();
    logError({ source: 'geminiService.simulate', message: 'Iniciando interpretação de cenários tributários...', severity: 'info' });

    // Remove textual recommendations from the payload sent to the AI to avoid influencing it
    const scenariosForAI = calculatedScenarios.map(({ recomendacoes, ...scenario }) => scenario);

    const prompt = `
        Você é um consultor fiscal sênior. Com base nos CÁLCULOS de cenários tributários fornecidos abaixo, sua tarefa é gerar APENAS a parte textual da análise: um resumo executivo, a recomendação principal e recomendações específicas para cada cenário.

        DADOS CALCULADOS (NÃO ALTERAR):
        ${JSON.stringify(scenariosForAI, null, 2)}

        Sua tarefa é gerar uma resposta JSON com a seguinte estrutura:
        - resumoExecutivo (string): Um parágrafo conciso (2-3 sentenças) resumindo os resultados e a principal diferença entre os cenários.
        - recomendacaoPrincipal (string): O nome do cenário mais vantajoso (ex: "Lucro Presumido").
        - recomendacoesPorCenario (object): Um objeto onde cada chave é o nome de um cenário (ex: "Lucro Presumido") e o valor é um array de 1-2 strings com recomendações textuais específicas para aquele regime.

        Seja analítico e direto. Responda APENAS com o objeto JSON.
    `;
    const promptParts = [{ text: prompt }];
    
    try {
        const response = await callGeminiProxy(promptParts, true);
        const textualAnalysis = JSON.parse(response.text) as {
            resumoExecutivo: string;
            recomendacaoPrincipal: string;
            recomendacoesPorCenario: { [key: string]: string[] };
        };

        if (!textualAnalysis || !textualAnalysis.recomendacoesPorCenario) {
            throw new Error("A estrutura da análise textual da simulação da IA é inválida.");
        }

        // Merge AI textual insights with the original calculated numbers
        const finalScenarios = calculatedScenarios.map(scenario => ({
            ...scenario,
            recomendacoes: textualAnalysis.recomendacoesPorCenario[scenario.nome] || [],
        }));
        
        const finalResult: SimulationResult = {
            resumoExecutivo: textualAnalysis.resumoExecutivo,
            recomendacaoPrincipal: textualAnalysis.recomendacaoPrincipal,
            cenarios: finalScenarios
        };

        const endTime = performance.now();
        logError({ source: 'geminiService.simulate', message: `Simulação (interpretação da IA) concluída em ${(endTime - startTime).toFixed(2)} ms.`, severity: 'info' });
        return finalResult;
    } catch(err) {
        logError({
            source: 'geminiService.simulateTax',
            message: 'Falha ao interpretar cenário com a IA.',
            severity: 'critical',
            details: err,
        });
        throw err;
    }
};

/**
 * Layer 3: Comparative Analysis.
 */
export const generateComparativeAnalysis = async (
    files: File[],
    logError: (error: Omit<LogError, 'timestamp'>) => void,
    onProgress: (message: string) => void
): Promise<ComparativeAnalysisReport> => {
    const startTime = performance.now();
    onProgress('Extraindo conteúdo para comparação...');
    const fileContents = await getFileContentForAnalysis(files, onProgress, logError);
    const combinedContent = fileContents.map(f => f.content).join('\n\n');
    const totalTokens = estimateTokens(combinedContent);

    logError({ source: 'geminiService.compare', message: `Iniciando análise comparativa. ${fileContents.length} arquivos, ${totalTokens} tokens estimados.`, severity: 'info' });
    
    try {
        let analysisResult: ComparativeAnalysisReport;

        // Chunking strategy for comparison is tricky, but we can analyze individually and synthesize.
        if (totalTokens > CHUNK_TOKEN_THRESHOLD) {
             onProgress(`Payload grande detectado. Resumindo ${fileContents.length} arquivos individualmente...`);
             const individualSummaries: string[] = [];
             for (let i = 0; i < fileContents.length; i++) {
                 const file = fileContents[i];
                 onProgress(`Resumindo arquivo ${i + 1}/${fileContents.length}: ${file.fileName}`);
                 const chunkPrompt = `Você é um analista fiscal. Extraia as métricas e características chave do seguinte documento em formato JSON. Inclua totais, impostos, e datas. Seja conciso.\n\n${file.content}`;
                 try {
                    const response = await callGeminiProxy([chunkPrompt], false);
                    individualSummaries.push(`--- RESUMO DO ARQUIVO: ${file.fileName} ---\n${response.text}`);
                 } catch (chunkError) {
                    logError({ source: 'geminiService.compare', message: `Falha ao resumir o arquivo ${file.fileName} para comparação.`, severity: 'warning', details: chunkError });
                    individualSummaries.push(`--- RESUMO DO ARQUIVO: ${file.fileName} ---\n**ERRO:** Não foi possível resumir este arquivo.`);
                 }
             }
             
             onProgress('Sintetizando o relatório comparativo...');
             const synthesisPrompt = `
                Você é um analista fiscal comparativo. Com base nos resumos de múltiplos arquivos fiscais, gere um relatório comparativo.
                Sua tarefa é gerar uma resposta JSON com a seguinte estrutura:
                - executiveSummary (string): Resumo das principais diferenças e anomalias.
                - keyComparisons (array of objects): Compare métricas chave. Cada objeto: { metricName (string), valueFileA (string), valueFileB (string), variance (string), comment (string) }.
                - identifiedPatterns (array of objects): Padrões repetidos. Cada objeto: { description (string), foundIn (array of strings) }.
                - anomaliesAndDiscrepancies (array of objects): Anomalias notáveis. Cada objeto: { fileName (string), description (string), severity ('Baixa' | 'Média' | 'Alta') }.
                Responda APENAS com o objeto JSON.

                RESUMOS DOS ARQUIVOS:
                ${individualSummaries.join('\n\n')}
            `;
             const finalResponse = await callGeminiProxy([synthesisPrompt], true);
             analysisResult = JSON.parse(finalResponse.text);

        } else {
            const prompt = `
                Você é um analista fiscal comparativo. Analise os conteúdos de múltiplos arquivos fiscais e gere um relatório comparativo.
                Os arquivos estão concatenados abaixo.

                Sua tarefa é gerar uma resposta JSON com a seguinte estrutura:
                - executiveSummary (string): Resumo das principais diferenças e anomalias.
                - keyComparisons (array of objects): Compare métricas chave. Cada objeto: { metricName (string), valueFileA (string), valueFileB (string), variance (string), comment (string) }.
                - identifiedPatterns (array of objects): Padrões repetidos. Cada objeto: { description (string), foundIn (array of strings) }.
                - anomaliesAndDiscrepancies (array of objects): Anomalias notáveis. Cada objeto: { fileName (string), description (string), severity ('Baixa' | 'Média' | 'Alta') }.

                Responda APENAS com o objeto JSON.

                CONTEÚDO DOS ARQUIVOS:
                ${combinedContent}
            `;
            const response = await callGeminiProxy([prompt], true);
            analysisResult = JSON.parse(response.text);
        }

        if (!analysisResult || !analysisResult.keyComparisons) {
            throw new Error("A estrutura do relatório comparativo da IA é inválida.");
        }
        
        const endTime = performance.now();
        logError({ source: 'geminiService.compare', message: `Análise comparativa concluída em ${(endTime - startTime).toFixed(2)} ms.`, severity: 'info' });

        return analysisResult;
    } catch(err) {
        logError({
            source: 'geminiService.compare',
            message: 'Falha ao gerar análise comparativa com a IA.',
            severity: 'critical',
            details: err,
        });
        throw err;
    }
};

/**
 * Converts files to Gemini Parts for chat analysis.
 */
export const convertFilesToGeminiParts = async (files: File[]): Promise<Part[]> => {
    const fileToGenerativePart = async (file: File): Promise<Part | null> => {
        // Simple file type check based on extension
        const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedImageTypes.includes(file.type)) return null;

        const base64EncodedData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        });
        return {
            inlineData: {
                data: base64EncodedData,
                mimeType: file.type,
            },
        };
    };
    
    const fileProcessingPromises = files.map(async (file) => {
        const mimeType = file.type || '';
        if (mimeType.startsWith('image/')) {
            return fileToGenerativePart(file);
        }
        
        const parsedResult = await parseFile(file, () => {});
        return { text: `\n--- START FILE: ${file.name} ---\n${parsedResult.content}\n--- END FILE: ${file.name} ---\n` };
    });

    const results = await Promise.all(fileProcessingPromises);
    return results.filter((p): p is Part => p !== null);
};

/**
 * Gets a simple text completion for a given prompt, optimized for chat.
 */
export const getChatCompletion = async (
    prompt: string,
    logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<string> => {
    try {
        const response = await callGeminiProxy([prompt], false);
        return response.text;
    } catch(err) {
        logError({
            source: 'geminiService.chat',
            message: 'Falha ao obter resposta do chat da IA.',
            severity: 'critical',
            details: err,
        });
        throw err;
    }
};
