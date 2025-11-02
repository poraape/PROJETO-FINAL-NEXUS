// services/chatService.ts
import { LogError, GeneratedReport, ChartConfig } from '../types.ts';
import { 
    callGeminiWithRetry,
    parseGeminiJsonResponse,
    convertFilesToGeminiParts, 
    getFullContentForIndexing,
    estimateTokens,
    // Fix: Import 'getChatCompletion' from geminiService to resolve 'Cannot find name' error.
    getChatCompletion
} from './geminiService.ts';
import { getAnswer, storeAnswer, searchIndex, getForecast, getChartConfig, storeChartConfig } from './contextMemory.ts';

const TOKEN_LIMIT = 7500;

/**
 * Constrói o prompt final para a IA, adaptando-se inteligentemente ao contexto disponível.
 */
const buildHybridPrompt = (
    question: string,
    ragContext: string,
    fallbackContext: string,
    forecastContext: string
): string => {
    let finalContext = '';
    let contextSource = '';

    if (ragContext.trim().length > 10) {
        finalContext = ragContext;
        contextSource = 'CONFIÁVEL E INDEXADO (RAG)';
    } else {
        finalContext = fallbackContext;
        contextSource = 'BRUTO E COMPLETO (FALLBACK)';
    }
    
    // Prepend forecast context if available
    if (forecastContext) {
        finalContext = `${forecastContext}\n\n${finalContext}`;
    }

    const basePrompt = `
        Você é a Nexus AI, uma IA especialista em análise fiscal. Sua tarefa é responder à pergunta do usuário de forma precisa, profissional e detalhada.
        
        **INSTRUÇÕES CRÍTICAS:**
        1.  **BASEIE-SE ESTRITAMENTE NO CONTEXTO:** Sua resposta DEVE ser fundamentada exclusivamente no contexto fornecido abaixo. Não invente informações.
        2.  **SEJA ESPECIALISTA:** Demonstre conhecimento fiscal ao interpretar os dados, mencionando totais, remetentes, produtos, impostos, CFOPs ou outros dados relevantes.
        3.  **PROIBIDO RESPOSTAS GENÉRICAS:** Nunca diga "não tenho contexto" ou "não sei". Se o contexto parecer insuficiente, afirme que a informação específica não foi encontrada nos documentos analisados, mas ofereça uma análise do que está disponível.
        4.  **FONTE DO CONTEXTO:** A fonte para esta análise é: ${contextSource}.
        
        --- INÍCIO DO CONTEXTO ---
        ${finalContext}
        --- FIM DO CONTEXTO ---
        
        **PERGUNTA DO USUÁRIO:**
        "${question}"
        
        **SUA RESPOSTA DETALHADA:**
    `;

    // Token Control
    const estimatedTokens = estimateTokens(basePrompt);
    if (estimatedTokens > TOKEN_LIMIT) {
        console.warn(`[ChatService] O prompt excedeu o limite de tokens (${estimatedTokens}). Realizando truncamento.`);
        const ratio = TOKEN_LIMIT / estimatedTokens;
        const truncatedContextLength = Math.floor(finalContext.length * ratio * 0.9);
        finalContext = finalContext.substring(0, truncatedContextLength);

        return `
            Você é a Nexus AI, uma IA especialista em análise fiscal. Responda à pergunta do usuário com base no contexto.
            AVISO: O contexto foi truncado para caber no limite. Seja conciso.
            
            --- INÍCIO DO CONTEXTO (TRUNCADO) ---
            ${finalContext}
            --- FIM DO CONTEXTO ---
            
            **PERGUNTA DO USUÁRIO:**
            "${question}"
            
            **SUA RESPOSTA DETALHADA:**
        `;
    }

    return basePrompt;
};


/**
 * Orquestra a obtenção de uma resposta do chat, usando um pipeline híbrido.
 */
