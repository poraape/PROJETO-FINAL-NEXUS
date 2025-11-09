import {
    ExecutiveSummary,
    GeneratedReport,
    SimulationResult,
    SimulationParams,
    ClassificationResult,
    ForecastResult,
} from '../types.ts';

const CONTEXT_PREFIX = 'NEXUS_CTX_';

const CONTEXT_KEYS = {
    LAST_REPORT_SUMMARY: 'LAST_REPORT_SUMMARY',
    LAST_GENERATED_REPORT: 'LAST_GENERATED_REPORT',
    SIMULATION_CACHE: 'SIMULATION_CACHE',
    DOCUMENT_INDEX: 'DOCUMENT_INDEX',
    QA_CACHE: 'QA_CACHE',
    CHART_CACHE: 'CHART_CACHE',
    CLASSIFICATIONS: 'CLASSIFICATIONS',
    FORECAST: 'FORECAST',
    CNPJ_CACHE: 'CNPJ_CACHE',
    USER_FEEDBACK: 'USER_FEEDBACK',
    CUSTOM_SECTORS: 'CUSTOM_SECTORS',
    CLASSIFICATION_CORRECTIONS: 'CLASSIFICATION_CORRECTIONS',
};

// --- Generic Storage Functions ---

const storeContext = (key: string, value: any): void => {
    try {
        const serializedValue = JSON.stringify(value);
        localStorage.setItem(`${CONTEXT_PREFIX}${key}`, serializedValue);
    } catch (error) {
        console.error(`[ContextMemory] Failed to store context for key "${key}":`, error);
    }
};

const getContext = <T>(key: string): T | null => {
    try {
        const serializedValue = localStorage.getItem(`${CONTEXT_PREFIX}${key}`);
        if (serializedValue === null) return null;
        return JSON.parse(serializedValue) as T;
    } catch (error) {
        console.error(`[ContextMemory] Failed to retrieve or parse context for key "${key}":`, error);
        localStorage.removeItem(`${CONTEXT_PREFIX}${key}`);
        return null;
    }
};

export const clearContext = (): void => {
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith(CONTEXT_PREFIX)) localStorage.removeItem(key);
    });
    console.log('[ContextMemory] All application context has been cleared.');
};


// --- Report & Simulation Cache ---

export const storeLastReportSummary = (summary: ExecutiveSummary) => storeContext(CONTEXT_KEYS.LAST_REPORT_SUMMARY, summary);
export const getLastReportSummary = (): ExecutiveSummary | null => getContext<ExecutiveSummary>(CONTEXT_KEYS.LAST_REPORT_SUMMARY);
export const storeLastGeneratedReport = (report: GeneratedReport) => storeContext(CONTEXT_KEYS.LAST_GENERATED_REPORT, report);
export const getLastGeneratedReport = (): GeneratedReport | null => getContext<GeneratedReport>(CONTEXT_KEYS.LAST_GENERATED_REPORT);

const getSimulationCache = (): Record<string, SimulationResult> => getContext<Record<string, SimulationResult>>(CONTEXT_KEYS.SIMULATION_CACHE) || {};
export const storeSimulationResult = (params: SimulationParams, result: SimulationResult) => {
    const cache = getSimulationCache();
    cache[JSON.stringify(params)] = result;
    storeContext(CONTEXT_KEYS.SIMULATION_CACHE, cache);
};
export const getCachedSimulation = (params: SimulationParams): SimulationResult | null => {
    const cache = getSimulationCache();
    const result = cache[JSON.stringify(params)] || null;
    if (result) {
        console.debug(`[ContextMemory.Simulation] Resultado da simulação encontrado no cache para os parâmetros:`, params);
    }
    return result;
};

// --- CNPJ Validation Cache ---
const getCnpjCache = (): Record<string, { data: any; timestamp: number }> => getContext(CONTEXT_KEYS.CNPJ_CACHE) || {};
export const getCachedCnpjValidation = (cnpj: string): any | null => {
    const cache = getCnpjCache();
    const entry = cache[cnpj];
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    if (entry && (Date.now() - entry.timestamp < ONE_WEEK)) {
        return entry.data;
    }
    return null;
};
export const storeCnpjValidation = (cnpj: string, data: any) => {
    const cache = getCnpjCache();
    cache[cnpj] = { data, timestamp: Date.now() };
    storeContext(CONTEXT_KEYS.CNPJ_CACHE, cache);
};

