import { ExecutiveSummary, SimulationResult, SimulationParams, ClassificationResult, ForecastResult } from '../types.ts';

const CONTEXT_PREFIX = 'NEXUS_CTX_';

const CONTEXT_KEYS = {
    LAST_REPORT_SUMMARY: 'LAST_REPORT_SUMMARY',
    SIMULATION_CACHE: 'SIMULATION_CACHE',
    DOCUMENT_INDEX: 'DOCUMENT_INDEX',
    QA_CACHE: 'QA_CACHE',
    CLASSIFICATIONS: 'CLASSIFICATIONS',
    FORECAST: 'FORECAST',
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

const getSimulationCache = (): Record<string, SimulationResult> => getContext<Record<string, SimulationResult>>(CONTEXT_KEYS.SIMULATION_CACHE) || {};
export const storeSimulationResult = (params: SimulationParams, result: SimulationResult) => {
    const cache = getSimulationCache();
    cache[JSON.stringify(params)] = result;
    storeContext(CONTEXT_KEYS.SIMULATION_CACHE, cache);
};
export const getCachedSimulation = (params: SimulationParams): SimulationResult | null => {
    const cache = getSimulationCache();
    return cache[JSON.stringify(params)] || null;
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
 * Segments a larger text content into smaller, indexed chunks.
 * @param content The full text content.
 * @param fileName The name of the source file.
 * @returns An array of DocumentChunk objects.
 */
const segmentContent = (content: string, fileName: string): DocumentChunk[] => {
    const segments = content.split(/\n\s*\n/); // Split by empty lines
    return segments.map(seg => {
        return {
            fileName,
            content: seg,
            keywords: extractKeywords(seg), // Use the new safe function
        };
    }).filter(chunk => chunk.content.trim().length > 20); // Filter out very small chunks
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

// --- Classification Cache ---
export const storeClassifications = (classifications: ClassificationResult[]) => storeContext(CONTEXT_KEYS.CLASSIFICATIONS, classifications);
export const getClassifications = (): ClassificationResult[] | null => getContext<ClassificationResult[]>(CONTEXT_KEYS.CLASSIFICATIONS);

// --- Forecast Cache ---
export const storeForecast = (forecast: ForecastResult) => storeContext(CONTEXT_KEYS.FORECAST, forecast);
export const getForecast = (): ForecastResult | null => getContext<ForecastResult>(CONTEXT_KEYS.FORECAST);