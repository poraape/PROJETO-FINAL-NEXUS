// Fix: Implementing the Gemini service to handle API calls for report generation and analysis.
import { Part } from '@google/genai';
import {
  ExecutiveSummary,
  ProcessingStepStatus,
  SimulationParams,
  SimulationResult,
  ComparativeAnalysisReport,
  LogError,
  GeneratedReport,
  TaxScenario,
  ClassificationResult,
} from '../types';
import { parseFile, extractFullTextFromFile } from './fileParsers.ts';

const CHUNK_TOKEN_THRESHOLD = 8000; // ≈ 32,000 characters

// --- API Call Strategy with Fallback ---

const GEMINI_PROXY_URL = "https://nexus-quantumi2a2-747991255581.us-west1.run.app/api-proxy/v1beta/models";
const GEMINI_DIRECT_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

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
  json: () => any;
}


/**
 * Makes a single API call, trying a proxy first and falling back to the direct API.
 * This function does not handle retries, only the proxy/fallback logic.
 */
const _callGeminiApiOnce = async (
    parts: Part[],
    isJsonMode: boolean
): Promise<GeminiApiResponse> => {
    const model = DEFAULT_MODEL;
    const payload = {
        contents: [{ parts: parts }],
        ...(isJsonMode && { generationConfig: { responseMimeType: 'application/json' } })
    };

    // 1. Try Proxy
    try {
        console.debug(`[GeminiService] Attempting API call via proxy...`);
        const proxyResponse = await fetch(`${GEMINI_PROXY_URL}/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!proxyResponse.ok) {
            throw new Error(`Proxy error status: ${proxyResponse.status} ${proxyResponse.statusText}`);
        }
        
        const proxyData = await proxyResponse.json();
        
        if (proxyData.error) {
            throw new Error(`Proxy response error: ${proxyData.error.message}`);
        }

        const responseText = proxyData.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        return { ...proxyData, text: responseText, json: () => proxyData };

    } catch (error) {
        console.warn("[GeminiService] Proxying failed. Falling back to direct API.", error);

        // 2. Fallback to Direct API
        try {
            const apiKey = process.env.API_KEY;
            if (!apiKey) {
                throw new Error("A variável de ambiente API_KEY não está configurada.");
            }

            console.debug(`[GeminiService] Attempting API call directly...`);
            const directResponse = await fetch(
                `${GEMINI_DIRECT_URL}/${model}:generateContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                }
            );

            const directData = await directResponse.json();

            if (!directResponse.ok) {
                const apiErrorMsg = directData?.error?.message || 'Unknown direct API error';
                throw new Error(`Direct API error: ${directResponse.status} - ${apiErrorMsg}`);
            }
             if (directData.error) {
                throw new Error(`Direct API response error: ${directData.error.message}`);
            }

            console.debug("[GeminiService] Direct fallback successful.");
            const responseText = directData.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            return { ...directData, text: responseText, json: () => directData };

        } catch (fallbackError) {
            console.error("[GeminiService] Direct API fallback also failed:", fallbackError);
            throw new Error(`Falha total ao se comunicar com a API Gemini. Erro: ${fallbackError.message}`);
        }
    }
};


// --- Helper Functions ---

export const estimateTokens = (text: string): number => {
    return Math.ceil(text.length / 4);
};