// --- User Feedback System ---
type FeedbackType = 'positive' | 'negative';
interface FeedbackEntry {
    timestamp: number;
    type: FeedbackType;
    content?: string; // Optional: could store the message that was rated
}
const getFeedback = (): FeedbackEntry[] => getContext<FeedbackEntry[]>(CONTEXT_KEYS.USER_FEEDBACK) || [];
export const storeFeedback = (type: FeedbackType, content?: string) => {
    const feedbacks = getFeedback();
    feedbacks.push({ timestamp: Date.now(), type, content });
    // Keep only the last 50 feedbacks to avoid excessive storage
    storeContext(CONTEXT_KEYS.USER_FEEDBACK, feedbacks.slice(-50));
};
export const getFeedbackContext = (): string => {
    const feedbacks = getFeedback();
    if (feedbacks.length === 0) return "Nenhum feedback do usuário recebido ainda.";
    const positives = feedbacks.filter(f => f.type === 'positive').length;
    const negatives = feedbacks.filter(f => f.type === 'negative').length;
    return `O usuário forneceu ${positives} feedbacks positivos e ${negatives} negativos até agora. Ajuste a resposta para ser mais útil.`;
};


// --- Custom Sectors for Classification ---
export const getCustomSectors = (): string[] | null => getContext<string[]>(CONTEXT_KEYS.CUSTOM_SECTORS);
export const storeCustomSectors = (sectors: string[]) => {
    const sanitizedSectors = sectors.map(s => s.trim()).filter(Boolean);
    storeContext(CONTEXT_KEYS.CUSTOM_SECTORS, sanitizedSectors);
};

// --- Classification Corrections (for future use) ---
interface ClassificationCorrection {
    chave: string;
    corrected_tipo_operacao: string;
    corrected_setor: string;
}
export const storeClassificationCorrection = (correction: ClassificationCorrection) => {
    const corrections = getContext<Record<string, ClassificationCorrection>>(CONTEXT_KEYS.CLASSIFICATION_CORRECTIONS) || {};
    corrections[correction.chave] = correction;
    storeContext(CONTEXT_KEYS.CLASSIFICATION_CORRECTIONS, corrections);
};


// --- RAG (Retrieval-Augmented Generation) System for Chat ---

interface DocumentChunk {
    fileName: string;
    content: string;
    keywords: string[]; // Always an array for safety and serialization
}

type DocumentIndex = DocumentChunk[];

// --- Helper Functions for RAG ---

/**
 * Safely extracts keywords from a text string.
 * @param text The input text.
 * @returns An array of unique keywords, guaranteed to be iterable.
 */
const extractKeywords = (text: string): string[] => {
    if (!text || typeof text !== 'string') return [];
    // Match words with 4 or more alphanumeric characters to get meaningful keywords
    const words = text.toLowerCase().match(/\b[a-zA-Z\dÀ-ÿ]{4,}\b/g);
    // Use a Set for uniqueness and convert back to an array
    return words ? [...new Set(words)] : [];
};


/**
 * Segments a larger text content into smaller, indexed chunks based on character length.
 * @param content The full text content.
 * @param fileName The name of the source file.
 * @returns An array of DocumentChunk objects.
 */
const segmentContent = (content: string, fileName: string): DocumentChunk[] => {
    const MAX_CHUNK_LENGTH = 5000;
    const chunks: DocumentChunk[] = [];
    if (!content || typeof content !== 'string') return chunks;

    for (let i = 0; i < content.length; i += MAX_CHUNK_LENGTH) {
        const segment = content.substring(i, i + MAX_CHUNK_LENGTH);
        if (segment.trim().length > 20) { // Filter out very small or empty chunks
            chunks.push({
                fileName,
                content: segment,
                keywords: extractKeywords(segment),
            });
        }
    }
    return chunks;
};

// 1. Indexing Functions
export const createAndStoreIndex = (files: {fileName: string, content: string}[]) => {
    console.debug('[ContextMemory.RAG] Iniciando indexação de documentos...');
    const fullIndex: DocumentIndex = files.flatMap(file => segmentContent(file.content, file.fileName));
    storeContext(CONTEXT_KEYS.DOCUMENT_INDEX, fullIndex);
    console.debug(`[ContextMemory.RAG] Indexação concluída. ${fullIndex.length} segmentos (chunks) foram criados e armazenados.`);
};

