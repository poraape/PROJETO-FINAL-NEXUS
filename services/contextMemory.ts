import { ExecutiveSummary, SimulationResult, SimulationParams } from '../types.ts';

const CONTEXT_PREFIX = 'NEXUS_CTX_';

const CONTEXT_KEYS = {
    LAST_REPORT_SUMMARY: 'LAST_REPORT_SUMMARY',
    SIMULATION_CACHE: 'SIMULATION_CACHE'
};

/**
 * Stores a value in localStorage with the application's prefix.
 * @param key The context key.
 * @param value The value to store (will be JSON.stringified).
 */
export const storeContext = (key: string, value: any): void => {
    try {
        const serializedValue = JSON.stringify(value);
        localStorage.setItem(`${CONTEXT_PREFIX}${key}`, serializedValue);
    } catch (error) {
        console.error(`[ContextMemory] Failed to store context for key "${key}":`, error);
    }
};

/**
 * Retrieves a value from localStorage.
 * @param key The context key.
 * @returns The parsed value, or null if not found or if parsing fails.
 */
export const getContext = <T>(key: string): T | null => {
    try {
        const serializedValue = localStorage.getItem(`${CONTEXT_PREFIX}${key}`);
        if (serializedValue === null) {
            return null;
        }
        return JSON.parse(serializedValue) as T;
    } catch (error) {
        console.error(`[ContextMemory] Failed to retrieve or parse context for key "${key}":`, error);
        // In case of parsing error, clean up the invalid entry
        localStorage.removeItem(`${CONTEXT_PREFIX}${key}`);
        return null;
    }
};

/**
 * Clears all context data related to the application from localStorage.
 */
export const clearContext = (): void => {
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith(CONTEXT_PREFIX)) {
            localStorage.removeItem(key);
        }
    });
    console.log('[ContextMemory] All application context has been cleared.');
};

// --- Specific Context Helpers ---

/**
 * Stores the latest executive summary in cognitive memory.
 * @param summary The executive summary object.
 */
export const storeLastReportSummary = (summary: ExecutiveSummary) => {
    storeContext(CONTEXT_KEYS.LAST_REPORT_SUMMARY, summary);
};

/**
 * Retrieves the latest executive summary from cognitive memory.
 * @returns The executive summary object or null.
 */
export const getLastReportSummary = (): ExecutiveSummary | null => {
    return getContext<ExecutiveSummary>(CONTEXT_KEYS.LAST_REPORT_SUMMARY);
};

/**
 * Retrieves the entire simulation cache from memory.
 * @returns A record mapping stringified params to simulation results.
 */
const getSimulationCache = (): Record<string, SimulationResult> => {
    return getContext<Record<string, SimulationResult>>(CONTEXT_KEYS.SIMULATION_CACHE) || {};
};

/**
 * Stores a new simulation result in the cache.
 * @param params The parameters used for the simulation.
 * @param result The result of the simulation.
 */
export const storeSimulationResult = (params: SimulationParams, result: SimulationResult) => {
    const cache = getSimulationCache();
    const key = JSON.stringify(params); // Using a simple JSON string as a key
    cache[key] = result;
    storeContext(CONTEXT_KEYS.SIMULATION_CACHE, cache);
};

/**
 * Retrieves a cached simulation result based on its parameters.
 * @param params The parameters of the simulation to look for.
 * @returns The cached simulation result or null if not found.
 */
export const getCachedSimulation = (params: SimulationParams): SimulationResult | null => {
    const cache = getSimulationCache();
    const key = JSON.stringify(params);
    return cache[key] || null;
};
