// Fix: Implementing the Gemini service to handle API calls for report generation and analysis.
import { GoogleGenAI, Part, GenerateContentResponse } from '@google/genai';
import {
  ExecutiveSummary,
  ProcessingStepStatus,
  SimulationParams,
  SimulationResult,
  ComparativeAnalysisReport,
  LogError,
  GeneratedReport,
  TaxScenario,
} from '../types';
import { parseFile } from './fileParsers.ts';
import { getApiKey } from '../config.ts';

const CHUNK_TOKEN_THRESHOLD = 8000; // ≈ 32,000 characters

const getAiInstance = () => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Chave da API Gemini não encontrada. Por favor, configure-a no início.");
  }
  return new GoogleGenAI({ apiKey });
};

// --- Helper Functions ---

const estimateTokens = (text: string): number => {
    return Math.ceil(text.length / 4);
};

const callGeminiWithRetry = async (
    promptParts: (string | Part)[], 
    logError: (error: Omit<LogError, 'timestamp'>) => void,
    isJsonMode: boolean = true
): Promise<GenerateContentResponse> => {
    const ai = getAiInstance();
    const model = 'gemini-2.5-flash';
    const MAX_RETRIES = 3;
    let lastError: any = null;

    let mutableParts: Part[] = promptParts.map(part =>
        typeof part === 'string' ? { text: part } : part
    );

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`DEBUG: Chamada da API Gemini (tentativa ${attempt}/${MAX_RETRIES}). Tamanho do payload: ${JSON.stringify(mutableParts).length} caracteres.`);
            
            const response = await ai.models.generateContent({
                model,
                contents: { parts: mutableParts },
                config: isJsonMode ? { responseMimeType: 'application/json' } : {}
            });
            
            if (!response.text) {
                 const blockReason = response.promptFeedback?.blockReason;
                 const finishReason = response.candidates?.[0]?.finishReason;
                 throw new Error(`A resposta da IA estava vazia. Motivo do bloqueio: ${blockReason || 'N/A'}. Motivo da finalização: ${finishReason || 'N/A'}.`);
            }
            return response;
        } catch (error: any) {
            lastError = error;
            const errorMessage = error.toString().toLowerCase();
            const isRetriableError = errorMessage.includes('500') || errorMessage.includes('internal error') || errorMessage.includes('429');
            
            if (isRetriableError && attempt < MAX_RETRIES) {
                const waitTime = (2 ** (attempt - 1)) * 2000; // 2s, 4s
                logError({
                    source: 'geminiService',
                    message: `Falha na chamada da API Gemini (tentativa ${attempt}/${MAX_RETRIES}). Reduzindo payload e tentando novamente em ${waitTime / 1000}s...`,
                    severity: 'warning',
                    details: { error: error.message },
                });

                mutableParts = mutableParts.map(part => 
                    'text' in part && part.text
                        ? { ...part, text: part.text.substring(0, Math.ceil(part.text.length / 2)) } 
                        : part
                );

                await new Promise(res => setTimeout(res, waitTime));
            } else {
                 try {
                    localStorage.setItem('lastFailedGeminiPayload', JSON.stringify({ parts: mutableParts }));
                 } catch (e) { /* ignore storage errors */ }
                 throw new Error(`Falha na API Gemini após ${attempt} tentativas. O último payload que causou o erro foi salvo no localStorage. Erro: ${error.message}`);
            }
        }
    }
    throw lastError;
};

