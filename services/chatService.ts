// services/chatService.ts
import { ChartConfig, ForecastResult, GeneratedReport, LogError } from '../types.ts';
import { buildBackendHttpUrl } from '../config.ts';
import {
    getAnswer as getCachedAnswer,
    storeAnswer as cacheAnswer,
    searchIndex,
    getChartConfig as getCachedChartConfig,
    storeChartConfig as cacheChartConfig,
    getForecast,
    getFeedbackContext,
} from './contextMemory.ts';
import { getFullContentForIndexing, estimateTokens } from './geminiService.ts';
import { extractFullTextFromFile } from './fileParsers.ts';

type LogFn = (entry: Omit<LogError, 'timestamp'>) => void;

interface GeminiResponse {
    text?: string;
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

const TOKEN_BUDGET = 7500;
const CONTEXT_TRUNCATION_RATIO = 0.9;
const MAX_RAG_SNIPPETS = parseInt(import.meta.env?.VITE_CHAT_MAX_RAG_SNIPPETS ?? '6', 10);
const RAG_SNIPPET_LENGTH = parseInt(import.meta.env?.VITE_CHAT_RAG_SNIPPET_LENGTH ?? '600', 10);
const ATTACHMENT_SNIPPET_LENGTH = parseInt(import.meta.env?.VITE_CHAT_ATTACHMENT_SNIPPET_LENGTH ?? '800', 10);

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function getAnswerFromBackend(
    jobId: string,
    question: string,
    logError: LogFn
): Promise<string> {
    try {
        const response = await fetch(buildBackendHttpUrl(`/api/jobs/${jobId}/chat`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(errorData.message || 'Falha ao obter resposta do backend.');
        }
        const { answer } = await response.json();
        return answer;
    } catch (error) {
        logError({
            source: 'ChatService',
            message: error instanceof Error ? error.message : 'Erro desconhecido no chat.',
            severity: 'critical',
            details: error,
        });
        throw error;
    }
}

export async function getChatResponse(
    question: string,
    processedFiles: File[],
    attachedFiles: File[],
    logError: LogFn
): Promise<string> {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
        return 'Por favor, digite uma pergunta.';
    }

    const start = now();
    logError({
        source: 'ChatService',
        message: `Iniciando pipeline de resposta para: "${trimmedQuestion}"`,
        severity: 'info',
    });

    const attachments = attachedFiles ?? [];
    if (attachments.length === 0) {
        const cached = getCachedAnswer(trimmedQuestion);
        if (cached) {
            logError({
                source: 'ChatService',
                message: 'Resposta encontrada no cache de Q&A.',
                severity: 'info',
            });
            return cached;
        }
    }

    const ragChunks = searchIndex(trimmedQuestion);
    const topRagChunks = ragChunks.slice(0, MAX_RAG_SNIPPETS);
    if (ragChunks.length > MAX_RAG_SNIPPETS) {
        logError({
            source: 'ChatService',
            message: `Contexto RAG retornou ${ragChunks.length} trechos. Utilizando os ${MAX_RAG_SNIPPETS} mais relevantes.`,
            severity: 'info',
        });
    }
    let ragContext = buildRagContext(topRagChunks);
    let fallbackContext = '';

    if (ragContext.trim().length < 10 && processedFiles.length > 0) {
        logError({
            source: 'ChatService',
            message: 'Contexto RAG insuficiente. Ativando fallback com conteúdo bruto.',
            severity: 'warning',
        });
        try {
            const rawContents = await getFullContentForIndexing(processedFiles, logError);
            fallbackContext = rawContents
                .map(item => `CONTEÚDO DO ARQUIVO: ${item.fileName}\n\n${item.content}`)
                .join('\n\n====================\n\n');
        } catch (error) {
            logError({
                source: 'ChatService',
                message: 'Falha ao construir fallback com conteúdo bruto.',
                severity: 'warning',
                details: error,
            });
        }
    }

    if (attachments.length > 0) {
        const attachmentSnippets = await convertAttachmentsToText(attachments, logError);
        if (attachmentSnippets.length > 0) {
            const attachmentBlock = `--- CONTEÚDO DE ARQUIVOS ANEXADOS ---\n${attachmentSnippets.join('\n')}`;
            ragContext = appendBlock(ragContext, attachmentBlock);
            fallbackContext = appendBlock(fallbackContext, attachmentBlock);
        }
    }

    const forecast = getForecast();
    let predictiveContext = '';
    if (forecast) {
        predictiveContext = formatForecastContext(forecast);
        logError({
            source: 'ChatService',
            message: 'Contexto preditivo adicionado ao prompt.',
            severity: 'info',
        });
    }

    const { prompt, estimatedTokens } = buildPrompt(trimmedQuestion, ragContext, fallbackContext, predictiveContext);
    logError({
        source: 'ChatService',
        message: `Enviando prompt para IA. Tokens estimados: ${estimatedTokens}`,
        severity: 'info',
    });

    try {
        logError({
            source: 'ChatService',
            message: `Prompt construído com aproximadamente ${estimateTokens(prompt)} tokens.`,
            severity: 'info',
        });

        const responseText = await callGeminiText(prompt, logError);
        if (attachments.length === 0) {
            cacheAnswer(trimmedQuestion, responseText);
        }
        const elapsed = Math.round(now() - start);
        logError({
            source: 'ChatService',
            message: `Resposta da IA recebida em ${elapsed}ms.`,
            severity: 'info',
        });
        return responseText;
    } catch (error) {
        // callGeminiText já registrou o erro como crítico.
        throw error;
    }
}

export async function generateChartConfigFromData(
    question: string,
    report: GeneratedReport,
    logError: LogFn
): Promise<ChartConfig | null> {
    const start = now();
    logError({
        source: 'ChatService.Chart',
        message: `Tentando gerar gráfico para: "${question}"`,
        severity: 'info',
    });

    const cached = getCachedChartConfig(question);
    if (cached) {
        logError({
            source: 'ChatService.Chart',
            message: 'Configuração do gráfico encontrada no cache.',
            severity: 'info',
        });
        return cached as ChartConfig;
    }

    if (!report?.executiveSummary) {
        logError({
            source: 'ChatService.Chart',
            message: 'Relatório executivo ausente. Não é possível gerar um gráfico.',
            severity: 'warning',
        });
        return null;
    }

    const { keyMetrics, csvInsights } = report.executiveSummary;
    const chartContext = { keyMetrics, csvInsights };

    let serializedContext = JSON.stringify(chartContext);
    const contextTokens = estimateTokens(serializedContext);
    if (contextTokens > TOKEN_BUDGET * 0.8) {
        logError({
            source: 'ChatService.Chart',
            message: 'Contexto de dados é grande. Enviando apenas métricas principais para o modelo.',
            severity: 'warning',
        });
        serializedContext = JSON.stringify({ keyMetrics });
    }

    const prompt = `
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
        ${serializedContext}

        PERGUNTA DO USUÁRIO:
        "${question}"
    `;

    try {
        const raw = (await callGeminiJson(prompt, logError)).trim();
        if (raw.toLowerCase() === 'null') {
            logError({
                source: 'ChatService.Chart',
                message: 'A IA determinou que não há gráfico relevante para esta pergunta.',
                severity: 'info',
            });
            return null;
        }

        const chartConfig = parseChartConfig(raw);
        cacheChartConfig(question, chartConfig);

        const elapsed = Math.round(now() - start);
        logError({
            source: 'ChatService.Chart',
            message: `Configuração do gráfico gerada em ${elapsed}ms.`,
            severity: 'info',
        });
        return chartConfig;
    } catch (error) {
        logError({
            source: 'ChatService.Chart',
            message: 'Falha ao gerar configuração do gráfico.',
            severity: 'critical',
            details: error,
        });
        console.error('Raw Gemini response for chart generation failed:', error);
        return null;
    }
}

async function callGeminiApi(
    promptParts: (string | { text: string })[],
    expectJson: boolean,
    logError: LogFn
): Promise<GeminiResponse> {
    const payload = {
        promptParts: promptParts.map(part => (typeof part === 'string' ? { text: part } : part)),
        isJsonMode: expectJson,
    };

    try {
        const response = await fetch(buildBackendHttpUrl('/api/gemini'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(
                `Erro no BFF /api/gemini: ${response.status} ${response.statusText}${errorData.message ? ` - ${errorData.message}` : ''}`
            );
        }

        const data: GeminiResponse = await response.json();
        if (!data.text || data.text.trim().length === 0) {
            const fallback = data.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('\n') ?? '';
            data.text = fallback;
        }

        if (!data.text || data.text.trim().length === 0) {
            const reason = data.promptFeedback?.blockReason;
            throw new Error(`Resposta da IA vazia${reason ? ` (motivo: ${reason})` : ''}.`);
        }

        return data;
    } catch (error) {
        logError({
            source: 'ChatService',
            message: 'Falha ao chamar a API Gemini pelo BFF.',
            severity: 'critical',
            details: error,
        });
        throw error;
    }
}

async function callGeminiText(prompt: string, logError: LogFn): Promise<string> {
    const { text } = await callGeminiApi([prompt], false, logError);
    return text ?? '';
}

async function callGeminiJson(prompt: string, logError: LogFn): Promise<string> {
    const { text } = await callGeminiApi([prompt], true, logError);
    return text ?? '';
}

function buildPrompt(
    question: string,
    ragContext: string,
    fallbackContext: string,
    predictiveContext: string
): { prompt: string; estimatedTokens: number } {
    let selectedContext = '';
    let sourceLabel = '';

    if (ragContext.trim().length > 10) {
        selectedContext = ragContext;
        sourceLabel = 'CONFIÁVEL E INDEXADO (RAG)';
    } else {
        selectedContext = fallbackContext;
        sourceLabel = 'BRUTO E COMPLETO (FALLBACK)';
    }

    if (predictiveContext.trim().length > 0) {
        selectedContext = appendBlock(predictiveContext, selectedContext);
    }

    const feedback = getFeedbackContext();
    let prompt = `
        Você é a Nexus AI, uma IA especialista em análise fiscal. Sua tarefa é responder à pergunta do usuário de forma precisa, profissional e detalhada.

        **INSTRUÇÕES CRÍTICAS:**
        1. **BASEIE-SE ESTRITAMENTE NO CONTEXTO:** Sua resposta DEVE ser fundamentada exclusivamente no contexto fornecido abaixo. Não invente informações.
        2. **SEJA ESPECIALISTA:** Demonstre conhecimento fiscal ao interpretar os dados, mencionando totais, remetentes, produtos, impostos, CFOPs ou outros dados relevantes.
        3. **PROIBIDO RESPOSTAS GENÉRICAS:** Se o contexto for insuficiente, indique explicitamente quais dados não foram encontrados, mas ofereça uma análise do que está disponível.
        4. **FONTE DO CONTEXTO:** A fonte para esta análise é: ${sourceLabel}.
        5. **FEEDBACK DO USUÁRIO:** ${feedback}. Utilize essas informações para ajustar o tom e a profundidade da sua resposta.

        --- INÍCIO DO CONTEXTO ---
        ${selectedContext}
        --- FIM DO CONTEXTO ---

        **PERGUNTA DO USUÁRIO:**
        "${question}"

        **SUA RESPOSTA DETALHADA:**
    `;

    let estimatedTokens = estimateTokens(prompt);
    if (estimatedTokens > TOKEN_BUDGET) {
        const ratio = TOKEN_BUDGET / estimatedTokens;
        const maxLength = Math.max(250, Math.floor(selectedContext.length * ratio * CONTEXT_TRUNCATION_RATIO));
        const truncatedContext = selectedContext.substring(0, maxLength);

        prompt = `
            Você é a Nexus AI, uma IA especialista em análise fiscal. Responda à pergunta do usuário com base no contexto.
            AVISO: O contexto foi truncado para caber no limite de tokens. Seja conciso e cite os valores mais relevantes.

            --- INÍCIO DO CONTEXTO (TRUNCADO) ---
            ${truncatedContext}
            --- FIM DO CONTEXTO ---

            **PERGUNTA DO USUÁRIO:**
            "${question}"

            **SUA RESPOSTA DETALHADA:**
        `;
        estimatedTokens = estimateTokens(prompt);
    }

    return { prompt, estimatedTokens };
}

async function convertAttachmentsToText(files: File[], logError: LogFn): Promise<string[]> {
    const snippets: string[] = [];
    for (const file of files) {
        try {
            if ((file.type || '').startsWith('image/')) {
                snippets.push(`ARQUIVO ANEXADO: ${file.name}\n[Conteúdo de imagem omitido para análise textual.]`);
                continue;
            }

            const extracted = await extractFullTextFromFile(file);
            if (extracted && extracted.trim()) {
                snippets.push(`ARQUIVO ANEXADO: ${file.name}\n${sanitizeSnippet(extracted, ATTACHMENT_SNIPPET_LENGTH)}`);
                continue;
            }

            const fallback = await file.text();
            if (fallback && fallback.trim()) {
                snippets.push(`ARQUIVO ANEXADO: ${file.name}\n${sanitizeSnippet(fallback, ATTACHMENT_SNIPPET_LENGTH)}`);
            }
        } catch (error) {
            logError({
                source: 'ChatService',
                message: `Falha ao processar arquivo anexado ${file.name}.`,
                severity: 'warning',
                details: error,
            });
        }
    }
    return snippets;
}

function appendBlock(current: string, block: string): string {
    if (!block.trim()) return current;
    return current.trim().length > 0 ? `${current}\n\n${block}` : block;
}

function sanitizeSnippet(text: string, maxLength: number): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function buildRagContext(chunks: Array<{ content: string; fileName?: string }>): string {
    if (!chunks || chunks.length === 0) return '';
    return chunks
        .map((chunk, index) => {
            const snippet = sanitizeSnippet(chunk.content, RAG_SNIPPET_LENGTH);
            const source = chunk.fileName || `Trecho ${index + 1}`;
            return `### Fonte ${index + 1}: ${source}\n${snippet}`;
        })
        .join('\n\n');
}

function formatForecastContext(forecast: ForecastResult): string {
    const faturamento = forecast.previsaoProximoMes.faturamento.toFixed(2);
    const impostos = forecast.previsaoProximoMes.impostos.toFixed(2);
    return `--- INSIGHT PREDITIVO DISPONÍVEL ---
Com base nos dados históricos, a previsão para o próximo mês é:
- Faturamento Estimado: R$ ${faturamento}
- Carga Tributária Estimada: R$ ${impostos}
Use esta informação se for relevante para a pergunta do usuário.
--- FIM DO INSIGHT PREDITIVO ---`;
}

function parseChartConfig(raw: string): ChartConfig {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('A resposta da IA não contém um objeto JSON válido.');
    }

    if (!['bar', 'line', 'pie'].includes(parsed.type)) {
        throw new Error(`Tipo de gráfico inválido: ${parsed.type}`);
    }
    if (!parsed.title || !parsed.xField || !parsed.yField) {
        throw new Error('Campos obrigatórios (title, xField, yField) ausentes na configuração do gráfico.');
    }
    if (!Array.isArray(parsed.data)) {
        throw new Error('O campo data deve ser um array.');
    }

    return parsed as ChartConfig;
}