export const getChatResponse = async (
    question: string,
    processedFiles: File[],
    attachedFiles: File[],
    logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<string> => {
    const startTime = Date.now();
    logError({ source: 'ChatService', message: `Iniciando pipeline de resposta para: "${question}"`, severity: 'info' });

    // 1. Check Q&A Cache
    const cachedAnswer = getAnswer(question);
    if (cachedAnswer && attachedFiles.length === 0) {
        logError({ source: 'ChatService', message: 'Resposta encontrada no cache de Q&A.', severity: 'info' });
        return cachedAnswer;
    }

    // 2. RAG Context Retrieval
    const relevantChunks = searchIndex(question);
    let ragContext = relevantChunks.map(c => c.content).join('\n\n---\n\n');

    // 3. Fallback Context Generation (if RAG is weak)
    let fallbackContext = '';
    if (ragContext.trim().length < 10 && processedFiles.length > 0) {
        logError({ source: 'ChatService', message: 'Contexto RAG insuficiente. Ativando fallback com conteúdo bruto.', severity: 'warning' });
        const fullContents = await getFullContentForIndexing(processedFiles, logError);
        fallbackContext = fullContents.map(f => `CONTEÚDO DO ARQUIVO: ${f.fileName}\n\n${f.content}`).join('\n\n====================\n\n');
    }

    // 4. Handle newly attached files
    if (attachedFiles.length > 0) {
        const fileParts = await convertFilesToGeminiParts(attachedFiles);
        const attachedFileText = fileParts.map(p => p.text).join('\n');
        // Add attached file content to both contexts to ensure it's used
        ragContext += `\n\n--- CONTEÚDO DE ARQUIVOS ANEXADOS ---\n${attachedFileText}`;
        fallbackContext += `\n\n--- CONTEÚDO DE ARQUIVOS ANEXADOS ---\n${attachedFileText}`;
    }

    // 5. Retrieve Forecast Context
    let forecastContext = '';
    const forecast = getForecast();
    if (forecast) {
        forecastContext = `
        --- INSIGHT PREDITIVO DISPONÍVEL ---
        Com base nos dados históricos, a previsão para o próximo mês é:
        - Faturamento Estimado: R$ ${forecast.previsaoProximoMes.faturamento.toFixed(2)}
        - Carga Tributária Estimada: R$ ${forecast.previsaoProximoMes.impostos.toFixed(2)}
        Use esta informação se for relevante para a pergunta do usuário.
        --- FIM DO INSIGHT PREDITIVO ---
        `;
        logError({ source: "ChatService", message: "Contexto preditivo adicionado ao prompt.", severity: "info" });
    }

    // 6. Build the final prompt and call AI
    const finalPrompt = buildHybridPrompt(question, ragContext, fallbackContext, forecastContext);
    logError({ source: 'ChatService', message: `Enviando prompt para IA. Tokens: ${estimateTokens(finalPrompt)}`, severity: 'info' });

    try {
        const responseText = await getChatCompletion(finalPrompt, logError);
        
        // 7. Store in Q&A Cache
        storeAnswer(question, responseText);
        
        const latency = Date.now() - startTime;
        logError({ source: 'ChatService', message: `Resposta da IA recebida em ${latency}ms.`, severity: 'info' });

        return responseText;

    } catch (err) {
        logError({ source: 'ChatService', message: `Falha crítica na chamada da API Gemini.`, severity: 'critical', details: err });
        throw err;
    }
};

/**
 * Generates a chart configuration JSON from a user prompt and report data.
 */
export const generateChartConfigFromData = async (
    question: string,
    report: GeneratedReport,
    logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<ChartConfig | null> => {
    const startTime = Date.now();
    logError({ source: 'ChatService.Chart', message: `Attempting to generate chart for: "${question}"`, severity: 'info' });

    // 1. Check Chart Cache
    const cachedConfig = getChartConfig(question);
    if (cachedConfig) {
        logError({ source: 'ChatService.Chart', message: 'Chart config found in cache.', severity: 'info' });
        return cachedConfig as ChartConfig;
    }
    
    // 2. Prepare context data
    const dataForAI = {
        keyMetrics: report.executiveSummary.keyMetrics,
        csvInsights: report.executiveSummary.csvInsights,
    };
    
    let contextString = JSON.stringify(dataForAI);
    const estimatedTokens = estimateTokens(contextString);

    if (estimatedTokens > TOKEN_LIMIT * 0.8) { 
        console.warn(`[ChatService.Chart] Context data is large (${estimatedTokens} tokens). Sending only key metrics.`);
        contextString = JSON.stringify({ keyMetrics: dataForAI.keyMetrics });
    }
    
    const instruction = `
        Você é um assistente de BI que cria instruções para gráficos em JSON. Sua única saída deve ser um objeto JSON.
        Com base na pergunta do usuário e nos dados fornecidos, gere um JSON com a seguinte estrutura:
        {
          "type": "bar" | "line" | "pie",
          "title": "Um título descritivo para o gráfico",
          "xField": "O nome do campo para o eixo X ou rótulo",
          "yField": "O nome do campo para o eixo Y ou valor",
          "data": [ { "xField": "valor", "yField": "valor" }, ... ]
        }
        
        REGRAS:
        - O JSON deve ser a única coisa na sua resposta. Sem texto ou markdown.
        - Se não for possível criar um gráfico relevante a partir da pergunta, retorne 'null' (sem aspas).
        - Os nomes dos campos em 'data' devem corresponder exatamente a 'xField' e 'yField'.
        
        DADOS PARA ANÁLISE:
        ${contextString}
        
        PERGUNTA DO USUÁRIO:
        "${question}"
    `;
    
    try {
        const response = await callGeminiWithRetry([instruction], logError, true);
        
        if (response.text.trim().toLowerCase() === 'null') {
            logError({ source: 'ChatService.Chart', message: 'IA determinou que um gráfico não é aplicável.', severity: 'info' });
            return null;
        }

        const chartConfig = parseGeminiJsonResponse<ChartConfig>(response.text, logError);
        
        if (!chartConfig || !chartConfig.type || !chartConfig.data) {
             throw new Error("A estrutura do JSON do gráfico é inválida.");
        }
        
        // 3. Store in Chart Cache
        storeChartConfig(question, chartConfig);
        
        const latency = Date.now() - startTime;
        logError({ source: 'ChatService.Chart', message: `Configuração do gráfico gerada pela IA em ${latency}ms.`, severity: 'info' });
        
        return chartConfig;
    } catch (err) {
        logError({ source: 'ChatService.Chart', message: `Falha ao gerar configuração do gráfico. Retorno da IA pode ter sido inválido.`, severity: 'critical', details: err });
        console.error("Raw Gemini response for chart generation failed:", err);
        return null;
    }
};