// Fix: Export 'callGeminiWithRetry' to be used in other modules.
export const callGeminiWithRetry = async (
    promptParts: (string | Part)[], 
    logError: (error: Omit<LogError, 'timestamp'>) => void,
    isJsonMode: boolean = true
): Promise<GeminiApiResponse> => {
    const MAX_RETRIES = 3;
    let lastError: any = null;

    const mutableParts: Part[] = promptParts.map(part =>
        typeof part === 'string' ? { text: part } : part
    );

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`DEBUG: Chamada da API Gemini (tentativa ${attempt}/${MAX_RETRIES}). Tamanho do payload: ${JSON.stringify(mutableParts).length} caracteres.`);
            
            const response = await _callGeminiApiOnce(mutableParts, isJsonMode);
            
            if (!response.text && !response.candidates) {
                 const blockReason = response.promptFeedback?.blockReason;
                 throw new Error(`A resposta da IA estava vazia ou foi bloqueada. Motivo: ${blockReason || 'Desconhecido'}.`);
            }
            return response;
        } catch (error: any) {
            lastError = error;
            const errorMessage = error.toString().toLowerCase();
            // Retriable errors are server-side issues or rate limiting.
            const isRetriableError = errorMessage.includes('500') || 
                                     errorMessage.includes('internal error') || 
                                     errorMessage.includes('429') || 
                                     errorMessage.includes('proxy');
            
            if (isRetriableError && attempt < MAX_RETRIES) {
                // Exponential backoff with jitter
                const waitTime = (2 ** attempt) * 1000 + Math.random() * 1000; 
                const logMessage = errorMessage.includes('429') 
                    ? `Limite de taxa da API atingido. Tentando novamente em ${Math.round(waitTime / 1000)}s...`
                    : `Falha na chamada da API Gemini (tentativa ${attempt}/${MAX_RETRIES}). Tentando novamente em ${Math.round(waitTime / 1000)}s...`;
                
                logError({
                    source: 'geminiService',
                    message: logMessage,
                    severity: 'warning',
                    details: { error: error.message },
                });

                await new Promise(res => setTimeout(res, waitTime));
            } else {
                 try {
                    localStorage.setItem('lastFailedGeminiPayload', JSON.stringify({ parts: mutableParts }));
                 } catch (e) { /* ignore storage errors */ }
                 // Make the final error more specific
                 const finalErrorMessage = errorMessage.includes('429')
                    ? `Limite de taxa da API excedido após múltiplas tentativas. Por favor, verifique seu plano e faturamento.`
                    : `Falha na API Gemini após ${attempt} tentativas. Erro: ${error.message}`;
                 throw new Error(finalErrorMessage);
            }
        }
    }
    throw lastError; // Should not be reached, but for safety.
};

// Fix: Export 'parseGeminiJsonResponse' to be used in other modules.
export const parseGeminiJsonResponse = <T>(text: string, logError: (error: Omit<LogError, 'timestamp'>) => void): T => {
    try {
        return JSON.parse(text) as T;
    } catch (e) {
        logError({
            source: 'geminiService.jsonParser',
            message: 'Falha ao analisar a resposta JSON da Gemini.',
            severity: 'critical',
            details: { error: e, responseText: text },
        });
        throw new Error("A resposta da IA não está em um formato JSON válido.");
    }
};

/**
 * Gets summarized/processed content for generating the executive report.
 */
export const getFileContentForAnalysis = async (
    files: File[],
    updatePipelineStep: (index: number, status: ProcessingStepStatus, info?: string) => void,
    logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<{fileName: string, content: string}[]> => {
    const parsedFileContents: {fileName: string, content: string}[] = [];
    for (const file of files) {
        try {
            updatePipelineStep(0, ProcessingStepStatus.IN_PROGRESS, `Lendo e extraindo dados de: ${file.name}`);
            const result = await parseFile(file, (progressInfo) => {
                 updatePipelineStep(0, ProcessingStepStatus.IN_PROGRESS, `${file.name}: ${progressInfo}`);
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
        const response = await callGeminiWithRetry([prompt], logError, true);
        return parseGeminiJsonResponse<any>(response.text, logError);
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
        logError({ source: 'geminiService.executive', message: `Payload grande detectado (${totalTokens} tokens). Iniciando estratégia de análise em lotes.`, severity: 'info' });
        
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
            const response = await callGeminiWithRetry([synthesisPrompt], logError, true);
            const textualPart = parseGeminiJsonResponse<any>(response.text, logError);
            
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
        const response = await callGeminiWithRetry(promptParts, logError, true);
        const report = parseGeminiJsonResponse<{ executiveSummary: ExecutiveSummary }>(response.text, logError);
        
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
     const fileContents = await getFileContentForAnalysis(files, () => {}, logError);
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
                    const response = await callGeminiWithRetry([chunkPrompt], logError, false);
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
            const response = await callGeminiWithRetry([prompt], logError, false);
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
        const response = await callGeminiWithRetry(promptParts, logError, true);
        const textualAnalysis = parseGeminiJsonResponse<{
            resumoExecutivo: string;
            recomendacaoPrincipal: string;
            recomendacoesPorCenario: { [key: string]: string[] };
        }>(response.text, logError);

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
    const fileContents = await getFileContentForAnalysis(files, () => {}, logError);
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
                    const response = await callGeminiWithRetry([chunkPrompt], logError, false);
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
             const finalResponse = await callGeminiWithRetry([synthesisPrompt], logError, true);
             analysisResult = parseGeminiJsonResponse<ComparativeAnalysisReport>(finalResponse.text, logError);

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
            const response = await callGeminiWithRetry([prompt], logError, true);
            analysisResult = parseGeminiJsonResponse<ComparativeAnalysisReport>(response.text, logError);
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
        const response = await callGeminiWithRetry([prompt], logError, false);
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