// 2. Retrieval Function
export const searchIndex = (query: string, topK = 5): DocumentChunk[] => {
    const rawIndex = getContext<DocumentIndex>(CONTEXT_KEYS.DOCUMENT_INDEX);

    // Sanitize the retrieved index to prevent runtime errors
    if (!Array.isArray(rawIndex) || rawIndex.length === 0) {
        console.warn("[ContextMemory.RAG] Nenhum contexto encontrado. O índice está vazio ou não foi criado.");
        return [];
    }

    // Ensure every chunk has a valid `keywords` array.
    const index: DocumentIndex = rawIndex.map(chunk => ({
        ...chunk,
        keywords: Array.isArray(chunk.keywords) ? chunk.keywords : []
    }));
    
    const queryKeywords = new Set(extractKeywords(query));
    if (queryKeywords.size === 0) {
        console.debug("[ContextMemory.RAG] A consulta não contém palavras-chave válidas para busca.");
        return [];
    }
    
    console.debug(`[ContextMemory.RAG] Buscando por palavras-chave:`, Array.from(queryKeywords));

    const scoredChunks = index.map(chunk => {
        // Now `chunk.keywords` is guaranteed to be an array
        const intersection = new Set(chunk.keywords.filter(k => queryKeywords.has(k)));
        const score = intersection.size; // Simple keyword overlap score
        return { chunk, score };
    });

    scoredChunks.sort((a, b) => b.score - a.score);

    const relevantChunks = scoredChunks.slice(0, topK).filter(c => c.score > 0);

    console.debug(`[ContextMemory.RAG] Busca por "${query}" encontrou ${relevantChunks.length} segmentos relevantes (top ${topK}).`);
    
    return relevantChunks.map(c => c.chunk);
};

// 3. Q&A Caching
const getQACache = (): Record<string, string> => getContext<Record<string, string>>(CONTEXT_KEYS.QA_CACHE) || {};

export const storeAnswer = (question: string, answer: string) => {
    const cache = getQACache();
    const key = question.trim().toLowerCase();
    cache[key] = answer;
    storeContext(CONTEXT_KEYS.QA_CACHE, cache);
    console.debug(`[ContextMemory.QA] Resposta para "${key}" armazenada no cache.`);
};

export const getAnswer = (question: string): string | null => {
    const cache = getQACache();
    const key = question.trim().toLowerCase();
    const cachedAnswer = cache[key] || null;
    if (cachedAnswer) {
        console.debug(`[ContextMemory.QA] Resposta para "${key}" encontrada no cache.`);
    }
    return cachedAnswer;
};

// 4. Chart Caching
const getChartCache = (): Record<string, any> => getContext<Record<string, any>>(CONTEXT_KEYS.CHART_CACHE) || {};

export const storeChartConfig = (question: string, config: any) => {
    const cache = getChartCache();
    const key = question.trim().toLowerCase();
    cache[key] = config;
    storeContext(CONTEXT_KEYS.CHART_CACHE, cache);
    console.debug(`[ContextMemory.Chart] Config for "${key}" stored in cache.`);
};

export const getChartConfig = (question: string): any | null => {
    const cache = getChartCache();
    const key = question.trim().toLowerCase();
    const cachedConfig = cache[key] || null;
    if (cachedConfig) {
        console.debug(`[ContextMemory.Chart] Config for "${key}" found in cache.`);
    }
    return cachedConfig;
};


// --- Classification Cache ---
export const storeClassifications = (classifications: ClassificationResult[]) => storeContext(CONTEXT_KEYS.CLASSIFICATIONS, classifications);
export const getClassifications = (): ClassificationResult[] | null => getContext<ClassificationResult[]>(CONTEXT_KEYS.CLASSIFICATIONS);

// --- Forecast Cache ---
export const storeForecast = (forecast: ForecastResult) => storeContext(CONTEXT_KEYS.FORECAST, forecast);
export const getForecast = (): ForecastResult | null => getContext<ForecastResult>(CONTEXT_KEYS.FORECAST);