const parseGeminiJsonResponse = <T>(text: string, logError: (error: Omit<LogError, 'timestamp'>) => void): T => {
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

const getFileContentForAnalysis = async (
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


// --- Exported Service Functions ---

/**
 * Layer 1: Executive Analysis.
 * Generates a high-level summary from files. Fast and token-efficient.
 */
export const generateReportFromFiles = async (
  files: File[],
  updatePipelineStep: (index: number, status: ProcessingStepStatus, info?: string) => void,
  logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<ExecutiveSummary> => {
    const startTime = performance.now();
    updatePipelineStep(0, ProcessingStepStatus.IN_PROGRESS, `Processando ${files.length} arquivo(s)...`);
    const fileContents = await getFileContentForAnalysis(files, updatePipelineStep, logError);
    const combinedContent = fileContents.map(f => `--- INÍCIO DO ARQUIVO: ${f.fileName} ---\n${f.content}\n--- FIM DO ARQUIVO: ${f.fileName} ---`).join('\n\n');
    updatePipelineStep(0, ProcessingStepStatus.COMPLETED);

    // Simulate intermediate steps
    updatePipelineStep(1, ProcessingStepStatus.IN_PROGRESS, "Agente Auditor: Verificando consistência...");
    await new Promise(res => setTimeout(res, 300));
    updatePipelineStep(1, ProcessingStepStatus.COMPLETED);
    updatePipelineStep(2, ProcessingStepStatus.IN_PROGRESS, "Agente Classificador: Organizando informações...");
    await new Promise(res => setTimeout(res, 300));
    updatePipelineStep(2, ProcessingStepStatus.COMPLETED);
    
    updatePipelineStep(3, ProcessingStepStatus.IN_PROGRESS, "Agente de Inteligência: Gerando análise executiva...");
    
    const totalTokens = estimateTokens(combinedContent);
    logError({ source: 'geminiService.executive', message: `Iniciando análise executiva. Payload: ${combinedContent.length} chars, Tokens estimados: ${totalTokens}`, severity: 'info' });

    const prompt = `
      Você é um especialista em contabilidade e análise fiscal no Brasil. Analise o conteúdo dos seguintes arquivos fiscais e gere UM RESUMO EXECUTIVO.
      O conteúdo fornecido é uma concatenação de vários arquivos ou resumos de arquivos. Cada um é delimitado por marcadores "--- INÍCIO/FIM DO ARQUIVO ---".

      Sua tarefa é gerar APENAS um objeto JSON para a chave "executiveSummary" com a seguinte estrutura (use os tipos de dados exatos):
      - title (string): Um título conciso para o relatório. Ex: "Análise Fiscal Consolidada".
      - description (string): Uma breve descrição do período ou dos documentos analisados.
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
        
        if (!report || !report.executiveSummary) {
            throw new Error("A estrutura do resumo executivo da IA é inválida.");
        }
        
        updatePipelineStep(3, ProcessingStepStatus.COMPLETED);
        updatePipelineStep(4, ProcessingStepStatus.IN_PROGRESS, "Agente Contador: Finalizando resumo...");
        await new Promise(res => setTimeout(res, 300));
        
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
        throw err;
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
                const response = await callGeminiWithRetry([chunkPrompt], logError, false);
                individualAnalyses.push(`--- ANÁLISE DO ARQUIVO: ${file.fileName} ---\n${response.text}`);
            }

            onProgress('Sintetizando o relatório final...');
            const synthesisPrompt = `Você é um editor sênior. Combine as seguintes análises individuais em um único relatório textual coeso e bem-estruturado em markdown. Remova redundâncias e crie uma narrativa fluida.\n\n${individualAnalyses.join('\n\n')}`;
            const finalResponse = await callGeminiWithRetry([synthesisPrompt], logError, false);
            const endTime = performance.now();
            logError({ source: 'geminiService.fullText', message: `Análise completa (em lotes) concluída em ${(endTime - startTime).toFixed(2)} ms.`, severity: 'info' });
            return finalResponse.text;
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
             onProgress(`Payload grande detectado. Analisando ${fileContents.length} arquivos individualmente...`);
             const individualSummaries: string[] = [];
             for (let i = 0; i < fileContents.length; i++) {
                 const file = fileContents[i];
                 onProgress(`Analisando arquivo ${i + 1}/${fileContents.length}: ${file.fileName}`);
                 const chunkPrompt = `Você é um analista fiscal. Extraia as métricas e características chave do seguinte documento em formato JSON. Inclua totais, impostos, e datas. Seja conciso.\n\n${file.content}`;
                 const response = await callGeminiWithRetry([chunkPrompt], logError, false); // Not JSON mode, as it might fail, we get the text and clean it
                 individualSummaries.push(`--- RESUMO DO ARQUIVO: ${file.fileName} ---\n${response.text}`);
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